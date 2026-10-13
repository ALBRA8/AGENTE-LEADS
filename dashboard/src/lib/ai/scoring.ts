// ============================================================
// src/lib/ai/scoring.ts — Lead Score 0-100 (determinista, sin LLM)
// ============================================================
//
// TABLA DE PESOS (P0-B) — única fuente de verdad del score comercial:
//
//   | Componente     | Condición                                          | Máx |
//   |----------------|----------------------------------------------------|-----|
//   | tier           | A=25  B=20  C=15  D=10  E=5  F=0                   |  25 |
//   |                | (acepta "TIER_A" o "A"; falta/desconocido → 0)     |     |
//   | nicheFit       | high=15  medium=10  low=5  (none/falta → 0)        |  15 |
//   | pain           | painDetected && painType → base 20                 |  25 |
//   |                | +5 si painType es web ("outdated_website",         |     |
//   |                | "diy_website", "no_structured_data") Y lo          |     |
//   |                | corrobora techStack.isDiySite===true O un          |     |
//   |                | freshness verificado con freshnessScore<50;        |     |
//   |                | painDetected=false → 0                             |     |
//   | techStack      | isDiySite===true → 10; si no, isProSite===true     |  10 |
//   |                | → 5; ambos ausentes → 0 (DIY tiene prioridad      |     |
//   |                | si ambos vinieran en true)                         |     |
//   | freshness      | verificado → Math.round(freshnessScore × 0.30)     |  30 |
//   |                | null / no parseable / sin freshnessScore numérico  |     |
//   |                | / status≠"OK" (si el campo existe) → 0             |     |
//   |                | con reason "no verificado"                         |     |
//   | evidence       | +3 por ítem con status "FOUND" (máx +10)           |  10 |
//   | research_state | VALIDATED=15  RESEARCHED=5  DISCOVERED=0           |  15 |
//   |                | (otros/ausente → 0)                                |     |
//
// Los máximos teóricos suman 125 (130 con dolor web corroborado);
// el score final se CLAMPA a [0, 100].
//
// GARANTÍAS:
//   - Determinista: misma entrada → mismo { score, breakdown }.
//     Sin LLM, sin fechas, sin aleatoriedad.
//   - `breakdown` contiene SIEMPRE una entrada por componente (7 en
//     total), incluidas las que puntúan 0, con `reason` que explica
//     el porqué (auditable y persistible).
//
// FIX P0-B (defecto de score constante 15):
//   - La versión anterior SOLO leía `validation`, `evidence` y
//     `research_state`; como las rutas invocaban con validation:{},
//     evidence:[] y research_state:"VALIDATED" hardcodeado, todo lead
//     recibía score 15. Ahora cada señal comercial real puntúa según
//     la tabla anterior.
//   - Parámetros muertos ELIMINADOS de la firma:
//       · `city` / `category`: no alimentaban ningún componente ni
//         deben hacerlo (la ubicación/rubro no puntúan por sí solos).
//       · `validation`: la capa de validación NO existe en el dashboard
//         (no hay email/domain verification). Cuando se construya,
//         añadir su componente aquí con peso documentado.
//   - `techStack` y `freshnessData` aceptan el JSON string tal cual se
//     persiste en la DB o el objeto ya parseado.

// ------------------------------------------------------------
// Public types
// ------------------------------------------------------------

/** Una entrada del desglose auditable del score. */
export interface ScoreBreakdown {
  field: string;
  points: number;
  reason: string;
}

export interface LeadScoreResult {
  score: number;
  breakdown: ScoreBreakdown[];
}

/** Ítem de evidencia: solo status "FOUND" puntúa; nunca se inventa. */
export interface ScoreEvidenceItem {
  field: string;
  status: string; // "FOUND" | "NOT_FOUND" | "CONFIRMED_ABSENT" | ...
  source?: string;
}

export interface ScoreLeadInput {
  tier?: string | null;
  nicheFit?: string | null;
  painDetected?: boolean;
  painType?: string | null;
  /** JSON string (como se persiste en Prospect.techStack) u objeto parseado. */
  techStack?: string | Record<string, unknown> | null;
  /** JSON string (como se persiste en Prospect.freshnessData) u objeto parseado. */
  freshnessData?: string | Record<string, unknown> | null;
  research_state?: string | null;
  evidence?: ScoreEvidenceItem[] | null;
}

// ------------------------------------------------------------
// Weights (constantes = tabla documentada arriba)
// ------------------------------------------------------------

const TIER_POINTS: Record<string, number> = { A: 25, B: 20, C: 15, D: 10, E: 5, F: 0 };
const NICHE_POINTS: Record<string, number> = { high: 15, medium: 10, low: 5 };
const STATE_POINTS: Record<string, number> = { VALIDATED: 15, RESEARCHED: 5, DISCOVERED: 0 };

const PAIN_BASE = 20;
const PAIN_WEB_BONUS = 5;
const WEB_RELATED_PAIN_TYPES = new Set(["outdated_website", "diy_website", "no_structured_data"]);
const STALE_FRESHNESS_THRESHOLD = 50; // freshnessScore < 50 = sitio obsoleto → corrobora dolor web

const TECH_DIY_POINTS = 10;
const TECH_PRO_POINTS = 5;

const FRESHNESS_FACTOR = 0.3;

const EVIDENCE_POINTS_PER_ITEM = 3;
const EVIDENCE_MAX_POINTS = 10;

// ------------------------------------------------------------
// Helpers (puros, sin efectos)
// ------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** "TIER_A" → "A"; "a" → "A"; "PENDING"/"" → tal cual (sin peso). */
function normalizeTier(tier: unknown): string {
  const t = String(tier ?? "").trim().toUpperCase();
  return t.startsWith("TIER_") ? t.slice(5) : t;
}

/**
 * Acepta un objeto ya parseado o un JSON string (formato DB) y devuelve
 * el objeto, o null si está vacío/ilegible. Nunca lanza.
 */
function parseMaybeJson(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "object") {
    return Array.isArray(value) ? null : (value as Record<string, unknown>);
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    try {
      const parsed: unknown = JSON.parse(s);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

function hasKey(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// ------------------------------------------------------------
// Main entry point
// ------------------------------------------------------------

export function scoreLead(lead: ScoreLeadInput): LeadScoreResult {
  const breakdown: ScoreBreakdown[] = [];

  // ── 1. Tier ─────────────────────────────────────────────────
  const tierKey = normalizeTier(lead.tier);
  const tierPts = hasKey(TIER_POINTS, tierKey) ? TIER_POINTS[tierKey] : 0;
  breakdown.push({
    field: "tier",
    points: tierPts,
    reason: hasKey(TIER_POINTS, tierKey)
      ? `tier ${tierKey}`
      : `tier "${lead.tier ?? "ausente"}" sin peso (desconocido o PENDING)`,
  });

  // ── 2. NicheFit ─────────────────────────────────────────────
  const nicheKey = String(lead.nicheFit ?? "").trim().toLowerCase();
  const nichePts = hasKey(NICHE_POINTS, nicheKey) ? NICHE_POINTS[nicheKey] : 0;
  breakdown.push({
    field: "niche_fit",
    points: nichePts,
    reason: hasKey(NICHE_POINTS, nicheKey)
      ? `encaje de nicho "${nicheKey}"`
      : `nicheFit "${lead.nicheFit ?? "ausente"}" sin encaje evaluable`,
  });

  // ── Parse de techStack / freshnessData (JSON string de DB u objeto) ──
  const tech = parseMaybeJson(lead.techStack);
  const fresh = parseMaybeJson(lead.freshnessData);

  const isDiy = tech ? tech["isDiySite"] === true : false;
  const isPro = tech ? tech["isProSite"] === true : false;

  const freshStatus = fresh ? fresh["status"] : undefined;
  const freshScoreRaw = fresh ? Number(fresh["freshnessScore"]) : NaN;
  const freshnessVerified =
    !!fresh &&
    typeof freshStatus !== "string" && // si existe el campo y ≠ "OK" → no verificado
    Number.isFinite(freshScoreRaw);

  // ── 3. Pain (base + bonus web si hay corroboración) ─────────
  const webPain = !!lead.painType && WEB_RELATED_PAIN_TYPES.has(String(lead.painType));
  const painCorroborated =
    isDiy || (freshnessVerified && freshScoreRaw < STALE_FRESHNESS_THRESHOLD);

  let painPts = 0;
  let painReason: string;
  if (!lead.painDetected) {
    painReason = "painDetected=false — sin dolor detectado";
  } else if (!lead.painType) {
    painReason = "painDetected=true sin painType concreto — no puntúa";
  } else if (webPain && painCorroborated) {
    painPts = PAIN_BASE + PAIN_WEB_BONUS;
    painReason = `dolor web "${lead.painType}" detectado y corroborado por tech/freshness (base ${PAIN_BASE} + ${PAIN_WEB_BONUS})`;
  } else {
    painPts = PAIN_BASE;
    painReason = `dolor "${lead.painType}" detectado (base, sin corroboración web)`;
  }
  breakdown.push({ field: "pain", points: painPts, reason: painReason });

  // ── 4. TechStack ────────────────────────────────────────────
  let techPts = 0;
  let techReason: string;
  if (isDiy) {
    techPts = TECH_DIY_POINTS;
    techReason = "sitio DIY (builder/plantilla propia) — candidato a renovación web";
  } else if (isPro) {
    techPts = TECH_PRO_POINTS;
    techReason = "sitio profesional — menor dolor de stack";
  } else {
    techReason = "sin señales de tech stack (isDiySite/isProSite ausentes o no verificado)";
  }
  breakdown.push({ field: "tech_stack", points: techPts, reason: techReason });

  // ── 5. Freshness ────────────────────────────────────────────
  let freshPts = 0;
  let freshReason: string;
  if (!fresh) {
    freshReason = "no verificado — sin datos de freshness (sin website o check no corrido)";
  } else if (typeof freshStatus === "string" && freshStatus !== "OK") {
    freshReason = `no verificado — freshness status="${freshStatus}"`;
  } else if (!Number.isFinite(freshScoreRaw)) {
    freshReason = "no verificado — freshnessScore ausente o no numérico";
  } else {
    const freshScore = clamp(Math.round(freshScoreRaw), 0, 100);
    freshPts = Math.round(freshScore * FRESHNESS_FACTOR);
    freshReason = `freshnessScore ${freshScore}/100 verificado × 0.30`;
  }
  breakdown.push({ field: "freshness", points: freshPts, reason: freshReason });

  // ── 6. Evidence (solo status "FOUND"; nunca se inventa) ─────
  const evidenceList = Array.isArray(lead.evidence) ? lead.evidence : [];
  const found = evidenceList.filter(
    (e) => e != null && typeof e === "object" && (e as ScoreEvidenceItem).status === "FOUND"
  );
  const evPts = Math.min(found.length * EVIDENCE_POINTS_PER_ITEM, EVIDENCE_MAX_POINTS);
  breakdown.push({
    field: "evidence",
    points: evPts,
    reason: found.length
      ? `${found.length} evidencia(s) FOUND (${EVIDENCE_POINTS_PER_ITEM} c/u, máx ${EVIDENCE_MAX_POINTS}): ${found
          .map((e) => (e as ScoreEvidenceItem).field)
          .join(", ")}`
      : "sin evidencias FOUND registradas",
  });

  // ── 7. Research state ───────────────────────────────────────
  const stateKey = String(lead.research_state ?? "").trim().toUpperCase();
  const statePts = hasKey(STATE_POINTS, stateKey) ? STATE_POINTS[stateKey] : 0;
  breakdown.push({
    field: "research_state",
    points: statePts,
    reason: hasKey(STATE_POINTS, stateKey)
      ? `research_state ${stateKey} (VALIDATED=15, RESEARCHED=5, DISCOVERED=0)`
      : `research_state "${lead.research_state ?? "ausente"}" sin bonus`,
  });

  // ── Aggregate + clamp ───────────────────────────────────────
  const raw = breakdown.reduce((sum, b) => sum + b.points, 0);
  const score = clamp(raw, 0, 100);
  return { score, breakdown };
}
