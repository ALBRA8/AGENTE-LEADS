// ============================================================
// src/lib/ai/qualification-deterministic.ts — núcleo PURO de
// calificación (P2: determinización de pain/tier ANTES del LLM).
//
// Sin imports de red ni LLM. El LLM (qualification.ts) SOLO
// aporta narrativa sobre este resultado; tier/pain/nicheFit son
// aquí y son reproducibles bit a bit.
//
// Todas las reglas evaluadas quedan registradas en `basis`
// (auditoría: regla, si disparó, y detalle).
// ============================================================

import type {
  Tier,
  NicheFit,
  OfferContext,
  ProspectContext,
} from "./qualification";

/** Entrada de auditoría: cada regla evaluada y si disparó. */
export interface QualificationRuleHit {
  rule: string;
  hit: boolean;
  detail?: string;
}

/** Resultado determinista completo (pre-LLM). */
export interface DeterministicQualification {
  tier: Tier;
  nicheFit: NicheFit;
  painDetected: boolean;
  painType?: string;
  /** SIEMPRE comprobable (literal de freshness o derivado de tech/http), nunca inventado. */
  painEvidence?: string;
  intentSignals: string[];
  disqualifyReason?: string;
  /** Auditoría: cada regla evaluada y si disparó. */
  basis: QualificationRuleHit[];
}

export interface DeterministicExtra {
  businessStatus?: string | null;
}

// ── Nombres estables de reglas (consumibles por tests/UI/logs) ──
export const RULES = {
  DISQ_NO_DIGITAL: "disqualify:no_digital_presence",
  DISQ_CLOSED: "disqualify:closed_permanently",
  DISQ_FRANCHISE: "disqualify:franchise_or_chain",
  NICHEFIT: "nichefit:keyword_match",
  PAIN_FRESHNESS: "pain:freshness_score_lt_30",
  PAIN_HTTP: "pain:http_only",
  PAIN_NO_MOBILE: "pain:not_mobile_responsive",
  PAIN_NO_BOOKING: "pain:no_booking_system",
  PAIN_DIY: "pain:diy_website",
  SIGNAL_NO_SCHEMA: "signal:no_structured_data",
  SIGNAL_DIY: "signal:diy_site",
  SIGNAL_PRO: "signal:pro_site",
  TIER: "tier:mapping",
} as const;

const FRANCHISE_RE = /franquicia|franchise|cadena de/i;

/** ¿El sitio pro suprime pains de "web cutre" (outdated/diy)? */
const PRO_SUPPRESS_DETAIL = "suprimida por isProSite";
/** Las reglas de nicho/pain no se evalúan cuando hay descalificación. */
const SKIPPED_BY_DISQUALIFY = "no evaluada: prospecto descalificado";

/**
 * socialLinks llega como string JSON ({cms:"..."}). Una red "con valor"
 * es cualquier entrada con string no vacío. Fallback defensivo: string
 * no-JSON no vacío y distinto de "{}" se considera presencia (comportamiento
 * de la heurística previa).
 */
export function hasSocialWithValue(socialLinks?: string | null): boolean {
  if (!socialLinks) return false;
  const trimmed = socialLinks.trim();
  if (!trimmed || trimmed === "{}") return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.some((v) =>
        typeof v === "string" ? v.trim().length > 0 : Boolean(v)
      );
    }
    if (parsed && typeof parsed === "object") {
      return Object.values(parsed).some((v) =>
        typeof v === "string" ? v.trim().length > 0 : Boolean(v)
      );
    }
    return false;
  } catch {
    // No es JSON válido: por compatibilidad con la heurística previa,
    // cualquier string no vacío ≠ "{}" cuenta como presencia digital.
    return true;
  }
}

/**
 * Motor determinista de calificación. Ejecuta TODAS las reglas en orden
 * fijo, registra cada una en `basis` y deriva tier/pain/nicheFit.
 * La descalificación (TIER_F) corta la evaluación de nicho/pain: esas
 * reglas quedan en basis como hit:false con detalle "no evaluada".
 */
export function determineQualification(
  offer: OfferContext,
  prospect: ProspectContext,
  extra?: DeterministicExtra
): DeterministicQualification {
  const basis: QualificationRuleHit[] = [];
  const signals = new Set<string>();

  const hasWeb = Boolean(prospect.website && prospect.website.trim());
  const hasSocial = hasSocialWithValue(prospect.socialLinks);
  const isProSite = prospect.techStack?.isProSite === true;
  const isDiySite = prospect.techStack?.isDiySite === true;
  const fresh = prospect.freshnessData ?? null;

  // ── CAPA 1: DESCALIFICACIÓN (TIER_F, corta el resto) ──────────────
  let disqualifyReason: string | undefined;

  if (!hasWeb && !hasSocial) {
    disqualifyReason = "sin presencia digital accionable";
    signals.add("no_digital_presence");
    basis.push({
      rule: RULES.DISQ_NO_DIGITAL,
      hit: true,
      detail: "sin website y sin ninguna red social con valor",
    });
  } else {
    basis.push({
      rule: RULES.DISQ_NO_DIGITAL,
      hit: false,
      detail: hasWeb ? "website presente" : "redes sociales con valor presentes",
    });
  }

  if (extra?.businessStatus === "CLOSED_PERMANENTLY") {
    disqualifyReason =
      disqualifyReason ?? "negocio cerrado permanentemente (Google Business Status)";
    basis.push({
      rule: RULES.DISQ_CLOSED,
      hit: true,
      detail: `businessStatus=${extra.businessStatus}`,
    });
  } else {
    basis.push({
      rule: RULES.DISQ_CLOSED,
      hit: false,
      detail: extra?.businessStatus
        ? `businessStatus=${extra.businessStatus}`
        : "businessStatus no informado",
    });
  }

  const haystack = `${prospect.name ?? ""} ${prospect.description ?? ""}`;
  if (FRANCHISE_RE.test(haystack)) {
    disqualifyReason =
      disqualifyReason ?? "franquicia o cadena (mención explícita)";
    basis.push({
      rule: RULES.DISQ_FRANCHISE,
      hit: true,
      detail: "mención de franquicia/franchise/'cadena de' en nombre o descripción",
    });
  } else {
    basis.push({ rule: RULES.DISQ_FRANCHISE, hit: false });
  }

  // ── DESCALIFICADO: estado final TIER_F, resto de reglas no evaluadas ──
  if (disqualifyReason) {
    basis.push({
      rule: RULES.NICHEFIT,
      hit: false,
      detail: SKIPPED_BY_DISQUALIFY,
    });
    for (const rule of [
      RULES.PAIN_FRESHNESS,
      RULES.PAIN_HTTP,
      RULES.PAIN_NO_MOBILE,
      RULES.PAIN_NO_BOOKING,
      RULES.PAIN_DIY,
      RULES.SIGNAL_NO_SCHEMA,
      RULES.SIGNAL_DIY,
      RULES.SIGNAL_PRO,
    ]) {
      basis.push({ rule, hit: false, detail: SKIPPED_BY_DISQUALIFY });
    }
    basis.push({
      rule: RULES.TIER,
      hit: true,
      detail: `TIER_F: descalificado (${disqualifyReason})`,
    });
    return {
      tier: "TIER_F",
      nicheFit: "none",
      painDetected: false,
      painType: undefined,
      painEvidence: undefined,
      intentSignals: [...signals],
      disqualifyReason,
      basis,
    };
  }

  // ── CAPA 2: NICHEFIT DETERMINISTA (keyword match documentado) ─────
  const targetNiches = (offer.targetNiches ?? "")
    .split(",")
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length > 0);

  const category = (prospect.category ?? "").toLowerCase();
  const description = (prospect.description ?? "").toLowerCase();

  let nicheFit: NicheFit;
  if (targetNiches.length === 0) {
    // Neutral documentado: sin nichos definidos no se puede afirmar fit.
    nicheFit = "medium";
    basis.push({
      rule: RULES.NICHEFIT,
      hit: false,
      detail: "sin nichos definidos → medium (neutral documentado)",
    });
  } else {
    let matches = 0;
    for (const niche of targetNiches) {
      if (category.includes(niche) || description.includes(niche)) matches++;
    }
    if (matches >= 2) nicheFit = "high";
    else if (matches === 1) nicheFit = "medium";
    else nicheFit = "low";
    basis.push({
      rule: RULES.NICHEFIT,
      hit: matches > 0,
      detail: `${matches}/${targetNiches.length} nichos encontrados en category/description → ${nicheFit}`,
    });
  }

  // ── CAPA 3: PAIN (reglas ordenadas; el primario es el PRIMER hit) ──
  // Cada regla produce { type, evidence } si dispara sin supresión.
  type PainHit = { type: string; evidence?: string };

  // Regla 1: freshnessScore < 30 → outdated_website (suprimible por pro).
  const r1: { hit: boolean; pain?: PainHit; detail?: string } = { hit: false };
  if (fresh && fresh.freshnessScore != null && fresh.freshnessScore < 30) {
    if (isProSite) {
      r1.detail = `${PRO_SUPPRESS_DETAIL} (freshnessScore=${fresh.freshnessScore})`;
    } else {
      r1.hit = true;
      r1.pain = {
        type: "outdated_website",
        evidence:
          fresh.comprobableEvidence || `freshness score ${fresh.freshnessScore}/100 (< 30)`,
      };
      r1.detail = `freshnessScore=${fresh.freshnessScore} < 30 → outdated_website`;
    }
  } else {
    r1.detail = fresh?.freshnessScore != null
      ? `freshnessScore=${fresh.freshnessScore} (no < 30)`
      : "freshnessScore no disponible";
  }
  basis.push({ rule: RULES.PAIN_FRESHNESS, hit: r1.hit, detail: r1.detail });

  // Regla 2: sitio http:// (sin HTTPS) → outdated_website (suprimible por pro).
  const r2: { hit: boolean; pain?: PainHit; detail?: string } = { hit: false };
  if (prospect.website?.startsWith("http://")) {
    if (isProSite) {
      r2.detail = `${PRO_SUPPRESS_DETAIL} (url: ${prospect.website})`;
    } else {
      r2.hit = true;
      r2.pain = {
        type: "outdated_website",
        evidence: `sitio sin HTTPS: ${prospect.website}`,
      };
      r2.detail = `website sin HTTPS (${prospect.website}) → outdated_website`;
    }
  } else {
    r2.detail = "website con HTTPS o ausente";
  }
  basis.push({ rule: RULES.PAIN_HTTP, hit: r2.hit, detail: r2.detail });

  // Regla 3: no mobile responsive → low_digital_maturity (NO suprimible).
  const r3: { hit: boolean; pain?: PainHit; detail?: string } = { hit: false };
  if (fresh?.isMobileResponsive === false) {
    r3.hit = true;
    r3.pain = {
      type: "low_digital_maturity",
      evidence: "isMobileResponsive=false (check de freshness)",
    };
    r3.detail = "isMobileResponsive=false → low_digital_maturity (no suprimible por isProSite)";
  } else {
    r3.detail = "isMobileResponsive true/unknown";
  }
  basis.push({ rule: RULES.PAIN_NO_MOBILE, hit: r3.hit, detail: r3.detail });

  // Regla 4: sin sistema de reservas → no_online_booking (NO suprimible).
  const r4: { hit: boolean; pain?: PainHit; detail?: string } = { hit: false };
  if (fresh?.hasBookingSystem === false) {
    r4.hit = true;
    r4.pain = {
      type: "no_online_booking",
      evidence: "hasBookingSystem=false (check de freshness)",
    };
    r4.detail = "hasBookingSystem=false → no_online_booking (no suprimible por isProSite)";
    signals.add("no_booking_system");
  } else {
    r4.detail = "hasBookingSystem true/unknown";
  }
  basis.push({ rule: RULES.PAIN_NO_BOOKING, hit: r4.hit, detail: r4.detail });

  // Regla 5: sitio DIY → diy_website (suprimida por pro).
  const r5: { hit: boolean; pain?: PainHit; detail?: string } = { hit: false };
  if (isDiySite) {
    if (isProSite) {
      r5.detail = `${PRO_SUPPRESS_DETAIL} (isDiySite=true e isProSite=true)`;
    } else {
      const cms = prospect.techStack?.cms;
      r5.hit = true;
      r5.pain = {
        type: "diy_website",
        evidence: cms
          ? `sitio DIY detectado (techStack.isDiySite=true, cms: ${cms})`
          : "sitio DIY detectado (techStack.isDiySite=true)",
      };
      r5.detail = `isDiySite=true → diy_website${cms ? ` (cms: ${cms})` : ""}`;
    }
  } else {
    r5.detail = "isDiySite no activo";
  }
  basis.push({ rule: RULES.PAIN_DIY, hit: r5.hit, detail: r5.detail });

  // Señales técnicas (no son pain por sí solas):
  if (fresh?.hasStructuredData === false) {
    signals.add("no_structured_data");
    basis.push({
      rule: RULES.SIGNAL_NO_SCHEMA,
      hit: true,
      detail: "hasStructuredData=false → señal, no pain",
    });
  } else {
    basis.push({ rule: RULES.SIGNAL_NO_SCHEMA, hit: false });
  }
  if (isDiySite) {
    signals.add("diy_site");
    basis.push({ rule: RULES.SIGNAL_DIY, hit: true });
  } else {
    basis.push({ rule: RULES.SIGNAL_DIY, hit: false });
  }
  if (isProSite) {
    signals.add("pro_site");
    basis.push({ rule: RULES.SIGNAL_PRO, hit: true });
  } else {
    basis.push({ rule: RULES.SIGNAL_PRO, hit: false });
  }

  // PainType primario = PRIMER hit no suprimido; painDetected si hay alguno.
  const painHits: PainHit[] = [r1, r2, r3, r4, r5]
    .filter((r) => r.hit && r.pain)
    .map((r) => r.pain!);
  const primary = painHits[0];
  const painDetected = painHits.length > 0;
  if (primary?.type === "outdated_website") {
    signals.add("static_outdated_site");
  }

  // ── CAPA 4: TIER (mapping determinista documentado) ────────────────
  let tier: Tier;
  let tierDetail: string;
  if (nicheFit === "high" && painDetected && signals.size >= 1) {
    tier = "TIER_A";
    tierDetail = `TIER_A: nicheFit=high + pain (${primary?.type}) + ${signals.size} señal(es) de intención`;
  } else if (nicheFit === "high" && painDetected) {
    tier = "TIER_B";
    tierDetail = `TIER_B: nicheFit=high + pain (${primary?.type}), sin señales de intención`;
  } else {
    tier = "TIER_C";
    tierDetail = `TIER_C: sin condiciones de A/B (nicheFit=${nicheFit}, painDetected=${painDetected}, señales=${signals.size})`;
  }
  basis.push({ rule: RULES.TIER, hit: true, detail: tierDetail });

  return {
    tier,
    nicheFit,
    painDetected,
    painType: primary?.type,
    painEvidence: primary?.evidence,
    intentSignals: [...signals],
    disqualifyReason: undefined,
    basis,
  };
}
