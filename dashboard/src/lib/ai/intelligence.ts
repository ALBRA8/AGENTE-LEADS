// ============================================================
// src/lib/ai/intelligence.ts — LLM-powered Lead Intelligence (P1.2 + P2)
// GLM 5.3 Flash reasons about each lead and produces:
//   summary, opportunity_size, outreach_angle, confidence
//   + items: taxonomía FACT/INFERENCE/HYPOTHESIS/RECOMMENDATION (P2)
//
// P2 — reglas de honestidad:
//   · El post-procesado es determinista: NUNCA se confía ciegamente
//     en el LLM (kinds se normalizan, los no reconocidos se descartan).
//   · Si el LLM no aporta items válidos → items deterministas
//     construidos SOLO con datos observados del prospect.
//   · El modo determinista NUNCA genera HYPOTHESIS (solo el LLM
//     puede especular, y queda etiquetado como tal).
// ============================================================

import { aiChat } from "./client";
import { db } from "@/lib/db";

// ── Tipos (P2) ──────────────────────────────────────────────

export type IntelligenceKind = "FACT" | "INFERENCE" | "HYPOTHESIS" | "RECOMMENDATION";

export interface IntelligenceItem {
  kind: IntelligenceKind;
  text: string;
}

export interface LeadIntelligence {
  summary: string;
  opportunity_size: "small" | "medium" | "large" | "unknown";
  outreach_angle: string;
  confidence: "high" | "medium" | "low" | "none";
  signals_used: string[];
  items: IntelligenceItem[]; // P2: taxonomía de inteligencia
}

/**
 * Subconjunto de campos del prospect Prisma que consume este módulo.
 * Tipado estructural y defensivo: Prisma se está regenerando en paralelo
 * con campos P2 nuevos (pageSpeed, intelligenceItems...) — este módulo
 * nunca depende tipadamente de campos que aún no existen.
 */
interface ProspectLike {
  name?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  category?: string | null;
  tier?: string | null;
  nicheFit?: string | null;
  painDetected?: boolean;
  painType?: string | null;
  painEvidence?: string | null;
  techStack?: string | null;
  freshnessData?: string | null;
  // P1 Places/DEMO (acceso defensivo)
  rating?: number | null;
  ratingCount?: number | null;
  businessStatus?: string | null;
  isMock?: boolean;
  digitalPresence?: string | null;
}

// ── Post-procesado determinista de items ────────────────────

/** Techo duro de items por respuesta (del LLM o deterministas). */
const MAX_ITEMS = 10;

/**
 * Sinónimos comunes es/en aceptados como "kind". La clave es el kind
 * en minúsculas (tras trim). Cualquier otro valor → item descartado:
 * la honestidad manda, NO se reclasifica adivinando intenciones.
 */
const KIND_SYNONYMS: Record<string, IntelligenceKind> = {
  // en (los canónicos, en cualquier variante de mayúsculas/minúsculas)
  fact: "FACT",
  inference: "INFERENCE",
  hypothesis: "HYPOTHESIS",
  recommendation: "RECOMMENDATION",
  // es (con y sin acento)
  hecho: "FACT",
  dato: "FACT",
  inferencia: "INFERENCE",
  "conclusión": "INFERENCE",
  conclusion: "INFERENCE",
  "hipótesis": "HYPOTHESIS",
  hipotesis: "HYPOTHESIS",
  "suposición": "HYPOTHESIS",
  suposicion: "HYPOTHESIS",
  "recomendación": "RECOMMENDATION",
  recomendacion: "RECOMMENDATION",
  "acción": "RECOMMENDATION",
  accion: "RECOMMENDATION",
};

function normalizeKind(raw: unknown): IntelligenceKind | null {
  if (typeof raw !== "string") return null;
  return KIND_SYNONYMS[raw.trim().toLowerCase()] ?? null;
}

/**
 * Normaliza la lista cruda de items que llega del LLM:
 *  · `raw` no-array → [].
 *  · Entradas no-objeto, sin kind reconocible o con texto vacío/whitespace
 *    → descartadas (nunca reclasificadas: honestidad sobre adivinanza).
 *  · kind normalizado vía trim + minúsculas + tabla de sinónimos es/en.
 *  · Dedupe por (kind + text normalizado lowercase), se conserva la
 *    primera aparición.
 *  · Techo duro de 10 items (el dedupe se aplica ANTES del techo, para
 *    no perder items únicos evitables).
 */
export function normalizeItems(raw: unknown): IntelligenceItem[] {
  if (!Array.isArray(raw)) return [];
  const out: IntelligenceItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const kind = normalizeKind(e.kind);
    if (!kind) continue; // kind no reconocido → descartar el item
    if (typeof e.text !== "string") continue;
    const text = e.text.trim();
    if (!text) continue; // texto vacío/whitespace → descartar
    const key = `${kind}|${text.toLowerCase()}`;
    if (seen.has(key)) continue; // dedupe (kind + text lowercase)
    seen.add(key);
    out.push({ kind, text });
  }
  return out.slice(0, MAX_ITEMS);
}

// ── Items deterministas (fallback / 0 items válidos) ────────

/** Etiquetas ES para businessStatus distintos de OPERATIONAL. */
const BUSINESS_STATUS_LABELS: Record<string, string> = {
  CLOSED_TEMPORARILY: "Cerrado temporalmente",
  CLOSED_PERMANENTLY: "Cerrado permanentemente",
  // OPERATIONAL no genera item: que un negocio esté operativo no es novedad.
};

/**
 * Construye items deterministas SOLO con datos observados del prospect.
 *  · FACT por cada campo presente: website/phone/email, rating (+count),
 *    businessStatus != OPERATIONAL (etiqueta ES).
 *  · INFERENCE si hay dolor detectado (con su evidencia como "porqué")
 *    y/o presencia digital SIN_WEB_CONFIRMADA.
 *  · RECOMMENDATION única en cadena: dolor → teléfono sin web → genérica.
 *  · NUNCA genera HYPOTHESIS: el modo determinista no especula.
 */
export function buildDeterministicItems(prospect: ProspectLike | null | undefined): IntelligenceItem[] {
  if (!prospect) return [];
  const items: IntelligenceItem[] = [];

  // ── FACT: datos observados, tal cual ──
  if (prospect.website) items.push({ kind: "FACT", text: `Website: ${prospect.website}` });
  if (prospect.phone) items.push({ kind: "FACT", text: `Teléfono: ${prospect.phone}` });
  if (prospect.email) items.push({ kind: "FACT", text: `Email: ${prospect.email}` });
  if (prospect.rating != null && Number.isFinite(prospect.rating)) {
    const count =
      typeof prospect.ratingCount === "number" && Number.isFinite(prospect.ratingCount)
        ? ` (${prospect.ratingCount} opiniones)`
        : " (opiniones no disponibles)";
    items.push({ kind: "FACT", text: `Rating de Google: ${prospect.rating}${count}` });
  }
  if (prospect.businessStatus && prospect.businessStatus !== "OPERATIONAL") {
    const label = BUSINESS_STATUS_LABELS[prospect.businessStatus] ?? prospect.businessStatus;
    items.push({ kind: "FACT", text: `Estado del negocio en Google: ${label}` });
  }

  // ── INFERENCE: conclusiones derivadas (marcando el porqué) ──
  if (prospect.painDetected && prospect.painType) {
    items.push({
      kind: "INFERENCE",
      text: prospect.painEvidence
        ? `Dolor detectado (${prospect.painType}): ${prospect.painEvidence}`
        : `Dolor detectado (${prospect.painType})`,
    });
  }
  if (prospect.digitalPresence === "SIN_WEB_CONFIRMADA") {
    items.push({ kind: "INFERENCE", text: "Sin web confirmada — madurez digital baja" });
  }

  // ── RECOMMENDATION: una sola, primera regla que aplique ──
  if (prospect.painDetected) {
    items.push({
      kind: "RECOMMENDATION",
      text: `Primera aproximación: abordar directamente ${prospect.painType ?? "el dolor detectado"}`,
    });
  } else if (!prospect.website && prospect.phone) {
    items.push({ kind: "RECOMMENDATION", text: "Contacto directo por teléfono/WhatsApp viable" });
  } else {
    items.push({ kind: "RECOMMENDATION", text: "Verificar datos antes de contactar" });
  }

  return items.slice(0, MAX_ITEMS);
}

// ── Prompt (P2: taxonomía obligatoria de items) ─────────────

const SYSTEM_PROMPT = `You are AGENTE LEADS' Lead Intelligence module. Your job is to reason about a lead's public information and produce actionable intelligence for sales.

Return JSON ONLY (no markdown, no prose) with this structure:
{
  "summary": "1-2 sentence factual description using ONLY the data provided",
  "opportunity_size": "small | medium | large | unknown",
  "outreach_angle": "1-sentence suggestion on what to pitch first",
  "confidence": "high | medium | low | none",
  "signals_used": ["array of field names used"],
  "items": [{ "kind": "FACT | INFERENCE | HYPOTHESIS | RECOMMENDATION", "text": "..." }]
}

TAXONOMÍA OBLIGATORIA para "items" — "kind" SOLO puede ser una de estas 4 palabras exactas en MAYÚSCULAS (inglés); el "text" va en español:
- FACT: dato observado, copiado literalmente del input. Nunca interpretado.
- INFERENCE: conclusión derivada de datos observados. Marca siempre el porqué (p. ej. "porque...").
- HYPOTHESIS: especulación explícita que requeriría verificación antes de actuar.
- RECOMMENDATION: acción sugerida, concreta, para el vendedor.

REGLAS DE items:
1. Todo lo que NO sea directamente observable debe ir clasificado como INFERENCE, HYPOTHESIS o RECOMMENDATION — nunca camuflado como hecho.
2. Mínimo 2 items y máximo 10.
3. Si un campo no fue investigado o no hay datos, usa un item kind FACT con texto "no investigado" donde aplique. NUNCA inventes datos ni rellenes huecos con suposiciones.
4. kind SOLO en mayúsculas inglesas de la lista (FACT, INFERENCE, HYPOTHESIS, RECOMMENDATION).

CRITICAL RULES:
1. NEVER invent facts not in the input. Say "no determinable" if unknown.
2. Distinguish FOUND (observed) from NOT_FOUND (searched but didn't appear).
3. NEVER claim "doesn't have X" if X is just NOT_FOUND.
4. Be CONSERVATIVE — only say "large" if multiple strong signals.
5. Output ONLY JSON.`;

const OPPORTUNITY_SIZES: readonly string[] = ["small", "medium", "large", "unknown"];
const CONFIDENCES: readonly string[] = ["high", "medium", "low", "none"];

export async function generateIntelligence(
  prospectId: string,
  offerDescription?: string
): Promise<LeadIntelligence> {
  // Load the prospect from DB
  const prospect = await db.prospect.findUnique({
    where: { id: prospectId },
  });
  if (!prospect) return makeFallback("Prospect not found");

  // Build the LLM input from prospect data
  const userMsg = buildLLMInput(prospect, offerDescription);

  try {
    const raw = await aiChat([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ]);
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed: unknown = JSON.parse(cleaned);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("La respuesta del LLM no es un objeto JSON");
    }
    const p = parsed as Record<string, unknown>;

    // Post-procesado determinista: validación de enums, signals e items.
    // NUNCA se confía ciegamente en el LLM.
    const opportunity_size = OPPORTUNITY_SIZES.includes(String(p.opportunity_size))
      ? (p.opportunity_size as LeadIntelligence["opportunity_size"])
      : "unknown";
    const confidence = CONFIDENCES.includes(String(p.confidence))
      ? (p.confidence as LeadIntelligence["confidence"])
      : "low";
    const signals_used = Array.isArray(p.signals_used)
      ? p.signals_used.filter((s): s is string => typeof s === "string")
      : [];
    const items = normalizeItems(p.items);

    return {
      summary: String(p.summary ?? ""),
      opportunity_size,
      outreach_angle: String(p.outreach_angle ?? ""),
      confidence,
      signals_used,
      // P2: si el LLM no aporta items válidos → deterministas (datos reales)
      items: items.length > 0 ? items : buildDeterministicItems(prospect),
    };
  } catch (e) {
    // Solo el mensaje: nunca volcar el error completo (podría traer credenciales)
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[intelligence] GLM 5.3 Flash error:", msg);
    return makeFallback(prospect.name, prospect);
  }
}

function buildLLMInput(prospect: ProspectLike, offerDescription?: string): string {
  const lines: string[] = [];
  lines.push("LEAD DATA:");
  lines.push(`- Name: ${prospect.name}`);
  lines.push(`- Website: ${prospect.website ?? "no investigado"}`);
  lines.push(`- Email: ${prospect.email ?? "no investigado"}`);
  lines.push(`- Phone: ${prospect.phone ?? "no investigado"}`);
  lines.push(`- Location: ${prospect.city ?? "n/a"}`);
  lines.push(`- Category: ${prospect.category ?? "n/a"}`);
  lines.push(`- Tier: ${prospect.tier ?? "PENDING"}`);
  lines.push(`- Niche Fit: ${prospect.nicheFit ?? "n/a"}`);
  lines.push(`- Pain Detected: ${prospect.painDetected ? prospect.painType : "no"}`);
  lines.push(`- Pain Evidence: ${prospect.painEvidence ?? "n/a"}`);
  // P2: campos Places/DEMO — acceso defensivo (pueden no llegar según el
  // estado de la regeneración paralela de Prisma)
  if (prospect.rating != null && Number.isFinite(prospect.rating)) {
    const count =
      typeof prospect.ratingCount === "number" ? ` (${prospect.ratingCount} opiniones)` : "";
    lines.push(`- Rating: ${prospect.rating}${count}`);
  }
  if (prospect.businessStatus) {
    lines.push(`- Business Status: ${prospect.businessStatus}`);
  }
  if (prospect.digitalPresence) {
    lines.push(`- Digital Presence: ${prospect.digitalPresence}`);
  }
  if (prospect.isMock === true) {
    lines.push("- DATA FLAG: marcado DEMO/MOCK — datos de demostración, NO un negocio real");
  }
  if (prospect.techStack) {
    try {
      const ts = JSON.parse(prospect.techStack);
      lines.push(`- Tech Stack: CMS=${ts.cms}, DIY=${ts.isDiySite}, PRO=${ts.isProSite}`);
    } catch {}
  }
  if (prospect.freshnessData) {
    try {
      const fd = JSON.parse(prospect.freshnessData);
      lines.push(`- Freshness: score=${fd.freshnessScore}/100, responsive=${fd.isMobileResponsive}, booking=${fd.hasBookingSystem}`);
    } catch {}
  }
  if (offerDescription) {
    lines.push(`\nSELLER'S OFFER: ${offerDescription}`);
  }
  lines.push("\nProduce the JSON intelligence assessment per the system prompt.");
  return lines.join("\n");
}

function makeFallback(name: string, prospect?: ProspectLike | null): LeadIntelligence {
  return {
    summary: `${name} — información limitada disponible.`,
    opportunity_size: "unknown",
    outreach_angle: "No clear angle — generic outreach recommended",
    confidence: "low",
    signals_used: [],
    // P2: el fallback también incluye items deterministas (honestos)
    items: buildDeterministicItems(prospect ?? null),
  };
}
