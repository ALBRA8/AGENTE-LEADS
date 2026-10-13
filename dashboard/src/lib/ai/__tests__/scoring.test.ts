// ============================================================
// src/lib/ai/__tests__/scoring.test.ts
// Tests P0-B para scoreLead — score comercial determinista 0-100.
//
// Cobertura exigida:
//   1. Determinismo (dos llamadas idénticas → mismo resultado).
//   2. Caso conocido exacto con breakdown componente a componente.
//   3. Señales vacías → score 0 (NO 15 — defecto P0 original).
//   4. research_state VALIDATED solo aporta 15.
//   5. Clamp a [0, 100].
//   6. El score NO depende de city/category (params muertos, fuera
//      de la firma: se comprueba que props extra no cambian nada).
//   7. Evidencia: solo status "FOUND" puntúa (máx +10).
//   8. techStack/freshnessData aceptan JSON string (formato DB).
// ============================================================

import { describe, it, expect } from "vitest";
import { scoreLead, type ScoreBreakdown, type ScoreLeadInput } from "@/lib/ai/scoring";

/** Puntos del componente `field` en el breakdown (falla si no existe la entrada). */
function pts(breakdown: ScoreBreakdown[], field: string): number {
  const entry = breakdown.find((b) => b.field === field);
  expect(entry, `breakdown debe incluir entrada "${field}"`).toBeDefined();
  return entry!.points;
}

describe("scoreLead (P0-B)", () => {
  it("es determinista: dos llamadas idénticas → mismo score y breakdown", () => {
    const input: ScoreLeadInput = {
      tier: "TIER_B",
      nicheFit: "medium",
      painDetected: true,
      painType: "low_digital_maturity",
      techStack: { isDiySite: true },
      freshnessData: { freshnessScore: 80 },
      research_state: "RESEARCHED",
      evidence: [
        { field: "website", status: "FOUND", source: "search" },
        { field: "phone", status: "FOUND", source: "search" },
        { field: "email", status: "FOUND", source: "search" },
      ],
    };
    const a = scoreLead(input);
    const b = scoreLead(input);
    expect(a).toEqual(b);
    expect(a.score).toBe(b.score);
    expect(a.breakdown).toEqual(b.breakdown);
  });

  it("caso conocido exacto: B + medium + pain + isDiySite + freshness 80 + 3 evidencias + RESEARCHED = 98", () => {
    const r = scoreLead({
      tier: "TIER_B",       // 20
      nicheFit: "medium",   // 10
      painDetected: true,
      painType: "low_digital_maturity", // 20 (base, no es dolor web)
      techStack: { isDiySite: true },   // 10
      freshnessData: { freshnessScore: 80 }, // round(80 × 0.30) = 24
      research_state: "RESEARCHED", // 5
      evidence: [
        { field: "website", status: "FOUND", source: "search" },
        { field: "phone", status: "FOUND", source: "search" },
        { field: "email", status: "FOUND", source: "search" }, // 3 × 3 = 9
      ],
    });
    expect(r.score).toBe(98); // 20+10+20+10+24+9+5 = 98 (< 100, sin clamp)
    expect(r.breakdown).toHaveLength(7);
    expect(pts(r.breakdown, "tier")).toBe(20);
    expect(pts(r.breakdown, "niche_fit")).toBe(10);
    expect(pts(r.breakdown, "pain")).toBe(20);
    expect(pts(r.breakdown, "tech_stack")).toBe(10);
    expect(pts(r.breakdown, "freshness")).toBe(24);
    expect(pts(r.breakdown, "evidence")).toBe(9);
    expect(pts(r.breakdown, "research_state")).toBe(5);
    // Cada entrada es auditable: reason no vacía.
    for (const b of r.breakdown) {
      expect(typeof b.reason).toBe("string");
      expect(b.reason.length).toBeGreaterThan(0);
    }
  });

  it("ejemplo del enunciado con todas las señales fuertes → raw 113, clamp a 100", () => {
    const r = scoreLead({
      tier: "TIER_A",       // 25
      nicheFit: "high",     // 15
      painDetected: true,
      painType: "outdated_website", // 25 (base 20 + 5 corroborado por isDiySite)
      techStack: { isDiySite: true }, // 10
      freshnessData: { freshnessScore: 80 }, // 24
      research_state: "RESEARCHED", // 5
      evidence: [
        { field: "website", status: "FOUND" },
        { field: "phone", status: "FOUND" },
        { field: "email", status: "FOUND" }, // 9
      ],
    });
    const raw = r.breakdown.reduce((s, b) => s + b.points, 0);
    expect(raw).toBe(113); // 25+15+25+10+24+9+5
    expect(r.score).toBe(100); // clamp superior
    expect(pts(r.breakdown, "pain")).toBe(25);
  });

  it("señales vacías → score 0 (NO 15), con breakdown explicando cada 0", () => {
    const r = scoreLead({});
    expect(r.score).toBe(0);
    expect(r.score).not.toBe(15);
    expect(r.breakdown).toHaveLength(7);
    for (const b of r.breakdown) {
      expect(b.points).toBe(0);
      expect(b.reason.length).toBeGreaterThan(0);
    }
    // Razones explícitas para los ceros:
    expect(r.breakdown.find((b) => b.field === "freshness")!.reason).toContain("no verificado");
    expect(r.breakdown.find((b) => b.field === "pain")!.reason).toContain("painDetected=false");
    expect(r.breakdown.find((b) => b.field === "evidence")!.reason).toContain("sin evidencias");
    expect(r.breakdown.find((b) => b.field === "research_state")!.reason).toContain("sin bonus");
  });

  it("research_state: VALIDATED aporta 15 y solo 15; RESEARCHED=5; DISCOVERED=0; desconocido=0", () => {
    expect(scoreLead({ research_state: "VALIDATED" }).score).toBe(15);
    expect(scoreLead({ research_state: "RESEARCHED" }).score).toBe(5);
    expect(scoreLead({ research_state: "DISCOVERED" }).score).toBe(0);
    expect(scoreLead({ research_state: "STORED" }).score).toBe(0);
    expect(scoreLead({ research_state: "RESEARCHING" }).score).toBe(0);
    // VALIDATED no arrastra puntos extra por otros componentes:
    const r = scoreLead({ research_state: "VALIDATED", tier: "TIER_F", evidence: [{ field: "website", status: "NOT_FOUND" }] });
    expect(r.score).toBe(15);
    expect(pts(r.breakdown, "research_state")).toBe(15);
    expect(pts(r.breakdown, "tier")).toBe(0);
    expect(pts(r.breakdown, "evidence")).toBe(0);
  });

  it("clamp inferior y freshness fuera de rango: negativo → 0, >100 → máximo 30", () => {
    expect(scoreLead({ freshnessData: { freshnessScore: -20 } }).score).toBe(0);
    const hi = scoreLead({ freshnessData: { freshnessScore: 200 } });
    expect(pts(hi.breakdown, "freshness")).toBe(30); // round(clamp(200)×0.30)
    expect(hi.score).toBe(30);
    // Piso global: ningún input produce score < 0.
    const lo = scoreLead({ tier: "TIER_F", freshnessData: { freshnessScore: -50 } });
    expect(lo.score).toBeGreaterThanOrEqual(0);
  });

  it("freshness con campo status: status≠'OK' → 0 'no verificado'; status='OK' → puntúa", () => {
    const bad = scoreLead({ freshnessData: { freshnessScore: 90, status: "ERROR" } });
    expect(pts(bad.breakdown, "freshness")).toBe(0);
    expect(bad.breakdown.find((b) => b.field === "freshness")!.reason).toContain("no verificado");
    const ok = scoreLead({ freshnessData: { freshnessScore: 90, status: "OK" } });
    expect(pts(ok.breakdown, "freshness")).toBe(27); // round(90 × 0.30)
  });

  it("acepta techStack/freshnessData como JSON string (formato persistido en DB)", () => {
    const withStrings = scoreLead({
      tier: "TIER_B",
      nicheFit: "medium",
      painDetected: true,
      painType: "low_digital_maturity",
      techStack: JSON.stringify({ isDiySite: true }),
      freshnessData: JSON.stringify({ freshnessScore: 80 }),
      research_state: "RESEARCHED",
      evidence: [
        { field: "website", status: "FOUND" },
        { field: "phone", status: "FOUND" },
        { field: "email", status: "FOUND" },
      ],
    });
    const withObjects = scoreLead({
      tier: "TIER_B",
      nicheFit: "medium",
      painDetected: true,
      painType: "low_digital_maturity",
      techStack: { isDiySite: true },
      freshnessData: { freshnessScore: 80 },
      research_state: "RESEARCHED",
      evidence: [
        { field: "website", status: "FOUND" },
        { field: "phone", status: "FOUND" },
        { field: "email", status: "FOUND" },
      ],
    });
    expect(withStrings).toEqual(withObjects);
    expect(withStrings.score).toBe(98);
    // JSON ilegible → componente a 0 con reason, nunca lanza:
    const broken = scoreLead({ techStack: "{no-json", freshnessData: "[1,2" });
    expect(pts(broken.breakdown, "tech_stack")).toBe(0);
    expect(pts(broken.breakdown, "freshness")).toBe(0);
    expect(broken.breakdown.find((b) => b.field === "freshness")!.reason).toContain("no verificado");
  });

  it("el score NO depende de city/category/validation (params muertos eliminados de la firma)", () => {
    const base = scoreLead({ tier: "TIER_C" });
    const withDead = scoreLead({
      tier: "TIER_C",
      city: "Bogotá",
      category: "clínicas",
      validation: { email: { status: "valid", confidence: "high" } },
    } as unknown as ScoreLeadInput);
    expect(withDead).toEqual(base);
    expect(withDead.score).toBe(15);
  });

  it("evidence: +3 por FOUND con techo 10; estados no-FOUND no puntúan", () => {
    const five = scoreLead({
      evidence: ["a", "b", "c", "d", "e"].map((f) => ({ field: f, status: "FOUND" })),
    });
    expect(pts(five.breakdown, "evidence")).toBe(10); // 5×3=15 → cap 10
    expect(five.score).toBe(10);

    const notFound = scoreLead({
      evidence: [
        { field: "website", status: "NOT_FOUND" },
        { field: "phone", status: "CONFIRMED_ABSENT" },
        { field: "email", status: "INFERRED" },
      ],
    });
    expect(pts(notFound.breakdown, "evidence")).toBe(0);
    expect(notFound.score).toBe(0);

    const four = scoreLead({
      evidence: ["a", "b", "c", "d"].map((f) => ({ field: f, status: "FOUND" })),
    });
    expect(pts(four.breakdown, "evidence")).toBe(10); // 12 → cap 10
    const three = scoreLead({
      evidence: ["a", "b", "c"].map((f) => ({ field: f, status: "FOUND" })),
    });
    expect(pts(three.breakdown, "evidence")).toBe(9); // bajo el techo, sin cap
  });

  it("pain: base 20; bonus web (+5) solo con corroboración de tech/freshness", () => {
    // Dolor web sin corroboración → base:
    const alone = scoreLead({ painDetected: true, painType: "outdated_website" });
    expect(pts(alone.breakdown, "pain")).toBe(20);
    // Corroborado por isDiySite → 25:
    const withDiy = scoreLead({
      painDetected: true,
      painType: "outdated_website",
      techStack: { isDiySite: true },
    });
    expect(pts(withDiy.breakdown, "pain")).toBe(25);
    // Corroborado por freshness obsoleto (<50) → 25:
    const withStale = scoreLead({
      painDetected: true,
      painType: "diy_website",
      freshnessData: { freshnessScore: 20 },
    });
    expect(pts(withStale.breakdown, "pain")).toBe(25);
    // Dolor NO web + isDiySite → sin bonus (solo dolor web se corrobora):
    const nonWeb = scoreLead({
      painDetected: true,
      painType: "no_contact_info",
      techStack: { isDiySite: true },
    });
    expect(pts(nonWeb.breakdown, "pain")).toBe(20);
    // painDetected=false con painType → 0:
    const noPain = scoreLead({ painDetected: false, painType: "outdated_website", techStack: { isDiySite: true } });
    expect(pts(noPain.breakdown, "pain")).toBe(0);
    // painDetected=true sin painType → 0:
    const noType = scoreLead({ painDetected: true });
    expect(pts(noType.breakdown, "pain")).toBe(0);
  });

  it("techStack: isDiySite=10, isProSite=5, ninguno=0 (DIY tiene prioridad si ambos)", () => {
    expect(pts(scoreLead({ techStack: { isDiySite: true } }).breakdown, "tech_stack")).toBe(10);
    expect(pts(scoreLead({ techStack: { isProSite: true } }).breakdown, "tech_stack")).toBe(5);
    expect(pts(scoreLead({ techStack: { isDiySite: true, isProSite: true } }).breakdown, "tech_stack")).toBe(10);
    expect(pts(scoreLead({ techStack: {} }).breakdown, "tech_stack")).toBe(0);
    expect(pts(scoreLead({ techStack: { isDiySite: false, isProSite: false } }).breakdown, "tech_stack")).toBe(0);
    expect(pts(scoreLead({}).breakdown, "tech_stack")).toBe(0);
  });

  it("tier y nicheFit: escala completa y normalización TIER_A/A", () => {
    expect(scoreLead({ tier: "TIER_A" }).score).toBe(25);
    expect(scoreLead({ tier: "A" }).score).toBe(25);
    expect(scoreLead({ tier: "TIER_B" }).score).toBe(20);
    expect(scoreLead({ tier: "TIER_C" }).score).toBe(15);
    expect(scoreLead({ tier: "TIER_D" }).score).toBe(10);
    expect(scoreLead({ tier: "TIER_E" }).score).toBe(5);
    expect(scoreLead({ tier: "TIER_F" }).score).toBe(0);
    expect(scoreLead({ tier: "PENDING" }).score).toBe(0);
    expect(scoreLead({}).score).toBe(0);
    expect(scoreLead({ nicheFit: "high" }).score).toBe(15);
    expect(scoreLead({ nicheFit: "medium" }).score).toBe(10);
    expect(scoreLead({ nicheFit: "low" }).score).toBe(5);
    expect(scoreLead({ nicheFit: "none" }).score).toBe(0);
    expect(scoreLead({ nicheFit: "whatever" }).score).toBe(0);
  });
});
