// ============================================================
// src/lib/leads/__tests__/overpass-adapter.test.ts
// Unit tests for the OpenStreetMap Overpass adapter.
//
// SCOPE (documented): `buildOverpassQuery` and `extractProspect` are
// module-private, so they are exercised through the exported top-level
// `OverpassLeadSourceAdapter.search()` with global fetch mocked —
// zero network access (Nominatim geocoding + Overpass POST are both stubbed).
// This pins: the generated OverpassQL for city+category inputs, the
// no-match fallback tags, endpoint failover, and the element→prospect
// parsing (name/phone/website/social/address, dedup by name).
// P1 · Contrato 7: se fija además el envelope ProviderResult —
// ok/data/meta en éxito, ok:false + error{code} en fallo (nunca lanza).
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverpassLeadSourceAdapter } from "../overpass-adapter";
import type { RawProspect, SearchInput } from "../types";

const NOMINATIM_PREFIX = "https://nominatim.openstreetmap.org";

// Nominatim boundingbox format: [south, north, west, east] as strings.
const NOMINATIM_BOUNDINGBOX = ["-34.71", "-34.53", "-58.58", "-58.34"];

// Query bbox as rendered by the adapter: `${south},${west},${north},${east}`
const BB = "-34.71,-58.58,-34.53,-58.34";

// Overpass payload sample: nodes + ways with name/phone/website/social tags.
const OVERPASS_PAYLOAD = {
  elements: [
    {
      type: "node",
      id: 1,
      lat: -34.6,
      lon: -58.4,
      tags: {
        name: "Clínica Alemana",
        amenity: "clinic",
        phone: "+5622123456",
        website: "https://clinica-alemana.example",
        "contact:instagram": "@clinica.alemana",
      },
    },
    {
      // Same name as element 1 → must be deduped.
      type: "way",
      id: 2,
      center: { lat: -34.61, lon: -58.41 },
      tags: { name: "Clínica Alemana", phone: "+5622123456" },
    },
    {
      // No name tag → must be dropped.
      type: "node",
      id: 3,
      lat: -34.62,
      lon: -58.42,
      tags: { amenity: "clinic" },
    },
    {
      type: "node",
      id: 4,
      lat: -34.63,
      lon: -58.43,
      tags: {
        name: "Centro Médico Sur",
        "contact:website": "https://centromedicosur.example",
        "addr:street": "Av. Providencia",
        "addr:housenumber": "742",
      },
    },
  ],
};

type OverpassRoute = () => Response | Promise<Response>;

function stubFetch(routes: {
  geocode?: OverpassRoute;
  overpass?: OverpassRoute;
  onOverpassBody?: (body: string) => void;
}): ReturnType<typeof vi.fn> {
  return vi.fn(
    async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const u = String(url);
      if (u.startsWith(NOMINATIM_PREFIX)) {
        const route = routes.geocode;
        if (!route) throw new Error("unexpected geocode call");
        return route();
      }
      // Overpass POST: the adapter sends `data=<urlencoded QL>` as body.
      routes.onOverpassBody?.(String(init?.body ?? ""));
      const route = routes.overpass;
      if (!route) throw new Error("unexpected overpass call");
      return route();
    }
  );
}

const okJson = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("OverpassLeadSourceAdapter", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("isConfigured() is always true (public API, no key)", async () => {
    await expect(OverpassLeadSourceAdapter.isConfigured()).resolves.toBe(true);
  });

  it("builds the expected OverpassQL for a city + category search", async () => {
    const bodies: string[] = [];
    const fetchMock = stubFetch({
      geocode: () =>
        okJson([{ boundingbox: NOMINATIM_BOUNDINGBOX }]),
      overpass: () => okJson(OVERPASS_PAYLOAD),
      onOverpassBody: (b) => bodies.push(b),
    });
    vi.stubGlobal("fetch", fetchMock);

    const input: SearchInput = {
      city: "Santiago",
      country: "CL",
      category: "Clínica", // capitalized on purpose → adapter lowercases it
    };
    const result = await OverpassLeadSourceAdapter.search(input);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Geocode call hits Nominatim search with q=city,country
    const [geocodeUrl] = fetchMock.mock.calls[0] as [string];
    expect(geocodeUrl).toBe(
      `${NOMINATIM_PREFIX}/search?q=Santiago%2C%20CL&format=json&limit=1&accept-language=es`
    );

    // Overpass call hits the first endpoint, body is `data=<urlencoded QL>`
    const [overpassUrl, overpassInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(overpassUrl).toBe("https://overpass-api.de/api/interpreter");
    expect(overpassInit.method).toBe("POST");
    expect(bodies).toHaveLength(1);
    expect(bodies[0].startsWith("data=")).toBe(true);

    const ql = decodeURIComponent(bodies[0].slice("data=".length));
    // "clínica" maps to 3 OSM tag filters → node+way per tag over the bbox
    expect(ql).toBe(
      `[out:json][timeout:25];(` +
        `node["amenity"="clinic"](${BB}); way["amenity"="clinic"](${BB}); ` +
        `node["healthcare"="clinic"](${BB}); way["healthcare"="clinic"](${BB}); ` +
        `node["healthcare"="doctor"](${BB}); way["healthcare"="doctor"](${BB});` +
        `); out center tags 50;`
    );

    // Parsing still happened on the Overpass payload (dedup + drop unnamed)
    expect(result.ok).toBe(true);
    const prospects = result.ok ? result.data : [];
    expect(prospects).toHaveLength(2);
    // P1 · Contrato 7: meta de coste — 1 geocode + 1 overpass
    if (result.ok) {
      expect(result.meta.provider).toBe("overpass");
      expect(result.meta.calls).toBe(2);
      expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("falls back to clinic tags when category/keywords match no trigger", async () => {
    const bodies: string[] = [];
    const fetchMock = stubFetch({
      geocode: () => okJson([{ boundingbox: NOMINATIM_BOUNDINGBOX }]),
      overpass: () => okJson({ elements: [] }),
      onOverpassBody: (b) => bodies.push(b),
    });
    vi.stubGlobal("fetch", fetchMock);

    await OverpassLeadSourceAdapter.search({
      city: "Santiago",
      category: "heladería artesanal",
      keywords: "premium",
    });

    const ql = decodeURIComponent(bodies[0].slice("data=".length));
    expect(ql).toBe(
      `[out:json][timeout:25];(` +
        `node["amenity"="clinic"](${BB}); way["amenity"="clinic"](${BB}); ` +
        `node["healthcare"="clinic"](${BB}); way["healthcare"="clinic"](${BB});` +
        `); out center tags 50;`
    );
  });

  it("parses Overpass elements into prospects (tags → fields, dedup by name)", async () => {
    const fetchMock = stubFetch({
      geocode: () => okJson([{ boundingbox: NOMINATIM_BOUNDINGBOX }]),
      overpass: () => okJson(OVERPASS_PAYLOAD),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await OverpassLeadSourceAdapter.search({
      city: "Santiago",
      country: "CL",
      category: "clínica",
    });
    expect(result.ok).toBe(true);
    const prospects: RawProspect[] = result.ok ? result.data : [];

    // 4 elements → 1 deduped (same name) + 1 dropped (no name) = 2 prospects
    expect(prospects).toHaveLength(2);

    expect(prospects[0]).toMatchObject({
      name: "Clínica Alemana",
      category: "Clinic", // amenity tag, capitalized
      city: "Santiago",
      country: "CL",
      phone: "+5622123456",
      website: "https://clinica-alemana.example",
      source: "openstreetmap",
      socialLinks: { instagram: "@clinica.alemana" },
    });
    expect(prospects[0].sourceUrl).toContain("#map=18/-34.6/-58.4");

    expect(prospects[1]).toMatchObject({
      name: "Centro Médico Sur",
      category: "Negocio", // no category tags → fallback label
      address: "Av. Providencia 742",
      website: "https://centromedicosur.example", // from contact:website
      phone: undefined,
      source: "openstreetmap",
    });
    expect(prospects[1].sourceUrl).toContain("#map=18/-34.63/-58.43");
  });

  it("returns envelope !ok UNAVAILABLE when the city cannot be geocoded (HTTP 500, no Overpass call)", async () => {
    const fetchMock = stubFetch({
      geocode: () => okJson("nominatim error", 500),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await OverpassLeadSourceAdapter.search({
      city: "Nowhereville",
      category: "clínica",
    });

    // P1 · Contrato 7: fallo HTTP del geocoder → envelope clasificado
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.provider).toBe("overpass");
      expect(result.error.code).toBe("UNAVAILABLE");
      expect(result.error.httpStatus).toBe(500);
      expect(result.error.retryable).toBe(true);
      expect(result.meta?.calls).toBe(1); // solo el intento de geocode
    }
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the geocode attempt
  });

  it("returns envelope ok:true data:[] when Nominatim answers 200 with no results (EMPTY)", async () => {
    const fetchMock = stubFetch({
      geocode: () => okJson([]),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await OverpassLeadSourceAdapter.search({
      city: "Nowhereville",
      category: "clínica",
    });

    // P1 · Contrato 7: 200 sin resultados → ok:true con data:[]
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
      expect(result.meta.calls).toBe(1);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns envelope !ok UNAVAILABLE after trying all Overpass endpoints when they all fail", async () => {
    const fetchMock = stubFetch({
      geocode: () => okJson([{ boundingbox: NOMINATIM_BOUNDINGBOX }]),
      overpass: () => {
        throw new Error("ECONNREFUSED");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await OverpassLeadSourceAdapter.search({
      city: "Santiago",
      category: "clínica",
    });

    // P1 · Contrato 7: antes devolvía [] silencioso; ahora el fallo es visible
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAVAILABLE");
      expect(result.error.message).toContain("ECONNREFUSED");
      expect(result.meta?.calls).toBe(4); // 1 geocode + 3 endpoints
    }
    expect(fetchMock).toHaveBeenCalledTimes(4); // 1 geocode + 3 endpoints
  });

  it("classifies abort/timeout as TIMEOUT after exhausting all endpoints", async () => {
    const fetchMock = stubFetch({
      geocode: () => okJson([{ boundingbox: NOMINATIM_BOUNDINGBOX }]),
      overpass: () => {
        const e = new Error("timeout tras 15000ms");
        e.name = "AbortError";
        throw e;
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await OverpassLeadSourceAdapter.search({
      city: "Santiago",
      category: "clínica",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TIMEOUT");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("fails over to the next endpoint when the first returns 5xx and counts every attempt", async () => {
    const fetchMock = stubFetch({
      geocode: () => okJson([{ boundingbox: NOMINATIM_BOUNDINGBOX }]),
      overpass: (() => {
        let n = 0;
        return () => {
          n++;
          if (n === 1) return okJson("overpass saturado", 503);
          return okJson(OVERPASS_PAYLOAD);
        };
      })(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await OverpassLeadSourceAdapter.search({
      city: "Santiago",
      category: "clínica",
    });

    // P1 · Contrato 7: el failover interno se conserva — el 2º endpoint responde
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      // 1 geocode + 2 intentos overpass (1º falló con 503)
      expect(result.meta.calls).toBe(3);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
