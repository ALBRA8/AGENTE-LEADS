// ============================================================
// src/lib/leads/__tests__/pagespeed.test.ts
// P2-PSI: regresión del módulo PageSpeed Insights v5 (contrato 5
// del plan Radar de Clientes): estados explícitos OK/UNREACHABLE/
// TIMEOUT/INVALID_URL, scores 0-100, timeout real vía signal,
// trazabilidad keyUsed y CERO fuga de la API key.
//
// SIN RED: fetch se stubbea globalmente con vi.stubGlobal y se
// restaura en afterEach. La API key de los fixtures es inventada y
// verificamos que JAMÁS aparece en el resultado ni en los errores.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  auditPageSpeed,
  normalizeTargetUrl,
  parseScores,
  PSI_DEFAULT_TIMEOUT_MS,
} from "../pagespeed";

// API key inventada (jamás una credencial real).
const API_KEY = "test-fake-psi-key-abc123def456";

const PSI_ENDPOINT_PREFIX =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?";

// ── Helpers de fetch mockeado ────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;

/** Respuesta 200 tipo PSI (solo el shape que consume el módulo). */
function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Respuesta de error HTTP con cuerpo textual. */
function errResponse(status: number, bodyText = "internal error") {
  return {
    ok: false,
    status,
    json: async () => {
      throw new Error("no-json");
    },
    text: async () => bodyText,
  };
}

/** DOMException AbortError (con fallback si el entorno no lo expone). */
function abortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const e = new Error("The operation was aborted.");
  e.name = "AbortError";
  return e;
}

/** URL de la i-ésima llamada a fetch (PSI usa GET sin body). */
function requestUrl(i = 0): string {
  const [url] = fetchMock.mock.calls[i] as [string];
  return url;
}

/**
 * Body PSI v5 con lighthouseResult.categories (scores 0..1).
 * Las claves son los nombres de categoría Lighthouse (performance,
 * seo, accessibility, "best-practices", o extras como "pwa").
 */
function psiBody(
  categoriesIn: Record<string, number | null | undefined>
): unknown {
  const categories: Record<string, { score: number | null }> = {};
  for (const [name, score] of Object.entries(categoriesIn)) {
    if (score === undefined) continue;
    categories[name] = { score };
  }
  return { lighthouseResult: { categories } };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────
// INVALID_URL: validación previa SIN red
// ─────────────────────────────────────────────────────────────
describe("auditPageSpeed — URL inválida (sin red)", () => {
  it.each(["no-es-url", "ftp://x.com", "http://", "javascript:alert(1)", "   "])(
    "%j → INVALID_URL, error descriptivo y fetch NO llamado",
    async (input) => {
      const result = await auditPageSpeed(input);

      expect(result.status).toBe("INVALID_URL");
      expect(typeof result.error).toBe("string");
      expect(result.error!.length).toBeGreaterThan(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.keyUsed).toBe(false);
      // Sin llamada no hay duración; scores vacíos; url = input recortado.
      expect(result.durationMs).toBeUndefined();
      expect(result.scores).toEqual({
        performance: null,
        seo: null,
        accessibility: null,
        bestPractices: null,
      });
      expect(result.url).toBe(input.trim());
    }
  );

  it("URL válida con espacios: se recorta y se audita la versión normalizada", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse(psiBody({ performance: 0.97, seo: 0.91, accessibility: 0.88, "best-practices": 1.0 }))
    );

    const result = await auditPageSpeed("  https://clinica-example.com/servicios  ");

    expect(result.status).toBe("OK");
    expect(result.url).toBe("https://clinica-example.com/servicios");
    expect(requestUrl()).toContain(
      `url=${encodeURIComponent("https://clinica-example.com/servicios")}`
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Éxito: mapeo del contrato 5
// ─────────────────────────────────────────────────────────────
describe("auditPageSpeed — éxito", () => {
  it("mapea scores 0..1 → 0..100, url normalizada, keyless, strategy mobile y auditedAt ISO", async () => {
    // 0.97/0.91/0.88/1.0 + una categoría extra legacy ("pwa") con score null,
    // que debe ser ignorada (solo las 4 del contrato 5 se mapean).
    fetchMock.mockResolvedValueOnce(
      okResponse(
        psiBody({
          performance: 0.97,
          seo: 0.91,
          accessibility: 0.88,
          "best-practices": 1.0,
          pwa: null,
        })
      )
    );

    const result = await auditPageSpeed("https://clinica-example.com");

    expect(result.status).toBe("OK");
    expect(result.error).toBeUndefined();
    expect(result.scores).toEqual({
      performance: 97,
      seo: 91,
      accessibility: 88,
      bestPractices: 100,
    });
    expect(result.url).toBe("https://clinica-example.com");
    expect(result.strategy).toBe("mobile");
    expect(result.keyUsed).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect((result.durationMs as number) >= 0).toBe(true);

    // auditedAt ISO-8601 parseable.
    const parsed = new Date(result.auditedAt);
    expect(parsed.getTime()).not.toBeNaN();

    // Sin key: la llamada jamás contiene key= y el endpoint/strategy son correctos.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = requestUrl();
    expect(url.startsWith(PSI_ENDPOINT_PREFIX)).toBe(true);
    expect(url).not.toContain("key=");
    expect(url).toContain("strategy=mobile");
  });

  it("categoría del contrato con score null → null en el resultado OK", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse(
        psiBody({ performance: 0.97, seo: 0.91, accessibility: 0.88, "best-practices": null })
      )
    );

    const result = await auditPageSpeed("https://clinica-example.com");

    expect(result.status).toBe("OK");
    expect(result.scores.performance).toBe(97);
    expect(result.scores.bestPractices).toBeNull();
  });

  it("strategy 'desktop' se propaga en la query y en el resultado", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(psiBody({ performance: 1 })));

    const result = await auditPageSpeed("https://clinica-example.com", {
      strategy: "desktop",
    });

    expect(result.status).toBe("OK");
    expect(result.strategy).toBe("desktop");
    expect(requestUrl()).toContain("strategy=desktop");
    expect(requestUrl()).not.toContain("strategy=mobile");
  });
});

// ─────────────────────────────────────────────────────────────
// API key: query param, keyUsed y CERO fuga de la key
// ─────────────────────────────────────────────────────────────
describe("auditPageSpeed — API key", () => {
  it("la llamada incluye &key=..., keyUsed=true y el resultado NO contiene la key", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse(psiBody({ performance: 0.5, seo: 0.5, accessibility: 0.5, "best-practices": 0.5 }))
    );

    const result = await auditPageSpeed("https://clinica-example.com", {
      apiKey: API_KEY,
    });

    expect(result.status).toBe("OK");
    expect(result.keyUsed).toBe(true);
    expect(requestUrl()).toContain(`&key=${API_KEY}`);
    // La key jamás aparece en el resultado serializado (ni en url/estrategia/etc.).
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });

  it("con error HTTP 500 y key: el error se redacta — la key jamás aparece", async () => {
    // Body de error que "ecoa" la key (defensa en profundidad).
    fetchMock.mockResolvedValueOnce(
      errResponse(500, `quota exceeded for key ${API_KEY} — daily limit`)
    );

    const result = await auditPageSpeed("https://clinica-example.com", {
      apiKey: API_KEY,
    });

    expect(result.status).toBe("UNREACHABLE");
    expect(result.keyUsed).toBe(true);
    expect(result.error).toContain("HTTP 500");
    expect(result.error).not.toContain(API_KEY);
    expect(result.error).toContain("[REDACTED]");
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });
});

// ─────────────────────────────────────────────────────────────
// Errores HTTP y de red — nunca lanza
// ─────────────────────────────────────────────────────────────
describe("auditPageSpeed — errores HTTP y red", () => {
  it("HTTP 500 → UNREACHABLE con 'HTTP 500' y extracto del body (≤200 chars)", async () => {
    const longBody = "x".repeat(500);
    fetchMock.mockResolvedValueOnce(errResponse(500, longBody));

    const result = await auditPageSpeed("https://clinica-example.com");

    expect(result.status).toBe("UNREACHABLE");
    expect(result.error!.startsWith("HTTP 500: ")).toBe(true);
    const excerpt = result.error!.slice("HTTP 500: ".length);
    expect(excerpt.length).toBeLessThanOrEqual(200);
    expect(excerpt.length).toBe(200);
    expect(typeof result.durationMs).toBe("number");
  });

  it("fetch rechaza (TypeError de red) → UNREACHABLE sin lanzar", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const result = await auditPageSpeed("https://clinica-example.com");

    expect(result.status).toBe("UNREACHABLE");
    expect(result.error).toContain("fetch failed");
    expect(result.scores).toEqual({
      performance: null,
      seo: null,
      accessibility: null,
      bestPractices: null,
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Timeout real: el mock respeta el signal del AbortController
// ─────────────────────────────────────────────────────────────
describe("auditPageSpeed — timeout", () => {
  it("Abort real vía signal (timeoutMs: 30) → TIMEOUT sin lanzar", async () => {
    // El mock cuelga la promesa hasta que el signal del módulo aborte:
    // así se ejercita el AbortController real, no solo la clasificación.
    fetchMock.mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(abortError());
            return;
          }
          signal?.addEventListener("abort", () => reject(abortError()));
        })
    );

    const result = await auditPageSpeed("https://clinica-example.com", {
      timeoutMs: 30,
    });

    expect(result.status).toBe("TIMEOUT");
    expect(result.error).toContain("30ms");
    expect(typeof result.durationMs).toBe("number");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("PSI_DEFAULT_TIMEOUT_MS es 25000 (PSI es lento)", () => {
    expect(PSI_DEFAULT_TIMEOUT_MS).toBe(25_000);
  });
});

// ─────────────────────────────────────────────────────────────
// 200 con análisis fallido / respuestas raras
// ─────────────────────────────────────────────────────────────
describe("auditPageSpeed — 200 con análisis fallido", () => {
  it("200 con body.error.message → UNREACHABLE con ese mensaje", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        error: {
          code: 500,
          message: "Lighthouse returned error: ERRLARGE_PAGE_CONTENT_BYTES",
        },
      })
    );

    const result = await auditPageSpeed("https://clinica-example.com");

    expect(result.status).toBe("UNREACHABLE");
    expect(result.error).toBe(
      "Lighthouse returned error: ERRLARGE_PAGE_CONTENT_BYTES"
    );
    expect(typeof result.durationMs).toBe("number");
  });

  it("200 sin lighthouseResult.categories → UNREACHABLE", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ analysisUTCTimestamp: "2026" }));

    const result = await auditPageSpeed("https://clinica-example.com");

    expect(result.status).toBe("UNREACHABLE");
    expect(result.error).toContain("lighthouseResult.categories");
  });

  it("200 no-JSON → UNREACHABLE sin lanzar", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token < in JSON");
      },
      text: async () => "<html>gateway</html>",
    });

    const result = await auditPageSpeed("https://clinica-example.com");

    expect(result.status).toBe("UNREACHABLE");
    expect(result.error).toContain("no parseable como JSON");
  });
});

// ─────────────────────────────────────────────────────────────
// parseScores — función pura
// ─────────────────────────────────────────────────────────────
describe("parseScores (puro)", () => {
  it("mapea scores 0..1 → 0..100 (1.0 → 100)", () => {
    expect(
      parseScores({
        categories: {
          performance: { score: 0.97 },
          seo: { score: 0.91 },
          accessibility: { score: 0.88 },
          "best-practices": { score: 1.0 },
        },
      })
    ).toEqual({ performance: 97, seo: 91, accessibility: 88, bestPractices: 100 });
  });

  it("score null, categoría ausente o no numérica → null", () => {
    expect(
      parseScores({
        categories: {
          performance: { score: null },
          seo: {},
          accessibility: { score: "0.9" },
          "best-practices": { score: NaN },
        },
      })
    ).toEqual({
      performance: null,
      seo: null,
      accessibility: null,
      bestPractices: null,
    });
  });

  it("categorías ausentes o lighthouse no-objeto → todo null", () => {
    const allNull = {
      performance: null,
      seo: null,
      accessibility: null,
      bestPractices: null,
    };
    expect(parseScores(undefined)).toEqual(allNull);
    expect(parseScores({})).toEqual(allNull);
    expect(parseScores("nope")).toEqual(allNull);
  });

  it("clamp defensivo 0..100", () => {
    expect(
      parseScores({
        categories: { performance: { score: 1.5 }, seo: { score: -0.2 } },
      })
    ).toEqual({
      performance: 100,
      seo: 0,
      accessibility: null,
      bestPractices: null,
    });
  });
});

// ─────────────────────────────────────────────────────────────
// normalizeTargetUrl — función pura
// ─────────────────────────────────────────────────────────────
describe("normalizeTargetUrl (puro)", () => {
  it("recorta espacios y conserva scheme válido", () => {
    expect(normalizeTargetUrl("  https://Example.com/ruta  ")).toBe(
      "https://Example.com/ruta"
    );
    expect(normalizeTargetUrl("http://example.com")).toBe("http://example.com");
  });

  it.each([
    "",
    "   ",
    "www.example.com", // sin scheme: NO se inventa
    "example.com",
    "ftp://x.com",
    "http://", // sin hostname
    "javascript:alert(1)",
    "file:///etc/passwd",
  ])("%j → null", (input) => {
    expect(normalizeTargetUrl(input)).toBeNull();
  });
});
