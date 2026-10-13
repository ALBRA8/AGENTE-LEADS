// ============================================================
// src/lib/ai/qualification.ts — 5-layer qualification pipeline
// P2: determinización de pain/tier ANTES del LLM.
//
// El núcleo de reglas vive en qualification-deterministic.ts
// (puro, reproducible). El LLM SOLO aporta NARRATIVA: cualquier
// cosa que diga sobre tier/pain/nicheFit/intentSignals se
// ignora — esos campos SIEMPRE vienen del determinista.
// ============================================================

import { aiChat } from "./client";
import {
  determineQualification as determineQualificationCore,
  type DeterministicQualification,
  type QualificationRuleHit,
} from "./qualification-deterministic";

export type Tier = "TIER_A" | "TIER_B" | "TIER_C" | "TIER_F" | "PENDING";
export type NicheFit = "high" | "medium" | "low" | "none";

export interface OfferContext {
  name: string;
  description: string;
  priceRange?: string | null;
  idealCustomer?: string | null;
  targetNiches?: string | null;
  sector?: string | null;
}

export interface ProspectContext {
  name: string;
  category?: string | null;
  city?: string | null;
  address?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  socialLinks?: string | null; // JSON
  description?: string | null;
  // P2: estado del negocio según Google Business (CLOSED_PERMANENTLY descalifica).
  businessStatus?: string | null;
  // Enrichment data from layers 6-7
  techStack?: {
    cms?: string;
    framework?: string;
    builder?: string;
    ecommerce?: string;
    themeName?: string;
    isFreeTheme?: boolean;
    isDiySite?: boolean;
    isProSite?: boolean;
    rawSignatures?: string[];
  } | null;
  freshnessData?: {
    lastModifiedDate?: string | null;
    copyrightYear?: number | null;
    isMobileResponsive?: boolean;
    hasStructuredData?: boolean;
    hasBookingSystem?: boolean;
    bookingSystemName?: string | null;
    daysSinceLastUpdate?: number | null;
    // number | null: llega por JSON.parse de la columna DB (null posible);
    // el motor determinista lo trata con != null (P2).
    freshnessScore?: number | null;
    comprobableEvidence?: string;
  } | null;
}

export interface QualificationResult {
  tier: Tier;
  nicheFit: NicheFit;
  painDetected: boolean;
  painType?: string;
  painEvidence?: string;
  intentSignals: string[];
  disqualifyReason?: string;
  details: string;
  /** P2: auditoría determinista — cada regla evaluada y si disparó. */
  basis: QualificationRuleHit[];
  /** P2: narrativa del LLM sobre el encaje de nicho (opcional). */
  nicheFitReason?: string;
}

// Alias de conveniencia: el núcleo determinista también se exporta desde aquí.
export function determineQualification(
  offer: OfferContext,
  prospect: ProspectContext,
  extra?: { businessStatus?: string | null }
): DeterministicQualification {
  return determineQualificationCore(offer, prospect, extra);
}

// Narrativa solicitada al LLM (única salida esperada de él):
interface NarrativeResponse {
  nicheFitReason?: unknown;
  painEvidenceNarrative?: unknown;
  details?: unknown;
}

const SYSTEM_PROMPT = `Eres el motor narrativo de calificación de AGENTE LEADS. La calificación estructural (tier, pain, nicheFit, señales) YA FUE CALCULADA por un motor determinista de reglas verificables y NO ES MODIFICABLE. Tu único rol es aportar NARRATIVA explicable para un comercial.

Debes devolver ÚNICAMENTE JSON válido (sin markdown, sin texto antes o después) con esta estructura exacta:

{
  "nicheFitReason": "string — 1-2 frases explicando por qué este prospecto encaja (o no) con los nichos objetivo de la oferta",
  "painEvidenceNarrative": "string | null — narrativa breve del dolor detectado, citando la evidencia comprobable proporcionada (no inventes datos). null si no hay dolor detectado",
  "details": "string — resumen de 2-3 frases que justifica la calificación ya calculada, para un comercial"
}

REGLAS ESTRICTAS:
- NO propongas ni modifiques tier, painDetected, painType, nicheFit ni intentSignals: ya están decididos y serán ignorados.
- Basa la narrativa EXCLUSIVAMENTE en los datos proporcionados (incluida la evidencia comprobable); no alucines datos que no estén.
- Sé conservador y concreto.`;

function buildUserMsg(
  offer: OfferContext,
  prospect: ProspectContext,
  social: unknown,
  det: DeterministicQualification
): string {
  const detLine = `CALIFICACIÓN DETERMINISTA YA CALCULADA (NO MODIFICABLE): tier=${det.tier}, pain=${
    det.painDetected ? det.painType : "no detectado"
  }, nicheFit=${det.nicheFit} — tu rol es solo narrativo.`;

  return `OFERTA DEL USUARIO:
- Nombre: ${offer.name}
- Descripción: ${offer.description}
- Precio: ${offer.priceRange || "no especificado"}
- Cliente ideal: ${offer.idealCustomer || "no especificado"}
- Nichos objetivo: ${offer.targetNiches || "no especificado"}
- Sector: ${offer.sector || "no especificado"}

PROSPECTO A ANALIZAR:
- Nombre: ${prospect.name}
- Categoría: ${prospect.category || "n/a"}
- Ciudad: ${prospect.city || "n/a"}
- Dirección: ${prospect.address || "n/a"}
- Sitio web: ${prospect.website || "NO TIENE"}
- Teléfono: ${prospect.phone || "NO TIENE"}
- Email: ${prospect.email || "NO TIENE"}
- Redes sociales: ${social ? JSON.stringify(social) : "NO TIENE"}
- Descripción pública: ${prospect.description || "sin descripción disponible"}

${
  prospect.techStack
    ? `TECH STACK DETECTADO (capa 6):
- CMS: ${prospect.techStack.cms || "no detectado"}
- Framework: ${prospect.techStack.framework || "no detectado"}
- Builder: ${prospect.techStack.builder || "nativo"}
- E-commerce: ${prospect.techStack.ecommerce || "no"}
- Tema: ${prospect.techStack.themeName || "no identificado"}
- isFreeTheme: ${prospect.techStack.isFreeTheme ?? "n/a"}
- isDiySite (DIY/sin equipo técnico): ${prospect.techStack.isDiySite ?? "n/a"}
- isProSite (sitio profesional, ya invierten): ${prospect.techStack.isProSite ?? "n/a"}
- Signatures detectadas: ${(prospect.techStack.rawSignatures || []).join(", ") || "ninguna"}
`
    : ""
}

${
  prospect.freshnessData
    ? `FRESHNESS CHECK (capa 7):
- Last-Modified: ${prospect.freshnessData.lastModifiedDate || "no disponible"}
- Copyright year: ${prospect.freshnessData.copyrightYear || "no detectado"}
- Es mobile responsive: ${prospect.freshnessData.isMobileResponsive}
- Tiene structured data (Schema.org): ${prospect.freshnessData.hasStructuredData}
- Tiene sistema de reservas: ${prospect.freshnessData.hasBookingSystem}${prospect.freshnessData.bookingSystemName ? ` (${prospect.freshnessData.bookingSystemName})` : ""}
- Días desde última actualización: ${prospect.freshnessData.daysSinceLastUpdate ?? "desconocido"}
- Freshness score: ${prospect.freshnessData.freshnessScore}/100
- EVIDENCIA COMPROBABLE: ${prospect.freshnessData.comprobableEvidence || "no disponible"}
`
    : ""
}

${detLine}

Devuelve solo el JSON narrativo ({nicheFitReason, painEvidenceNarrative, details}), sin markdown.`;
}

/** details determinista cuando el LLM no aporta narrativa utilizable. */
function deterministicDetails(det: DeterministicQualification): string {
  const hitRules = det.basis
    .filter((b) => b.hit)
    .map((b) => b.rule)
    .join(", ");
  return `Calificación determinista (IA no disponible). Reglas disparadas: ${hitRules || "ninguna"}`;
}

/**
 * Califica un prospecto: PRIMERO el motor determinista (fuente de verdad
 * de tier/pain/nicheFit/señales/descalificación), DESPUÉS el LLM solo para
 * narrativa. Si el LLM falla o devuelve JSON roto, el resultado determinista
 * sale intacto y SIEMPRE con basis.
 */
export async function qualifyProspect(
  offer: OfferContext,
  prospect: ProspectContext
): Promise<QualificationResult> {
  // 1) Núcleo determinista — SIEMPRE se ejecuta primero.
  const det = determineQualificationCore(offer, prospect, {
    businessStatus: prospect.businessStatus,
  });

  let social: unknown = undefined;
  try {
    if (prospect.socialLinks) social = JSON.parse(prospect.socialLinks);
  } catch {
    // socialLinks no-JSON se muestra tal cual en el mensaje.
    social = prospect.socialLinks;
  }

  // 2) LLM — SOLO narrativa. Nunca decide campos estructurales.
  let narrative: NarrativeResponse | null = null;
  try {
    const raw = await aiChat([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMsg(offer, prospect, social, det) },
    ]);
    // Strip markdown code fences if any
    const cleaned = raw.replace(/```json|```/g, "").trim();
    narrative = JSON.parse(cleaned) as NarrativeResponse;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[qualification] AI error (se usa resultado determinista):", msg);
    narrative = null;
  }

  // 3) Merge: lo estructural SIEMPRE del determinista.
  const llmDetails =
    typeof narrative?.details === "string" && narrative.details.trim()
      ? narrative.details.trim()
      : null;
  const llmNicheFitReason =
    typeof narrative?.nicheFitReason === "string" && narrative.nicheFitReason.trim()
      ? narrative.nicheFitReason.trim()
      : undefined;
  const llmPainEvidence =
    typeof narrative?.painEvidenceNarrative === "string" &&
    narrative.painEvidenceNarrative.trim()
      ? narrative.painEvidenceNarrative.trim()
      : undefined;

  // Prioridad de painEvidence (P2):
  //   1. Literal comprobable de freshness SI la regla lo generó (máxima fiabilidad).
  //   2. Narrativa del LLM (citando evidencia).
  //   3. Evidencia derivada determinista (tech/http).
  // Sin pain determinista NO hay painEvidence (la narrativa sola no crea pain).
  const comprobable = prospect.freshnessData?.comprobableEvidence;
  const comprobableWins =
    det.painDetected &&
    !!det.painEvidence &&
    !!comprobable &&
    det.painEvidence === comprobable;
  const painEvidence = det.painDetected
    ? comprobableWins
      ? det.painEvidence
      : (llmPainEvidence ?? det.painEvidence)
    : undefined;

  const details = llmDetails
    ? llmNicheFitReason
      ? `${llmDetails} | Encaje de nicho: ${llmNicheFitReason}`
      : llmDetails
    : deterministicDetails(det);

  return {
    tier: det.tier,
    nicheFit: det.nicheFit,
    painDetected: det.painDetected,
    painType: det.painType,
    painEvidence,
    intentSignals: det.intentSignals,
    disqualifyReason: det.disqualifyReason,
    details,
    basis: det.basis,
    nicheFitReason: llmNicheFitReason,
  };
}
