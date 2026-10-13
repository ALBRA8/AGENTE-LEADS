// ============================================================
// src/lib/ai/__tests__/qualification.test.ts
// Tests P2-QUAL para qualifyProspect (rewire determinista + LLM).
//
// El cliente LLM (aiChat) se mockea SIEMPRE: en tests nunca se
// llama a la API real. Cobertura:
//   1. LLM responde narrativa → merge correcto: tier/pain/nicheFit/
//      señales SIEMPRE del determinista aunque el LLM proponga otros.
//   2. painEvidence: literal comprobable manda sobre la narrativa;
//      narrativa manda sobre evidence derivada; sin pain no hay evidence.
//   3. LLM lanza → resultado determinista intacto con details de fallback.
//   4. LLM devuelve JSON roto → determinista intacto.
//   5. El prompt pide SOLO narrativa y declara la calificación
//      determinista como NO MODIFICABLE.
//   6. TIER_F por descalificación se preserva ante cualquier salida del LLM.
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../client", () => ({ aiChat: vi.fn() }));

import { aiChat } from "../client";
import { qualifyProspect, determineQualification } from "../qualification";
import type { OfferContext, ProspectContext } from "../qualification";

const mockAiChat = vi.mocked(aiChat);

// ── Builders ────────────────────────────────────────────────────────
function offer(over: Partial<OfferContext> = {}): OfferContext {
  return { name: "Web Pro", description: "Diseño web profesional", ...over };
}

function prospect(over: Partial<ProspectContext> = {}): ProspectContext {
  return {
    name: "Clínica Dental Sonrisa",
    website: "https://sonrisa.com",
    category: "Clínica Dental",
    ...over,
  };
}

// Prospecto: fit medium (1 nicho) + pain freshness → determinista TIER_C.
function deterministicInput(): { offer: OfferContext; prospect: ProspectContext } {
  return {
    offer: offer({ targetNiches: "dental, gimnasio" }),
    prospect: prospect({
      description: "odontología general",
      freshnessData: {
        freshnessScore: 18,
        comprobableEvidence: "Last-Modified: 2019-03-01 (hace 6 años)",
      },
    }),
  };
}

/** Respuesta narrativa "correcta" (solo narrativa, sin campos estructurales). */
const NARRATIVA_OK = JSON.stringify({
  nicheFitReason: "Encaja parcialmente: es una clínica dental pero sin gimnasio.",
  painEvidenceNarrative: "El sitio lleva años sin actualizar según la evidencia adjunta.",
  details: "Prospecto con web desactualizada y encaje parcial.",
});

beforeEach(() => {
  mockAiChat.mockReset();
});

describe("qualifyProspect — LLM aporta narrativa (merge)", () => {
  it("tier/pain/nicheFit SIEMPRE del determinista aunque el LLM proponga otros", async () => {
    const { offer: o, prospect: p } = deterministicInput();
    // El LLM "alucina" queriendo cambiar la calificación estructural:
    mockAiChat.mockResolvedValueOnce(
      JSON.stringify({
        tier: "TIER_A",
        nicheFit: "high",
        painDetected: false,
        painType: null,
        intentSignals: ["inventado"],
        disqualifyReason: null,
        nicheFitReason: "Fit alto inventado por el LLM.",
        painEvidenceNarrative: "Evidencia inventada por el LLM.",
        details: "Intento del LLM de reescribir la calificación.",
      })
    );

    const det = determineQualification(o, p);
    const r = await qualifyProspect(o, p);

    // Estructural: intacto, lo que diga el LLM se ignora.
    expect(r.tier).toBe(det.tier);
    expect(r.tier).toBe("TIER_C"); // medium + pain sin señal → C
    expect(r.nicheFit).toBe("medium");
    expect(r.painDetected).toBe(true);
    expect(r.painType).toBe("outdated_website");
    expect(r.intentSignals).toEqual(det.intentSignals);
    expect(r.disqualifyReason).toBeUndefined();

    // painEvidence: la literal comprobable de freshness manda sobre la narrativa.
    expect(r.painEvidence).toBe("Last-Modified: 2019-03-01 (hace 6 años)");

    // Narrativa: details del LLM + nicheFitReason incrustado + campo propio.
    expect(r.details).toContain("Intento del LLM de reescribir la calificación.");
    expect(r.details).toContain("Encaje de nicho: Fit alto inventado por el LLM.");
    expect(r.nicheFitReason).toBe("Fit alto inventado por el LLM.");

    // Auditoría: basis del determinista, siempre presente.
    expect(r.basis).toEqual(det.basis);
    expect(r.basis.length).toBeGreaterThan(0);
  });

  it("respuesta del LLM entre fences de markdown se parsea igualmente", async () => {
    const { offer: o, prospect: p } = deterministicInput();
    mockAiChat.mockResolvedValueOnce("```json\n" + NARRATIVA_OK + "\n```");

    const r = await qualifyProspect(o, p);
    expect(r.nicheFitReason).toContain("Encaja parcialmente");
    expect(r.details).toContain("Prospecto con web desactualizada y encaje parcial.");
    expect(r.details).toContain("Encaje de nicho:");
  });

  it("painEvidence: narrativa del LLM manda sobre evidence DERIVADA (no comprobable literal)", async () => {
    // Pain por regla derivada (mobile), sin comprobableEvidence en freshness.
    const o = offer({ targetNiches: "dental" });
    const p = prospect({
      description: "odontología",
      freshnessData: { isMobileResponsive: false },
    });
    mockAiChat.mockResolvedValueOnce(
      JSON.stringify({ details: "ok", painEvidenceNarrative: "Narrativa citando la evidencia." })
    );

    const r = await qualifyProspect(o, p);
    expect(r.painDetected).toBe(true);
    expect(r.painType).toBe("low_digital_maturity");
    expect(r.painEvidence).toBe("Narrativa citando la evidencia.");
  });

  it("sin pain determinista NO hay painEvidence aunque el LLM narre", async () => {
    const o = offer({ targetNiches: "dental" });
    const p = prospect({ description: "odontología" });
    mockAiChat.mockResolvedValueOnce(
      JSON.stringify({ details: "ok", painEvidenceNarrative: "Dolor inventado." })
    );

    const r = await qualifyProspect(o, p);
    expect(r.painDetected).toBe(false);
    expect(r.painEvidence).toBeUndefined();
  });

  it("el prompt pide SOLO narrativa y marca la calificación determinista como NO MODIFICABLE", async () => {
    const { offer: o, prospect: p } = deterministicInput();
    mockAiChat.mockResolvedValueOnce(NARRATIVA_OK);
    await qualifyProspect(o, p);

    expect(mockAiChat).toHaveBeenCalledTimes(1);
    const [messages] = mockAiChat.mock.calls[0];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("NO ES MODIFICABLE");
    expect(messages[0].content).toContain("nicheFitReason");
    expect(messages[0].content).toContain("painEvidenceNarrative");
    expect(messages[0].content).not.toContain('"tier"'); // ya no se le pide tier al LLM

    const userMsg = messages[1].content;
    expect(userMsg).toContain("CALIFICACIÓN DETERMINISTA YA CALCULADA (NO MODIFICABLE)");
    expect(userMsg).toContain("tier=TIER_C");
    expect(userMsg).toContain("pain=outdated_website");
    expect(userMsg).toContain("nicheFit=medium");
    expect(userMsg).toContain("tu rol es solo narrativo");
  });
});

describe("qualifyProspect — LLM falla o responde basura → determinista intacto", () => {
  it("aiChat lanza → resultado determinista con details de fallback y basis", async () => {
    const { offer: o, prospect: p } = deterministicInput();
    mockAiChat.mockRejectedValueOnce(new Error("NVIDIA_API_KEY not configured"));

    const det = determineQualification(o, p);
    const r = await qualifyProspect(o, p);

    expect(r.tier).toBe(det.tier);
    expect(r.nicheFit).toBe(det.nicheFit);
    expect(r.painDetected).toBe(det.painDetected);
    expect(r.painType).toBe(det.painType);
    expect(r.painEvidence).toBe(det.painEvidence); // evidence determinista, no narrativa
    expect(r.intentSignals).toEqual(det.intentSignals);
    expect(r.nicheFitReason).toBeUndefined();
    const hitRules = det.basis.filter((b) => b.hit).map((b) => b.rule).join(", ");
    expect(r.details).toBe(
      `Calificación determinista (IA no disponible). Reglas disparadas: ${hitRules}`
    );
    expect(r.basis).toEqual(det.basis);
    expect(r.basis.length).toBeGreaterThan(0);
  });

  it("LLM devuelve JSON roto → determinista intacto", async () => {
    const { offer: o, prospect: p } = deterministicInput();
    mockAiChat.mockResolvedValueOnce("esto no es json {{ y sin cerrar");

    const det = determineQualification(o, p);
    const r = await qualifyProspect(o, p);

    expect(r.tier).toBe(det.tier);
    expect(r.painDetected).toBe(det.painDetected);
    expect(r.painType).toBe(det.painType);
    expect(r.details).toContain("Calificación determinista (IA no disponible)");
    expect(r.details).toContain("Reglas disparadas:");
    expect(r.basis).toEqual(det.basis);
  });

  it("LLM responde JSON sin detalles útiles → fallback determinista en details", async () => {
    const { offer: o, prospect: p } = deterministicInput();
    mockAiChat.mockResolvedValueOnce(JSON.stringify({ tier: "TIER_A", details: "   " }));

    const r = await qualifyProspect(o, p);
    expect(r.details).toContain("Calificación determinista (IA no disponible)");
    expect(r.tier).not.toBe("TIER_A"); // lo estructural nunca viene del LLM
  });
});

describe("qualifyProspect — descalificaciones y businessStatus", () => {
  it("TIER_F preservado (LLM lance o no): descalificación y nicho none", async () => {
    const o = offer({ targetNiches: "dental" });
    const p = prospect({ website: null, socialLinks: null });
    mockAiChat.mockRejectedValueOnce(new Error("boom"));

    const r = await qualifyProspect(o, p);
    expect(r.tier).toBe("TIER_F");
    expect(r.disqualifyReason).toBe("sin presencia digital accionable");
    expect(r.nicheFit).toBe("none");
    expect(r.painDetected).toBe(false);
    expect(r.intentSignals).toContain("no_digital_presence");
    expect(r.basis.length).toBeGreaterThan(0);
  });

  it("prospect.businessStatus se pasa al núcleo (CLOSED_PERMANENTLY descalifica)", async () => {
    const o = offer({ targetNiches: "dental" });
    const p = prospect({ businessStatus: "CLOSED_PERMANENTLY" });
    mockAiChat.mockResolvedValueOnce(NARRATIVA_OK);

    const r = await qualifyProspect(o, p);
    expect(r.tier).toBe("TIER_F");
    expect(r.disqualifyReason).toBe(
      "negocio cerrado permanentemente (Google Business Status)"
    );
  });

  it("sin nichos definidos → medium documentado también a través de qualifyProspect", async () => {
    const o = offer(); // sin targetNiches
    const p = prospect();
    mockAiChat.mockResolvedValueOnce(NARRATIVA_OK);

    const r = await qualifyProspect(o, p);
    expect(r.nicheFit).toBe("medium");
    const nicheRule = r.basis.find((b) => b.rule === "nichefit:keyword_match");
    expect(nicheRule?.detail).toContain("sin nichos definidos");
  });
});

describe("qualifyProspect — alias re-exportado", () => {
  it("determineQualification desde qualification.ts es el núcleo determinista", () => {
    const o = offer({ targetNiches: "dental, gimnasio" });
    const p = prospect({ description: "también gimnasio" });
    const r = determineQualification(o, p);
    expect(r.tier).toBeDefined();
    expect(r.basis.length).toBeGreaterThan(0);
    expect(r.intentSignals).toBeInstanceOf(Array);
  });
});
