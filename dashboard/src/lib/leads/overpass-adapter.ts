// ============================================================
// src/lib/leads/overpass-adapter.ts
// OpenStreetMap Overpass API adapter — REAL public business data,
// no API key required, no rate limits that matter for normal use.
// Uses Nominatim for city→coords geocoding (also OSM, free).
// ============================================================

import type { LeadSourceAdapter, RawProspect, SearchInput } from "./types";
import type { ProviderError, ProviderErrorCode, ProviderResult } from "./envelope";
import { classifyHttpError, providerFail, providerMeta, providerOk } from "./envelope";

// P1 · Contrato 7: nombre de proveedor ESTABLE para el envelope/meta
// (adapter.name se conserva como etiqueta legible para la UI).
const PROVIDER = "overpass";

// P1: los fetch no tenían timeout → 15s por llamada (contrato 7).
const DEFAULT_TIMEOUT_MS = 15_000;

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.fr/api/interpreter",
];

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

// Minimal shape of the Overpass API response elements we consume.
interface OverpassElement {
  type: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

/**
 * fetch con AbortController (15s). Al vencer el plazo el fetch rechaza
 * con el motivo del abort (Error "timeout tras …ms"), que el clasificador
 * traduce a TIMEOUT. Nunca lanza por decisión propia: solo propaga el
 * error del fetch para que el llamador lo clasifique.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new Error(`timeout tras ${timeoutMs}ms`)),
    timeoutMs
  );
  if (typeof timer.unref === "function") timer.unref();
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Clasifica un error de red/abort en la taxonomía del contrato 7:
 * abort/timeout → TIMEOUT · TypeError/ENOTFOUND/ECONNREFUSED → UNAVAILABLE
 * · cualquier otro → UNKNOWN.
 */
function classifyNetworkError(e: unknown): {
  code: ProviderErrorCode;
  message: string;
} {
  if (e instanceof Error) {
    const msg = e.message || e.name || String(e);
    if (
      e.name === "AbortError" ||
      e.name === "TimeoutError" ||
      /timeout|timed out/i.test(msg)
    ) {
      return { code: "TIMEOUT", message: msg };
    }
    if (
      e instanceof TypeError ||
      /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network/i.test(
        msg
      )
    ) {
      return { code: "UNAVAILABLE", message: msg };
    }
    return { code: "UNKNOWN", message: msg };
  }
  return { code: "UNKNOWN", message: String(e) };
}

/**
 * Resultado de la geocodificación Nominatim, clasificado para el envelope:
 * - ok      → bounding box lista
 * - empty   → Nominatim respondió 200 sin resultados (ciudad desconocida)
 * - error   → fallo HTTP/red/timeout, con ProviderError ya clasificado
 */
type GeocodeOutcome =
  | { status: "ok"; bb: BoundingBox; calls: 1 }
  | { status: "empty"; calls: 1 }
  | { status: "error"; error: ProviderError; calls: 1 };

async function geocodeCity(
  city: string,
  country?: string
): Promise<GeocodeOutcome> {
  const q = [city, country].filter(Boolean).join(", ");
  const url = `${NOMINATIM_ENDPOINT}?q=${encodeURIComponent(
    q
  )}&format=json&limit=1&accept-language=es`;
  try {
    const r = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "AGENTE-LEADS/1.0 (B2B prospecting; contact: dev)",
      },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => undefined);
      console.error(
        `[Overpass] geocode failed: HTTP ${r.status}`
      );
      return {
        status: "error",
        error: classifyHttpError(PROVIDER, r.status, body),
        calls: 1,
      };
    }
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) return { status: "empty", calls: 1 };
    const bb = data[0].boundingbox;
    if (!bb) return { status: "empty", calls: 1 };
    // Nominatim returns boundingbox as [south, north, west, east] as strings
    return {
      status: "ok",
      calls: 1,
      bb: {
        south: parseFloat(bb[0]),
        north: parseFloat(bb[1]),
        west: parseFloat(bb[2]),
        east: parseFloat(bb[3]),
      },
    };
  } catch (e) {
    const classified = classifyNetworkError(e);
    console.error("[Overpass] geocode failed:", classified.message);
    return {
      status: "error",
      error: {
        provider: PROVIDER,
        code: classified.code,
        message: `geocodificación Nominatim: ${classified.message}`,
        retryable: classified.code === "TIMEOUT" || classified.code === "UNAVAILABLE",
      },
      calls: 1,
    };
  }
}

function buildOverpassQuery(
  bb: BoundingBox,
  category?: string,
  keywords?: string
): string {
  // Map common service categories to OSM tags.
  // Ordered list of [trigger, osmTagFilters] entries: the first trigger contained
  // in the (category + keywords) string wins, so order matters (Record/Object
  // would lose the documented iteration contract).
  const tagMap: Array<[string, string[]]> = [
    ["clínica", ['["amenity"="clinic"]', '["healthcare"="clinic"]', '["healthcare"="doctor"]']],
    ["clinic", ['["amenity"="clinic"]', '["healthcare"="clinic"]']],
    ["estética", ['["amenity"="clinic"]', '["healthcare"="clinic"]', '["beauty"="yes"]']],
    ["restaurante", ['["amenity"="restaurant"]']],
    ["restaurant", ['["amenity"="restaurant"]']],
    ["odontolog", ['["amenity"="dentist"]', '["healthcare"="dentist"]']],
    ["dentista", ['["amenity"="dentist"]', '["healthcare"="dentist"]']],
    ["abogado", ['["office"="lawyer"]']],
    ["lawyer", ['["office"="lawyer"]']],
    ["inmobiliaria", ['["office"="estate_agent"]']],
    ["farmacia", ['["amenity"="pharmacy"]']],
    ["pharmacy", ['["amenity"="pharmacy"]']],
    ["gym", ['["leisure"="fitness_centre"]', '["leisure"="sports_centre"]']],
    ["spa", ['["leisure"="spa"]', '["shop"="massage"]']],
    ["hotel", ['["tourism"="hotel"]']],
    ["peluquería", ['["shop"="hairdresser"]']],
    ["bar", ['["amenity"="bar"]', '["amenity"="pub"]']],
    ["café", ['["amenity"="cafe"]']],
    ["cafe", ['["amenity"="cafe"]']],
    ["tienda", ['["shop"="supermarket"]', '["shop"="convenience"]']],
    ["centro médico", ['["amenity"="clinic"]', '["amenity"="doctors"]']],
  ];

  let tags: string[] = [];
  const cat = (category || "").toLowerCase();
  const kws = (keywords || "").toLowerCase();

  // Try to find a matching tag in either category or keywords
  const combined = `${cat} ${kws}`;
  for (const [trigger, t] of tagMap) {
    if (combined.includes(trigger)) {
      tags = t;
      break;
    }
  }

  // Fallback: if nothing matched, default to clinics (since the demo niche is estética)
  if (tags.length === 0) {
    tags = ['["amenity"="clinic"]', '["healthcare"="clinic"]'];
  }

  const bbox = `${bb.south},${bb.west},${bb.north},${bb.east}`;
  // Build query: union of all matching tags, return with metadata
  const filters = tags.map((t) => `node${t}(${bbox}); way${t}(${bbox});`).join(" ");
  return `[out:json][timeout:25];(${filters}); out center tags 50;`;
}

function extractProspect(
  el: OverpassElement,
  city: string,
  country: string
): RawProspect | null {
  const tags = el.tags || {};
  const name = tags.name || tags["name:es"] || tags.brand;
  if (!name) return null;

  const phone =
    tags.phone || tags["contact:phone"] || tags["phone:es"] || undefined;
  const email =
    tags.email || tags["contact:email"] || undefined;
  const website =
    tags.website || tags["contact:website"] || tags.url || undefined;
  const address = tags["addr:street"]
    ? `${tags["addr:street"] || ""} ${
        tags["addr:housenumber"] || ""
      }`.trim()
    : undefined;
  const category =
    tags.healthcare ||
    tags.amenity ||
    tags.office ||
    tags.shop ||
    tags.leisure ||
    "negocio";

  const social: NonNullable<RawProspect["socialLinks"]> = {};
  if (tags["contact:instagram"] || tags.instagram)
    social.instagram = tags["contact:instagram"] || tags.instagram;
  if (tags["contact:facebook"] || tags.facebook)
    social.facebook = tags["contact:facebook"] || tags.facebook;
  if (tags["contact:twitter"] || tags.twitter)
    social.twitter = tags["contact:twitter"] || tags.twitter;
  if (tags["contact:linkedin"] || tags.linkedin)
    social.linkedin = tags["contact:linkedin"] || tags.linkedin;

  // Description from available tags
  const descParts = [
    tags.description,
    tags["description:es"],
    tags.cuisine ? `Cocina: ${tags.cuisine}` : null,
    tags.specialty ? `Especialidad: ${tags.specialty}` : null,
    tags.healthcare ? `Tipo: ${tags.healthcare}` : null,
    tags["opening_hours"] ? `Horario: ${tags["opening_hours"]}` : null,
  ].filter(Boolean);
  const description = descParts.join(". ") || undefined;

  // Source URL: link to OSM
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  const sourceUrl =
    lat && lon
      ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`
      : `https://www.openstreetmap.org/`;

  return {
    name,
    category: category.charAt(0).toUpperCase() + category.slice(1),
    city,
    country,
    address,
    website,
    phone,
    email,
    socialLinks: Object.keys(social).length ? social : undefined,
    description,
    source: "openstreetmap",
    sourceUrl,
  };
}

export const OverpassLeadSourceAdapter: LeadSourceAdapter = {
  name: "OpenStreetMap",
  description:
    "Fuente real de datos públicos: OpenStreetMap (Overpass API). GRATUITA, sin API key. Devuelve negocios reales con teléfono, web, dirección y redes sociales cuando estén disponibles en OSM.",

  async isConfigured() {
    return true;
  },

  async search(input: SearchInput): Promise<ProviderResult<RawProspect[]>> {
    const startedAt = Date.now();
    let calls = 0; // geocode + intentos Overpass (incluye failover)
    const country = input.country || "";

    // Step 1: geocode the city to get bounding box
    const geo = await geocodeCity(input.city, country);
    calls += geo.calls;
    if (geo.status === "error") {
      // P1 · Contrato 7: fallo HTTP/red/timeout del geocoder → envelope de error.
      return providerFail(PROVIDER, geo.error.code, geo.error.message, {
        httpStatus: geo.error.httpStatus,
        meta: providerMeta(PROVIDER, calls, Date.now() - startedAt),
      });
    }
    if (geo.status === "empty") {
      // P1 · Contrato 7: 200 sin resultados → ok con data:[] (EMPTY).
      return providerOk([], providerMeta(PROVIDER, calls, Date.now() - startedAt));
    }
    const bb = geo.bb;

    // Step 2: build Overpass query
    const query = buildOverpassQuery(bb, input.category, input.keywords);

    // Step 3: query Overpass (try multiple endpoints in case one is down)
    let data: OverpassResponse | null = null;
    let lastError: ProviderError | null = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        calls++;
        const r = await fetchWithTimeout(endpoint, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: `data=${encodeURIComponent(query)}`,
        });
        if (!r.ok) {
          const body = await r.text().catch(() => undefined);
          console.warn(`[Overpass] ${endpoint} returned ${r.status}`);
          lastError = classifyHttpError(PROVIDER, r.status, body);
          continue;
        }
        data = await r.json();
        break;
      } catch (e) {
        const classified = classifyNetworkError(e);
        console.warn(`[Overpass] ${endpoint} failed:`, classified.message);
        lastError = {
          provider: PROVIDER,
          code: classified.code,
          message: classified.message,
          retryable: classified.code === "TIMEOUT" || classified.code === "UNAVAILABLE",
        };
        continue;
      }
    }

    if (!data) {
      // P1 · Contrato 7: todos los endpoints fallaron → envelope de error
      // con el último fallo clasificado (antes se devolvía [] silencioso).
      const err: ProviderError = lastError ?? {
        provider: PROVIDER,
        code: "UNAVAILABLE",
        message: "todos los endpoints de Overpass fallaron",
        retryable: true,
      };
      console.warn("[Overpass] all endpoints failed or returned empty");
      return providerFail(PROVIDER, err.code, err.message, {
        httpStatus: err.httpStatus,
        meta: providerMeta(PROVIDER, calls, Date.now() - startedAt),
      });
    }

    // Step 4: extract prospects (200 válido, sin elementos → data:[])
    const elements = data?.elements ?? [];
    const prospects: RawProspect[] = [];
    const seen = new Set<string>();
    for (const el of elements) {
      const p = extractProspect(el, input.city, country);
      if (p && !seen.has(p.name)) {
        seen.add(p.name);
        prospects.push(p);
      }
    }

    // Rate-limit Nominatim be nice (1 req per search)
    // P1 · Contrato 7: éxito con meta de coste (geocode + llamadas Overpass).
    return providerOk(
      prospects,
      providerMeta(PROVIDER, calls, Date.now() - startedAt)
    );
  },
};
