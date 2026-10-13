// ============================================================
// src/lib/leads/__tests__/fallback.test.ts
// P1 · Contrato 7: searchWithFallback — cadena de adapters con envelope.
//
// Fija el comportamiento del orquestador de fuentes:
//  - éxito en el 1er adapter → retorna inmediatamente
//  - fallo (!ok) → pasa al siguiente y registra el attempt
//  - ok con 0 resultados (EMPTY) → pasa al siguiente
//  - adapter no configurado → attempt AUTH sin llamar a search()
//  - totalCalls suma meta.calls de TODOS los intentos
//  - NUNCA lanza (ni siquiera con adapters que violan el contrato)
// ============================================================
import { describe, expect, it, vi } from "vitest";
import {
  MockLeadSourceAdapter,
  searchWithFallback,
  type FallbackAttempt,
  type FallbackOutcome,
} from "../index";
import { providerFail, providerMeta, providerOk } from "../envelope";
import type { ProviderErrorCode } from "../envelope";
import type { LeadSourceAdapter, RawProspect, SearchInput } from "../types";

const INPUT: SearchInput = { city: "Bogotá", country: "Colombia" };

const prospect = (name: string): RawProspect => ({
  name,
  city: "Bogotá",
  source: "test",
});

/** Fábrica de adapters de prueba con meta.calls configurable. */
function fakeAdapter(
  name: string,
  opts: {
    configured?: boolean;
    result?: () => Promise<RawProspect[]>;
    fail?: () => Promise<{
      code: ProviderErrorCode;
      message: string;
      calls?: number;
    }>;
    throwInSearch?: () => Promise<never>;
    calls?: number;
  } = {}
): LeadSourceAdapter {
  return {
    name,
    description: `adapter de prueba ${name}`,
    async isConfigured() {
      return opts.configured ?? true;
    },
    async search() {
      if (opts.throwInSearch) return opts.throwInSearch();
      if (opts.fail) {
        const f = await opts.fail();
        return providerFail<RawProspect[]>(name, f.code, f.message, {
          meta: providerMeta(name, f.calls ?? 1, 5),
        });
      }
      const data = opts.result ? await opts.result() : [];
      return providerOk(data, providerMeta(name, opts.calls ?? 1, 5));
    },
  };
}

function attemptFor(
  outcome: FallbackOutcome,
  provider: string
): FallbackAttempt | undefined {
  return outcome.attempts.find((a) => a.provider === provider);
}

describe("searchWithFallback", () => {
  it("retorna inmediatamente cuando el 1er adapter tiene datos", async () => {
    const a1 = fakeAdapter("primero", {
      result: async () => [prospect("P1"), prospect("P2")],
      calls: 2,
    });
    const a2 = fakeAdapter("segundo", {
      result: async () => [prospect("X")],
    });
    const a2Spy = vi.spyOn(a2, "search");

    const outcome = await searchWithFallback([a1, a2], INPUT);

    expect(outcome.succeededProvider).toBe("primero");
    expect(outcome.totalCalls).toBe(2); // solo se ejecutó el 1º
    expect(a2Spy).not.toHaveBeenCalled();
    expect(outcome.attempts).toEqual([
      { provider: "primero", ok: true, count: 2 },
    ]);
    expect(outcome.result.ok).toBe(true);
    if (outcome.result.ok) {
      expect(outcome.result.data.map((p) => p.name)).toEqual(["P1", "P2"]);
      expect(outcome.result.meta.provider).toBe("primero");
    }
  });

  it("pasa al 2º adapter cuando el 1º devuelve envelope !ok y registra el fallo", async () => {
    const a1 = fakeAdapter("falla", {
      fail: async () => ({ code: "UNAVAILABLE", message: "overpass caído", calls: 3 }),
    });
    const a2 = fakeAdapter("funciona", {
      result: async () => [prospect("Del 2º")],
      calls: 1,
    });

    const outcome = await searchWithFallback([a1, a2], INPUT);

    expect(outcome.succeededProvider).toBe("funciona");
    // P1: trazabilidad de coste — se suman las llamadas de TODOS los intentos
    expect(outcome.totalCalls).toBe(4); // 3 (fallo con meta) + 1 (éxito)
    expect(outcome.attempts).toHaveLength(2);
    const failed = attemptFor(outcome, "falla");
    expect(failed).toMatchObject({
      provider: "falla",
      ok: false,
      code: "UNAVAILABLE",
      message: "overpass caído",
    });
    expect(outcome.result.ok).toBe(true);
    if (outcome.result.ok) {
      expect(outcome.result.data).toHaveLength(1);
      expect(outcome.result.meta.provider).toBe("funciona");
    }
  });

  it("todos EMPTY → devuelve el último EMPTY con attempts acumulados y sin succeededProvider", async () => {
    const a1 = fakeAdapter("vacio1", { result: async () => [] });
    const a2 = fakeAdapter("vacio2", { result: async () => [], calls: 2 });

    const outcome = await searchWithFallback([a1, a2], INPUT);

    expect(outcome.succeededProvider).toBeUndefined();
    expect(outcome.totalCalls).toBe(3); // 1 + 2
    expect(outcome.attempts).toEqual([
      { provider: "vacio1", ok: true, code: "EMPTY", count: 0, message: "sin resultados" },
      { provider: "vacio2", ok: true, code: "EMPTY", count: 0, message: "sin resultados" },
    ]);
    // El resultado es el ÚLTIMO envelope EMPTY (ok:true, data:[])
    expect(outcome.result.ok).toBe(true);
    if (outcome.result.ok) {
      expect(outcome.result.data).toEqual([]);
      expect(outcome.result.meta.provider).toBe("vacio2");
    }
  });

  it("salta los adapters no configurados con attempt AUTH (sin llamar a search)", async () => {
    const a0 = fakeAdapter("sin_config", { configured: false });
    const a0Spy = vi.spyOn(a0, "search");
    const a1 = fakeAdapter("configurado", {
      result: async () => [prospect("OK")],
    });

    const outcome = await searchWithFallback([a0, a1], INPUT);

    expect(a0Spy).not.toHaveBeenCalled();
    expect(attemptFor(outcome, "sin_config")).toEqual({
      provider: "sin_config",
      ok: false,
      code: "AUTH",
      message: "no configurado",
    });
    expect(outcome.succeededProvider).toBe("configurado");
    expect(outcome.totalCalls).toBe(1);
  });

  it("NUNCA lanza: adapter que viola el contrato (throw) → attempt UNKNOWN y envelope de error", async () => {
    const a1 = fakeAdapter("violento", {
      throwInSearch: async () => {
        throw new Error("boom inesperado");
      },
    });
    const a2 = fakeAdapter("tambien_violento", {
      throwInSearch: async () => {
        throw "no soy un Error"; // non-Error también debe tolerarse
      },
    });

    const outcome = await searchWithFallback([a1, a2], INPUT);

    expect(outcome.attempts).toEqual([
      { provider: "violento", ok: false, code: "UNKNOWN", message: "boom inesperado" },
      { provider: "tambien_violento", ok: false, code: "UNKNOWN", message: "no soy un Error" },
    ]);
    expect(outcome.succeededProvider).toBeUndefined();
    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok) {
      // el último envelope de fallo queda como resultado
      expect(outcome.result.error.provider).toBe("tambien_violento");
      expect(outcome.result.error.code).toBe("UNKNOWN");
    }
  });

  it("sin adapters configurados → envelope EMPTY de registry sin lanzar", async () => {
    const a1 = fakeAdapter("no1", { configured: false });
    const a2 = fakeAdapter("no2", { configured: false });

    const outcome = await searchWithFallback([a1, a2], INPUT);

    expect(outcome.succeededProvider).toBeUndefined();
    expect(outcome.totalCalls).toBe(0);
    expect(outcome.attempts).toHaveLength(2);
    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok) {
      expect(outcome.result.error.provider).toBe("registry");
      expect(outcome.result.error.code).toBe("EMPTY");
      expect(outcome.result.error.message).toContain("sin adapters");
    }
  });

  it("lista vacía de adapters → envelope EMPTY de registry", async () => {
    const outcome = await searchWithFallback([], INPUT);
    expect(outcome.attempts).toEqual([]);
    expect(outcome.totalCalls).toBe(0);
    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok) {
      expect(outcome.result.error.code).toBe("EMPTY");
    }
  });

  it("funciona con el adapter mock real: marca isMock y sourceUrl indefinido (contrato 10)", async () => {
    const outcome = await searchWithFallback([MockLeadSourceAdapter], INPUT);

    expect(outcome.succeededProvider).toBe("Demo");
    // P1 · Contrato 10: el mock no hace llamadas HTTP
    expect(outcome.totalCalls).toBe(0);
    expect(outcome.result.ok).toBe(true);
    if (outcome.result.ok) {
      expect(outcome.result.data.length).toBeGreaterThan(0);
      for (const p of outcome.result.data) {
        expect(p.isMock).toBe(true);
        expect(p.sourceUrl).toBeUndefined();
      }
      expect(outcome.result.meta.provider).toBe("mock");
      expect(outcome.result.meta.calls).toBe(0);
    }
  });
});
