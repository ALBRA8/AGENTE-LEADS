// ============================================================
// src/lib/ai/__tests__/qualification-deterministic.test.ts
// Tests P2-QUAL para el núcleo PURO determineQualification.
//
// Sin mocks de red ni LLM: el módulo bajo test es puro.
// Cobertura:
//   1. Descalificaciones (sin presencia digital, CLOSED_PERMANENTLY,
//      franquicia/cadena) → TIER_F + corte de nicho/pain.
//   2. NicheFit por keyword match: 0/1/2 matches, case-insensitive,
//      sin targetNiches → medium (neutral documentado).
//   3. Pain: reglas 1-5 disparan y no disparan; primario = primer hit;
//      painEvidence literal de comprobableEvidence o derivada.
//   4. Supresión isProSite (outdated/diy) y no-supresión (mobile/booking).
//   5. hasStructuredData=false → señal, NO pain.
//   6. Mapping de tier A/B/C/F completo.
//   7. basis siempre presente, auditable y determinista.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  determineQualification,
  hasSocialWithValue,
  RULES,
  type QualificationRuleHit,
} from "../qualification-deterministic";
import type { OfferContext, ProspectContext } from "../qualification";

// ── Builders ────────────────────────────────────────────────────────
function offer(over: Partial<OfferContext> = {}): OfferContext {
  return { name: "Web Pro", description: "Diseño web profesional", ...over };
}

function prospect(over: Partial<ProspectContext> = {}): ProspectContext {
  return {
    name: "Clínica Dental Sonrisa",
    website: "https://sonrisa.com",
    ...over,
  };
}

function hits(basis: QualificationRuleHit[], rule: string): QualificationRuleHit {
  const entry = basis.find((b) => b.rule === rule);
  expect(entry, `basis debe incluir la regla "${rule}"`).toBeDefined();
  return entry!;
}

// Prospecto que encaja en 2 nichos (fit high) sin pain ni señales extra.
const HIGH_FIT: Partial<ProspectContext> = {
  category: "Clínica Dental",
  description: "clínica dental y gimnasio de barrio",
};

describe("determineQualification — descalificación (TIER_F)", () => {
  it("sin web y sin redes → TIER_F 'sin presencia digital accionable' + signal no_digital_presence", () => {
    const r = determineQualification(offer(), prospect({ website: null, socialLinks: null }));
    expect(r.tier).toBe("TIER_F");
    expect(r.disqualifyReason).toBe("sin presencia digital accionable");
    expect(r.nicheFit).toBe("none");
    expect(r.painDetected).toBe(false);
    expect(r.painType).toBeUndefined();
    expect(r.painEvidence).toBeUndefined();
    expect(r.intentSignals).toContain("no_digital_presence");
    expect(hits(r.basis, RULES.DISQ_NO_DIGITAL).hit).toBe(true);
  });

  it("socialLinks sin ninguna red con valor ('{}' o valores vacíos) → descalificado", () => {
    for (const social of [null, undefined, "{}", '{"instagram":"", "facebook":"  "}']) {
      const r = determineQualification(
        offer(),
        prospect({ website: null, socialLinks: social })
      );
      expect(r.tier, `socialLinks=${String(social)}`).toBe("TIER_F");
    }
  });

  it("red social con valor → NO descalificado", () => {
    const r = determineQualification(
      offer(),
      prospect({ website: null, socialLinks: '{"instagram":"https://inst.a/x"}' })
    );
    expect(r.tier).not.toBe("TIER_F");
    expect(r.disqualifyReason).toBeUndefined();
  });

  it("businessStatus CLOSED_PERMANENTLY → TIER_F 'negocio cerrado permanentemente'", () => {
    const r = determineQualification(offer(), prospect(), {
      businessStatus: "CLOSED_PERMANENTLY",
    });
    expect(r.tier).toBe("TIER_F");
    expect(r.disqualifyReason).toBe(
      "negocio cerrado permanentemente (Google Business Status)"
    );
    expect(hits(r.basis, RULES.DISQ_CLOSED).hit).toBe(true);
    expect(r.nicheFit).toBe("none");
    expect(r.painDetected).toBe(false);
  });

  it("otros businessStatus (OPERATIONAL) → NO descalifica", () => {
    const r = determineQualification(offer(), prospect(), { businessStatus: "OPERATIONAL" });
    expect(r.tier).not.toBe("TIER_F");
    expect(hits(r.basis, RULES.DISQ_CLOSED).hit).toBe(false);
  });

  it("franquicia en nombre → TIER_F 'franquicia o cadena (mención explícita)'", () => {
    const r = determineQualification(offer(), prospect({ name: "Dental Franquicia MX" }));
    expect(r.tier).toBe("TIER_F");
    expect(r.disqualifyReason).toBe("franquicia o cadena (mención explícita)");
    expect(hits(r.basis, RULES.DISQ_FRANCHISE).hit).toBe(true);
  });

  it("'cadena de' y 'franchise' en descripción → TIER_F", () => {
    for (const description of [
      "somos una cadena de clínicas",
      "part of a big franchise group",
    ]) {
      const r = determineQualification(offer(), prospect({ description }));
      expect(r.tier, `descripción="${description}"`).toBe("TIER_F");
    }
  });

  it("'cadena' sin 'cadena de' NO descalifica (regex exacta)", () => {
    const r = determineQualification(
      offer(),
      prospect({ description: "referente nacional, no es una gran cadena nacional" })
    );
    expect(r.tier).not.toBe("TIER_F");
  });

  it("descalificado corta el resto: reglas de nicho/pain en basis como no evaluadas", () => {
    const r = determineQualification(
      offer(),
      prospect({
        website: null,
        socialLinks: null,
        freshnessData: { freshnessScore: 10, isMobileResponsive: false },
      })
    );
    expect(r.tier).toBe("TIER_F");
    for (const rule of [
      RULES.NICHEFIT,
      RULES.PAIN_FRESHNESS,
      RULES.PAIN_HTTP,
      RULES.PAIN_NO_MOBILE,
      RULES.PAIN_NO_BOOKING,
      RULES.PAIN_DIY,
      RULES.SIGNAL_NO_SCHEMA,
      RULES.SIGNAL_DIY,
      RULES.SIGNAL_PRO,
    ]) {
      const hit = hits(r.basis, rule);
      expect(hit.hit, rule).toBe(false);
      expect(hit.detail, rule).toContain("no evaluada");
    }
    expect(hits(r.basis, RULES.TIER).detail).toContain("TIER_F");
  });
});

describe("determineQualification — nicheFit determinista", () => {
  it("2 nichos en category/description → high", () => {
    const r = determineQualification(
      offer({ targetNiches: "Dental, Gimnasio" }),
      prospect({ category: "Clínica Dental", description: "con gimnasio adjunto" })
    );
    expect(r.nicheFit).toBe("high");
  });

  it("1 nicho → medium", () => {
    const r = determineQualification(
      offer({ targetNiches: "dental, gimnasio" }),
      prospect({ category: "Clínica Dental", description: "tratamientos faciales" })
    );
    expect(r.nicheFit).toBe("medium");
  });

  it("0 nichos → low", () => {
    const r = determineQualification(
      offer({ targetNiches: "panadería, floristería" }),
      prospect({ category: "Clínica Dental", description: "odontología general" })
    );
    expect(r.nicheFit).toBe("low");
    const hit = hits(r.basis, RULES.NICHEFIT);
    expect(hit.hit).toBe(false);
    expect(hit.detail).toContain("0/");
  });

  it("case-insensitive y tolerante a espacios alrededor de las comas", () => {
    const r = determineQualification(
      offer({ targetNiches: "  CLÍNICA DENTAL  ,  PELUQUERÍA " }),
      prospect({ category: "clínica dental integral", description: "peluquería y estética" })
    );
    expect(r.nicheFit).toBe("high");
  });

  it("sin targetNiches (null/undefined/vacío/solo comas) → medium (neutral documentado)", () => {
    for (const targetNiches of [null, undefined, "", " , , "]) {
      const r = determineQualification(offer({ targetNiches }), prospect(HIGH_FIT));
      expect(r.nicheFit, `targetNiches=${String(targetNiches)}`).toBe("medium");
      const hit = hits(r.basis, RULES.NICHEFIT);
      expect(hit.hit).toBe(false);
      expect(hit.detail).toContain("sin nichos definidos");
    }
  });
});

describe("determineQualification — pain (reglas 1-5)", () => {
  it("regla 1: freshnessScore < 30 → outdated_website con comprobableEvidence LITERAL", () => {
    const literal = "Last-Modified: 2019-03-01 (hace 6 años)";
    const r = determineQualification(
      offer(),
      prospect({ freshnessData: { freshnessScore: 22, comprobableEvidence: literal } })
    );
    expect(r.painDetected).toBe(true);
    expect(r.painType).toBe("outdated_website");
    expect(r.painEvidence).toBe(literal);
    expect(hits(r.basis, RULES.PAIN_FRESHNESS).hit).toBe(true);
    expect(r.intentSignals).toContain("static_outdated_site");
  });

  it("regla 1 sin comprobableEvidence → evidence derivada 'freshness score X/100 (< 30)'", () => {
    const r = determineQualification(
      offer(),
      prospect({ freshnessData: { freshnessScore: 12 } })
    );
    expect(r.painEvidence).toBe("freshness score 12/100 (< 30)");
  });

  it("regla 1 no dispara con score 30, null o ausente", () => {
    for (const freshnessData of [
      { freshnessScore: 30 },
      { freshnessScore: null },
      {},
      undefined,
    ]) {
      const r = determineQualification(offer(), prospect({ freshnessData }));
      expect(hits(r.basis, RULES.PAIN_FRESHNESS).hit, JSON.stringify(freshnessData)).toBe(
        false
      );
    }
  });

  it("regla 2: website http:// → outdated_website con evidence 'sitio sin HTTPS: {url}'", () => {
    const r = determineQualification(
      offer(),
      prospect({ website: "http://sonrisa.com" })
    );
    expect(r.painType).toBe("outdated_website");
    expect(r.painEvidence).toBe("sitio sin HTTPS: http://sonrisa.com");
    expect(hits(r.basis, RULES.PAIN_HTTP).hit).toBe(true);
  });

  it("regla 2 no dispara con https://", () => {
    const r = determineQualification(offer(), prospect({ website: "https://sonrisa.com" }));
    expect(hits(r.basis, RULES.PAIN_HTTP).hit).toBe(false);
  });

  it("regla 3: isMobileResponsive=false → low_digital_maturity", () => {
    const r = determineQualification(
      offer(),
      prospect({ freshnessData: { isMobileResponsive: false } })
    );
    expect(r.painType).toBe("low_digital_maturity");
    expect(r.painDetected).toBe(true);
    expect(hits(r.basis, RULES.PAIN_NO_MOBILE).hit).toBe(true);
  });

  it("regla 4: hasBookingSystem=false → no_online_booking + signal no_booking_system", () => {
    const r = determineQualification(
      offer(),
      prospect({ freshnessData: { hasBookingSystem: false } })
    );
    expect(r.painType).toBe("no_online_booking");
    expect(r.intentSignals).toContain("no_booking_system");
    expect(hits(r.basis, RULES.PAIN_NO_BOOKING).hit).toBe(true);
  });

  it("regla 5: isDiySite=true → diy_website con evidence derivada del techStack", () => {
    const r = determineQualification(
      offer(),
      prospect({ techStack: { isDiySite: true, cms: "WordPress" } })
    );
    expect(r.painType).toBe("diy_website");
    expect(r.painEvidence).toContain("isDiySite=true");
    expect(r.painEvidence).toContain("WordPress");
    expect(r.intentSignals).toContain("diy_site");
    expect(hits(r.basis, RULES.PAIN_DIY).hit).toBe(true);
  });

  it("primario = PRIMER hit del orden (freshness antes que mobile/booking/diy)", () => {
    const r = determineQualification(
      offer(),
      prospect({
        freshnessData: {
          freshnessScore: 15,
          isMobileResponsive: false,
          hasBookingSystem: false,
        },
        techStack: { isDiySite: true },
      })
    );
    expect(r.painType).toBe("outdated_website");
  });

  it("primario cae a la siguiente regla cuando la primera no aplica (http:// antes que diy)", () => {
    const r = determineQualification(
      offer(),
      prospect({
        website: "http://sonrisa.com",
        techStack: { isDiySite: true },
      })
    );
    expect(r.painType).toBe("outdated_website");
    expect(r.painEvidence).toBe("sitio sin HTTPS: http://sonrisa.com");
  });

  it("hasStructuredData=false NO es pain: solo añade señal no_structured_data", () => {
    const r = determineQualification(
      offer(),
      prospect({ freshnessData: { hasStructuredData: false } })
    );
    expect(r.painDetected).toBe(false);
    expect(r.painType).toBeUndefined();
    expect(r.intentSignals).toContain("no_structured_data");
    const hit = hits(r.basis, RULES.SIGNAL_NO_SCHEMA);
    expect(hit.hit).toBe(true);
    expect(hit.detail).toContain("no pain");
  });

  it("sin datos de freshness/tech → sin pain y sin señales técnicas", () => {
    const r = determineQualification(offer(), prospect());
    expect(r.painDetected).toBe(false);
    expect(r.intentSignals).toEqual([]);
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
      expect(hits(r.basis, rule).hit, rule).toBe(false);
    }
  });
});

describe("determineQualification — supresión por isProSite", () => {
  const pro = { isProSite: true } as ProspectContext["techStack"];

  it("suprime outdated (freshness<30) con basis hit:false 'suprimida por isProSite'", () => {
    const r = determineQualification(
      offer(),
      prospect({ techStack: pro, freshnessData: { freshnessScore: 10 } })
    );
    const hit = hits(r.basis, RULES.PAIN_FRESHNESS);
    expect(hit.hit).toBe(false);
    expect(hit.detail).toContain("suprimida por isProSite");
    expect(r.painDetected).toBe(false);
    expect(r.painType).toBeUndefined();
    expect(r.intentSignals).not.toContain("static_outdated_site");
  });

  it("suprime outdated (http://) y diy_website", () => {
    const r = determineQualification(
      offer(),
      prospect({
        website: "http://sonrisa.com",
        techStack: { isProSite: true, isDiySite: true },
      })
    );
    for (const rule of [RULES.PAIN_HTTP, RULES.PAIN_DIY]) {
      expect(hits(r.basis, rule).detail).toContain("suprimida por isProSite");
    }
    expect(r.painDetected).toBe(false);
  });

  it("NO suprime low_digital_maturity ni no_online_booking", () => {
    const r = determineQualification(
      offer(),
      prospect({
        techStack: pro,
        freshnessData: { isMobileResponsive: false, hasBookingSystem: false },
      })
    );
    expect(r.painDetected).toBe(true);
    expect(r.painType).toBe("low_digital_maturity");
    expect(hits(r.basis, RULES.PAIN_NO_BOOKING).hit).toBe(true);
    expect(r.intentSignals).toContain("no_booking_system");
  });

  it("isProSite añade señal pro_site (aunque suprima pains)", () => {
    const r = determineQualification(
      offer(),
      prospect({ techStack: pro, freshnessData: { freshnessScore: 5 } })
    );
    expect(r.intentSignals).toContain("pro_site");
    expect(r.intentSignals).not.toContain("static_outdated_site");
  });
});

describe("determineQualification — mapping de tier", () => {
  it("TIER_A: fit high + pain + ≥1 señal de intención", () => {
    const r = determineQualification(
      offer({ targetNiches: "dental, gimnasio" }),
      prospect({ category: "clínica dental", description: "y gimnasio", freshnessData: { freshnessScore: 20 } })
    );
    expect(r.nicheFit).toBe("high");
    expect(r.painDetected).toBe(true);
    expect(r.intentSignals.length).toBeGreaterThanOrEqual(1);
    expect(r.tier).toBe("TIER_A");
    expect(hits(r.basis, RULES.TIER).detail).toContain("TIER_A");
  });

  it("TIER_B: fit high + pain sin señales (solo low_digital_maturity)", () => {
    const r = determineQualification(
      offer({ targetNiches: "dental, gimnasio" }),
      prospect({
        category: "clínica dental",
        description: "y gimnasio",
        freshnessData: { isMobileResponsive: false },
      })
    );
    expect(r.nicheFit).toBe("high");
    expect(r.painDetected).toBe(true);
    expect(r.intentSignals).toEqual([]);
    expect(r.tier).toBe("TIER_B");
  });

  it("TIER_C: fit high sin pain", () => {
    const r = determineQualification(
      offer({ targetNiches: "dental, gimnasio" }),
      prospect({ category: "clínica dental", description: "y gimnasio" })
    );
    expect(r.tier).toBe("TIER_C");
    expect(hits(r.basis, RULES.TIER).detail).toContain("TIER_C");
  });

  it("TIER_C: fit medium/low con pain", () => {
    for (const targetNiches of ["dental", "panadería"]) {
      const r = determineQualification(
        offer({ targetNiches }),
        prospect({ category: "clínica dental", freshnessData: { freshnessScore: 20 } })
      );
      expect(r.painDetected).toBe(true);
      expect(r.tier, `niches=${targetNiches}`).toBe("TIER_C");
    }
  });

  it("TIER_F: cualquier descalificación manda aunque el resto sería TIER_A", () => {
    const r = determineQualification(
      offer({ targetNiches: "dental, gimnasio" }),
      prospect({
        name: "Franquicia Dental Sonrisa",
        category: "clínica dental",
        description: "gimnasio",
        freshnessData: { freshnessScore: 20 },
      })
    );
    expect(r.tier).toBe("TIER_F");
    expect(r.nicheFit).toBe("none");
  });
});

describe("determineQualification — auditoría y determinismo", () => {
  it("basis SIEMPRE presente y con TODAS las reglas registradas (hit o no)", () => {
    for (const p of [
      prospect(),
      prospect({ website: null, socialLinks: null }),
      prospect({ freshnessData: { freshnessScore: 5 }, techStack: { isProSite: true } }),
    ]) {
      const r = determineQualification(offer(), p);
      expect(r.basis.length).toBeGreaterThan(0);
      const registered = new Set(r.basis.map((b) => b.rule));
      for (const rule of Object.values(RULES)) {
        expect(registered.has(rule), `falta regla ${rule}`).toBe(true);
      }
      for (const b of r.basis) {
        expect(typeof b.rule).toBe("string");
        expect(typeof b.hit).toBe("boolean");
      }
    }
  });

  it("es determinista: dos llamadas idénticas → deep equal", () => {
    const p = prospect({
      category: "clínica dental",
      freshnessData: { freshnessScore: 18, hasStructuredData: false },
      techStack: { isDiySite: true },
      socialLinks: '{"instagram":"https://inst.a/x"}',
    });
    const a = determineQualification(offer({ targetNiches: "dental" }), p);
    const b = determineQualification(offer({ targetNiches: "dental" }), p);
    expect(a).toEqual(b);
  });

  it("hasSocialWithValue: casos límite documentados", () => {
    expect(hasSocialWithValue(null)).toBe(false);
    expect(hasSocialWithValue("{}")).toBe(false);
    expect(hasSocialWithValue('{"instagram":""}')).toBe(false);
    expect(hasSocialWithValue('{"instagram":"https://x"}')).toBe(true);
    expect(hasSocialWithValue('["https://x"]')).toBe(true);
    // Fallback defensivo heredado: string no-JSON no vacío cuenta como presencia.
    expect(hasSocialWithValue("instagram.com/algo")).toBe(true);
  });
});
