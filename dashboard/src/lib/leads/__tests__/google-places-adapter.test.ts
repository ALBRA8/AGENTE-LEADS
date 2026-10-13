// ============================================================
// src/lib/leads/__tests__/google-places-adapter.test.ts
// P1-PLACES: regresión del adapter Google Places API (New) bajo el
// contrato completo (contratos 1 y 7 del plan Radar de Clientes):
// fieldMask ampliado, keywords en textQuery, paginación nextPageToken
// (máx. 3 páginas), timeout por llamada y envelope clasificado
// {ok, data, error{code}} — el adapter NUNCA lanza.
//
// SIN RED: fetch se stubbea globalmente con vi.stubGlobal y se
// restaura en afterEach. La API key de los fixtures es inventada y
// además verificamos que NUNCA aparece en las URLs (va por header).
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GooglePlacesLeadSourceAdapter } from "../google-places-adapter";

// API key inventada (jamás una credencial real).
const API_KEY = "test-fake-places-key-000111222";

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

// ── Helpers de fetch mockeado ────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;

/** Respuesta 200 tipo Places (solo el shape que consume el adapter). */
function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Respuesta de error HTTP con cuerpo textual. */
function errResponse(status: number, bodyText = '{"error":{"message":"denied"}}') {
  return {
    ok: false,
    status,
    json: async () => JSON.parse(bodyText),
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

/** Args normalizados de la i-ésima llamada a fetch. */
function callArgs(i: number): {
  url: string;
  init: {
    method?: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  };
  body: Record<string, unknown>;
} {
  const [url, init] = fetchMock.mock.calls[i] as [
    string,
    { method?: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
  ];
  return { url, init, body: JSON.parse(init?.body ?? "{}") };
}

// ── Fixtures de Places API (New) ─────────────────────────────

const PLACE_FULL = {
  id: "ChIJexample0123456789",
  displayName: { text: "Clínica Estética Láser Bogotá" },
  formattedAddress: "Calle 100 # 15-30, Bogotá, Colombia",
  websiteUri: "https://clinica-laser-bogota.example",
  internationalPhoneNumber: "+57 601 123 4567",
  googleMapsUri: "https://maps.google.com/?cid=1234567890",
  primaryTypeDisplayName: { text: "Clínica de estética" },
  editorialSummary: { text: "Especialistas en tratamientos láser." },
  location: { latitude: 4.681, longitude: -74.045 },
  rating: 4.7,
  userRatingCount: 128,
  businessStatus: "OPERATIONAL",
};

const PLACE_B = {
  id: "ChIJother999888777",
  displayName: { text: "Dermatología Renacer" },
  formattedAddress: "Carrera 7 # 116-50, Bogotá, Colombia",
  location: { latitude: 4.7, longitude: -74.03 },
  rating: 4.2,
  userRatingCount: 51,
  businessStatus: "OPERATIONAL",
};

/** Place con ceros legítimos y campos ausentes (regresión truthiness). */
const PLACE_WITH_ZEROS = {
  id: "ChIJzeros0000000000",
  displayName: { text: "Estética Sin Reseñas" },
  location: { latitude: 0, longitude: 0 },
  rating: 0,
  userRatingCount: 0,
  businessStatus: "CLOSED_PERMANENTLY",
};

function makeAdapter(timeoutMs = 15000) {
  return new GooglePlacesLeadSourceAdapter(API_KEY, timeoutMs);
}

function baseInput() {
  return {
    city: "Bogotá",
    country: "CO",
    category: "clínica estética",
    keywords: "laser",
  };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────
// Éxito de 1 página: mapeo completo + headers + textQuery
// ─────────────────────────────────────────────────────────────
describe("GooglePlacesLeadSourceAdapter.search — éxito", () => {
  it("mapea todos los campos P1 y el envelope es ok con meta.calls=1", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ places: [PLACE_FULL] }));

    const result = await makeAdapter().search(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrowing para TS
    expect(result.data).toHaveLength(1);

    const p = result.data[0];
    expect(p.name).toBe("Clínica Estética Láser Bogotá");
    expect(p.category).toBe("Clínica de estética");
    expect(p.address).toBe("Calle 100 # 15-30, Bogotá, Colombia");
    expect(p.city).toBe("Bogotá");
    expect(p.country).toBe("CO");
    expect(p.website).toBe("https://clinica-laser-bogota.example");
    expect(p.phone).toBe("+57 601 123 4567");
    expect(p.description).toBe("Especialistas en tratamientos láser.");
    expect(p.source).toBe("google_places");
    expect(p.sourceUrl).toBe("https://maps.google.com/?cid=1234567890");
    expect(p.placeId).toBe("ChIJexample0123456789");
    expect(p.lat).toBeCloseTo(4.681);
    expect(p.lng).toBeCloseTo(-74.045);
    expect(p.rating).toBe(4.7);
    expect(p.ratingCount).toBe(128);
    expect(p.businessStatus).toBe("OPERATIONAL");
    // Contrato 10: datos reales NUNCA marcados como mock.
    expect(p.isMock).toBeUndefined();

    // Meta de coste/llamadas (contrato 7).
    expect(result.meta.calls).toBe(1);
    expect(result.meta.provider).toBe("google_places");
    expect(typeof result.meta.durationMs).toBe("number");
    expect(typeof result.meta.fetchedAt).toBe("string");
  });

  it("construye textQuery con category+keywords+city+country y headers correctos", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ places: [] }));

    await makeAdapter().search(baseInput());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init, body } = callArgs(0);

    // Endpoint correcto y API key SOLO por header (nunca en la URL).
    expect(url).toBe(PLACES_ENDPOINT);
    expect(url).not.toContain(API_KEY);
    expect(init.method).toBe("POST");
    expect(init.headers["X-Goog-Api-Key"]).toBe(API_KEY);
    const fieldMask = init.headers["X-Goog-FieldMask"];
    expect(fieldMask).toContain("places.id");
    expect(fieldMask).toContain("places.businessStatus");
    expect(fieldMask).toContain("places.location");
    expect(fieldMask).toContain("places.rating");
    expect(fieldMask).toContain("places.userRatingCount");
    expect(fieldMask).toContain("places.displayName");
    expect(fieldMask).toContain("places.websiteUri");

    // textQuery contrato 1: category + keywords + " in city, country".
    expect(body.textQuery).toBe("clínica estética laser in Bogotá, CO");
    expect(body.languageCode).toBe("es");
    expect(body.regionCode).toBe("CO");
    // La 1ª llamada NO lleva pageToken.
    expect(body.pageToken).toBeUndefined();
  });

  it("conserva valores 0 legítimos (rating/ratingCount/lat/lng) — sin truthiness", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ places: [PLACE_WITH_ZEROS] }));

    const result = await makeAdapter().search(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.data[0];
    expect(p.rating).toBe(0); // 0 es rating válido, no undefined
    expect(p.ratingCount).toBe(0);
    expect(p.lat).toBe(0);
    expect(p.lng).toBe(0);
    expect(p.businessStatus).toBe("CLOSED_PERMANENTLY");
    expect(p.placeId).toBe("ChIJzeros0000000000");
    // Campos ausentes → undefined (no strings vacíos ni null).
    expect(p.website).toBeUndefined();
    expect(p.phone).toBeUndefined();
    expect(p.description).toBeUndefined();
    expect(p.sourceUrl).toBeUndefined();
  });

  it("200 sin places (ni places no-array) → ok:true con data:[] y meta.calls=1", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({}));
    const empty = await makeAdapter().search(baseInput());
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.data).toEqual([]);
    expect(empty.meta.calls).toBe(1);

    fetchMock.mockResolvedValueOnce(okResponse({ places: "no-soy-array" }));
    const nonArray = await makeAdapter().search(baseInput());
    expect(nonArray.ok).toBe(true);
    if (!nonArray.ok) return;
    expect(nonArray.data).toEqual([]);
    expect(nonArray.meta.calls).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// Paginación nextPageToken (contrato 1)
// ─────────────────────────────────────────────────────────────
describe("GooglePlacesLeadSourceAdapter.search — paginación", () => {
  it("concatena 2 páginas, meta.calls=2 y la 2ª llamada lleva pageToken", async () => {
    fetchMock
      .mockResolvedValueOnce(
        okResponse({ places: [PLACE_FULL], nextPageToken: "TOKEN_PAGINA_2" })
      )
      .mockResolvedValueOnce(okResponse({ places: [PLACE_B] }));

    const result = await makeAdapter().search(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Resultados concatenados de ambas páginas.
    expect(result.data).toHaveLength(2);
    expect(result.data.map((p) => p.name)).toEqual([
      "Clínica Estética Láser Bogotá",
      "Dermatología Renacer",
    ]);
    expect(result.meta.calls).toBe(2);

    // 2ª llamada: mismos parámetros + pageToken (requisito de Places).
    const first = callArgs(0);
    const second = callArgs(1);
    expect(second.body.pageToken).toBe("TOKEN_PAGINA_2");
    expect(second.body.textQuery).toBe(first.body.textQuery);
    expect(second.body.languageCode).toBe(first.body.languageCode);
    expect(second.body.regionCode).toBe(first.body.regionCode);
    expect(second.url).toBe(PLACES_ENDPOINT);
  });

  it("con nextPageToken infinito se detiene en el MÁXIMO de 3 páginas", async () => {
    fetchMock.mockImplementation(async () =>
      okResponse({ places: [PLACE_FULL], nextPageToken: "TOKEN_SIGUIENTE" })
    );

    const result = await makeAdapter().search(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.calls).toBe(3); // ≈60 resultados: 3 páginas
    expect(result.data).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // 1ª sin token, 2ª y 3ª con el token de la respuesta anterior.
    expect(callArgs(0).body.pageToken).toBeUndefined();
    expect(callArgs(1).body.pageToken).toBe("TOKEN_SIGUIENTE");
    expect(callArgs(2).body.pageToken).toBe("TOKEN_SIGUIENTE");
  });
});

// ─────────────────────────────────────────────────────────────
// Clasificación de errores HTTP (contrato 7) — nunca lanza
// ─────────────────────────────────────────────────────────────
describe("GooglePlacesLeadSourceAdapter.search — errores HTTP", () => {
  it("HTTP 403 → ok:false, code AUTH, retryable false", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(403, '{"error":"permission denied"}'));

    const result = await makeAdapter().search(baseInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.provider).toBe("google_places");
    expect(result.error.code).toBe("AUTH");
    expect(result.error.retryable).toBe(false);
    expect(result.error.httpStatus).toBe(403);
    expect(result.error.message).toContain("403");
    // No reintenta ante errores HTTP: una sola llamada.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("HTTP 429 → code RATE_LIMIT, retryable true", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(429, '{"error":"quota exceeded"}'));

    const result = await makeAdapter().search(baseInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("RATE_LIMIT");
    expect(result.error.retryable).toBe(true);
    expect(result.error.httpStatus).toBe(429);
  });

  it("HTTP 500 → code UNAVAILABLE", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(500, "internal error"));

    const result = await makeAdapter().search(baseInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("UNAVAILABLE");
    expect(result.error.httpStatus).toBe(500);
  });

  it("HTTP 400 → code INVALID_INPUT (mapa de clasificación)", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(400, '{"error":"bad request"}'));

    const result = await makeAdapter().search(baseInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_INPUT");
  });
});

// ─────────────────────────────────────────────────────────────
// Fallos de red / timeout — el adapter nunca lanza
// ─────────────────────────────────────────────────────────────
describe("GooglePlacesLeadSourceAdapter.search — red y timeout", () => {
  it("fetch rechaza (TypeError de red) → ok:false UNAVAILABLE, sin lanzar", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const result = await makeAdapter().search(baseInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("UNAVAILABLE");
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).toContain("fetch failed");
  });

  it("AbortController del timeout → ok:false TIMEOUT (timeout inyectable)", async () => {
    // El mock cuelga la promesa hasta que el signal del adapter aborte:
    // así se ejercita el AbortController real (no solo la clasificación).
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

    const result = await makeAdapter(50).search(baseInput()); // timeout 50ms

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TIMEOUT");
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).toContain("50ms");
  });
});

// ─────────────────────────────────────────────────────────────
// Configuración: AUTH sin red + identidad del adapter
// ─────────────────────────────────────────────────────────────
describe("GooglePlacesLeadSourceAdapter — configuración e identidad", () => {
  it("sin API key → ok:false AUTH sin llamar a la red", async () => {
    const adapter = new GooglePlacesLeadSourceAdapter("");
    expect(await adapter.isConfigured()).toBe(false);

    const result = await adapter.search(baseInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH");
    expect(result.error.message).toContain("API key ausente");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("isConfigured exige apiKey con longitud > 10", async () => {
    expect(await new GooglePlacesLeadSourceAdapter("corta123").isConfigured()).toBe(false);
    expect(await new GooglePlacesLeadSourceAdapter("1234567890A").isConfigured()).toBe(true);
    expect(await makeAdapter().isConfigured()).toBe(true);
  });

  it("el name del adapter sigue siendo 'Google Places API' (selección por sourceAdapter)", () => {
    // El route busca el adapter por name; NO debe ser el literal "google_places".
    expect(makeAdapter().name).toBe("Google Places API");
    expect(makeAdapter().name).not.toBe("google_places");
  });

  it("sin city → INVALID_INPUT sin llamar a la red", async () => {
    const result = await makeAdapter().search({ city: "" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_INPUT");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
