// ============================================================
// src/lib/ai/qualification.ts — 5-layer qualification pipeline
// ============================================================

import { aiChat } from "./client";

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
  // NEW: enrichment data from layers 6-7
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
    freshnessScore?: number;
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
}

const SYSTEM_PROMPT = `Eres el motor de calificación de AGENTE LEADS. Tu trabajo es analizar un prospecto y una oferta comercial, y devolver una calificación estructurada en 7 capas (las 5 originales + tech stack + freshness).

Debes devolver ÚNICAMENTE JSON válido (sin markdown, sin texto antes o después) con esta estructura exacta:

{
  "disqualifyReason": "string | null — si aplica capa 1 (descalificación), explicación. Si no aplica, null.",
  "nicheFit": "high | medium | low | none",
  "nicheFitReason": "string — por qué este prospecto encaja (o no) en el nicho objetivo",
  "painDetected": "boolean — ¿se detecta un pain point concreto y accionable?",
  "painType": "string | null — tipo de dolor detectado: 'outdated_website' | 'no_social_media' | 'inactive_social_media' | 'no_contact_info' | 'no_online_booking' | 'low_digital_maturity' | 'specific_negative_reviews' | 'recent_expansion' | 'diy_website' | 'no_structured_data' | null",
  "painEvidence": "string | null — evidencia pública concreta y comprobable del dolor. USA LITERALMENTE la evidencia del freshness check si está disponible.",
  "intentSignals": ["array de strings — señales de intención detectadas: 'new_business', 'recent_expansion', 'recent_hiring', 'negative_reviews_mention_problem', 'no_digital_presence', 'static_outdated_site', 'recent_funding', 'in_growth_phase', 'diy_site', 'pro_site', 'no_booking_system', 'no_structured_data'"],
  "tier": "TIER_A | TIER_B | TIER_C | TIER_F",
  "details": "string — resumen de 2-3 frases que justifica la asignación de tier"
}

REGLAS DE TIERING:
- TIER_A: fit alto + pain detectado + al menos 1 señal de intención
- TIER_B: fit alto + pain detectado, sin señales de intención
- TIER_C: fit alto solo, sin pain evidente
- TIER_F: descartado en capa 1 (sin web y sin redes sociales, franquicia, fuera de nicho, sin actividad, etc.)

REGLAS DE PAIN DETECTION:
- Si el prospecto NO tiene web Y NO tiene redes sociales → descartar (TIER_F, disqualifyReason: "sin presencia digital, no es accionable")
- Si el prospecto es franquicia/cadena (mencionado en nombre o descripción) → descartar (TIER_F)
- Si freshnessData.freshnessScore < 30 → painDetected: true, painType: "outdated_website", usar comprobableEvidence literalmente
- Si techStack.isDiySite === true → painDetected: true, painType: "diy_website" (sito hecho en WordPress con tema gratuito, débil digital)
- Si freshnessData.isMobileResponsive === false → painType: "low_digital_maturity"
- Si freshnessData.hasBookingSystem === false → painType: "no_online_booking"
- Si freshnessData.hasStructuredData === false → añade intent signal "no_structured_data"
- Si techStack.isProSite === true → NO marcar pain de tipo "diy_website" o "outdated_website" (ya tienen infraestructura pro)

REGLAS DE INTENT SIGNALS (capa 4):
- "new_business": negocio mencionado como nuevo o con menos de 12 meses
- "recent_expansion": mencionan expansión, nueva sede, apertura reciente
- "recent_hiring": anuncio de búsqueda de personal
- "negative_reviews_mention_problem": reseñas mencionan problema que la oferta resuelve
- "no_digital_presence": ausencia total de presencia digital
- "static_outdated_site": sitio estático y viejo
- "recent_funding": reciente inversión o financiación
- "in_growth_phase": signos de crecimiento activo
- "diy_site": techStack.isDiySite === true (sitio DIY, alta propensión a comprar servicios profesionales)
- "pro_site": techStack.isProSite === true (sitio profesional, BAJA propensión a comprar servicios básicos)
- "no_booking_system": freshnessData.hasBookingSystem === false
- "no_structured_data": freshnessData.hasStructuredData === false

PRIORIDAD DE EVIDENCIA:
1. Si freshnessData.comprobableEvidence está disponible, úsalo LITERALMENTE en painEvidence.
2. Si no, usa la evidencia del techStack (cms, framework, isDiySite, isFreeTheme).
3. Si no, infiere del resto de info.

Sé realista y conservador. Solo marca painDetected=true si hay evidencia pública clara. Si no hay suficiente info para confirmar, nicheFit debe ser "medium" o "low", no inventes.`;

export async function qualifyProspect(
  offer: OfferContext,
  prospect: ProspectContext
): Promise<QualificationResult> {
  let social: any = undefined;
  try {
    if (prospect.socialLinks) social = JSON.parse(prospect.socialLinks);
  } catch {}

  const userMsg = `OFERTA DEL USUARIO:
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

Analiza este prospecto contra la oferta y devuelve el JSON de calificación. Recuerda: solo JSON, sin markdown.`;

  try {
    const raw = await aiChat([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ]);

    // Strip markdown code fences if any
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      tier: (parsed.tier || "TIER_C") as Tier,
      nicheFit: (parsed.nicheFit || "medium") as NicheFit,
      painDetected: Boolean(parsed.painDetected),
      painType: parsed.painType || null,
      painEvidence: parsed.painEvidence || null,
      intentSignals: Array.isArray(parsed.intentSignals) ? parsed.intentSignals : [],
      disqualifyReason: parsed.disqualifyReason || null,
      details: parsed.details || "",
    };
  } catch (e: any) {
    console.error("[qualification] AI error:", e.message);
    // Fallback: heuristic qualification without LLM
    return heuristicQualify(offer, prospect);
  }
}

function heuristicQualify(
  offer: OfferContext,
  prospect: ProspectContext
): QualificationResult {
  const hasWeb = Boolean(prospect.website);
  const hasSocial = Boolean(prospect.socialLinks && prospect.socialLinks !== "{}");
  const hasEmail = Boolean(prospect.email);

  if (!hasWeb && !hasSocial) {
    return {
      tier: "TIER_F",
      nicheFit: "none",
      painDetected: false,
      disqualifyReason: "Sin presencia digital accionable",
      intentSignals: [],
      details: "Descartado: no tiene web ni redes sociales activas.",
    };
  }

  const niches = (offer.targetNiches || "").toLowerCase();
  const cat = (prospect.category || "").toLowerCase();
  const desc = (prospect.description || "").toLowerCase();
  const fitScore = niches.split(",").reduce((acc, n) => {
    const t = n.trim();
    if (t && (cat.includes(t) || desc.includes(t))) return acc + 1;
    return acc;
  }, 0);

  let nicheFit: NicheFit = "low";
  if (fitScore >= 2) nicheFit = "high";
  else if (fitScore === 1) nicheFit = "medium";

  let pain = false;
  let painType: string | undefined;
  if (hasWeb && prospect.website?.startsWith("http://")) {
    pain = true;
    painType = "outdated_website";
  } else if (!hasEmail) {
    pain = true;
    painType = "no_contact_info";
  }

  let tier: Tier = "TIER_C";
  if (nicheFit === "high" && pain) tier = "TIER_B";
  else if (nicheFit === "medium" && pain) tier = "TIER_C";

  return {
    tier,
    nicheFit,
    painDetected: pain,
    painType,
    painEvidence: painType
      ? `Detección heurística: ${painType}`
      : undefined,
    intentSignals: [],
    disqualifyReason: undefined,
    details: `Calificación heurística (IA no disponible). Fit: ${nicheFit}.`,
  };
}
