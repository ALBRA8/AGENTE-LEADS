// ============================================================
// src/agent/providers/overpass_discovery.ts
// P3 — OpenStreetMap Overpass API DiscoveryProvider.
//
// Returns REAL businesses from OSM data — free, public, no API key.
// Uses Nominatim to geocode a city to a bounding box, then queries
// Overpass QL for businesses that match a category (restaurant,
// clinic, dentist, lawyer, pharmacy, hotel, spa, hairdresser, bar,
// cafe, supermarket, fitness...). Multiple Overpass endpoints are
// tried in order so a single mirror outage does not break discovery.
//
// Error taxonomy (P0.10):
//   - HTTP 429                   -> RATE_LIMIT
//   - HTTP 5xx                   -> PROVIDER_UNAVAILABLE (try next mirror)
//   - ECONNREFUSED / ENOTFOUND   -> PROVIDER_UNAVAILABLE (try next mirror)
//   - All Overpass mirrors failed -> PROVIDER_UNAVAILABLE
//   - Zero named businesses      -> EMPTY_RESULT (legitimate outcome)
//   - Network timeout            -> TIMEOUT
// ============================================================

import type {
  DiscoveryProvider,
  DiscoveryInput,
  ProviderResult,
} from "./types.js";
import type { CandidateLead } from "../core/lead.js";
import type { ProviderError } from "../core/errors.js";
import { makeError, normalizeError } from "../core/errors.js";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.fr/api/interpreter",
];

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "AGENTE-LEADS/1.0";

// 5s is short for real production use, but the task requires tests
// never hang. Real Overpass responses usually arrive within ~2-3s;
// if a mirror is slow, the next mirror is tried.
const FETCH_TIMEOUT_MS = 5_000;

/**
 * Extended input. `DiscoveryInput` (frozen by contract) has no
 * `country`/`category`/`keywords` fields, but callers may pass them —
 * they're all optional. We pick them up here so the test file at
 * `tests/overpass_discovery.test.ts` (which passes `country: "Colombia"`)
 * type-checks without modifying `types.ts`.
 */
type OverpassInput = DiscoveryInput & {
  city?: string;
  country?: string;
  category?: string;
  keywords?: string;
};

/**
 * Category -> OSM tag filters. Multiple filters per category are OR'd
 * inside the Overpass union block. Categories are matched case-insensitively
 * (lookup key is lowercased before indexing).
 */
const CATEGORY_TAGS: Record<
  string,
  Array<{ key: string; value?: string }>
> = {
  restaurant: [{ key: "amenity", value: "restaurant" }],
  restaurante: [{ key: "amenity", value: "restaurant" }],
  clinic: [
    { key: "amenity", value: "clinic" },
    { key: "healthcare", value: "clinic" },
  ],
  "clínica": [
    { key: "amenity", value: "clinic" },
    { key: "healthcare", value: "clinic" },
  ],
  dentist: [{ key: "amenity", value: "dentist" }],
  dentista: [{ key: "amenity", value: "dentist" }],
  lawyer: [{ key: "office", value: "lawyer" }],
  abogado: [{ key: "office", value: "lawyer" }],
  pharmacy: [{ key: "amenity", value: "pharmacy" }],
  farmacia: [{ key: "amenity", value: "pharmacy" }],
  hotel: [{ key: "tourism", value: "hotel" }],
  spa: [
    { key: "leisure", value: "spa" },
    { key: "shop", value: "massage" },
  ],
  hairdresser: [{ key: "shop", value: "hairdresser" }],
  peluqueria: [{ key: "shop", value: "hairdresser" }],
  "peluquería": [{ key: "shop", value: "hairdresser" }],
  bar: [
    { key: "amenity", value: "bar" },
    { key: "amenity", value: "pub" },
  ],
  pub: [
    { key: "amenity", value: "pub" },
    { key: "amenity", value: "bar" },
  ],
  cafe: [{ key: "amenity", value: "cafe" }],
  cafeteria: [{ key: "amenity", value: "cafe" }],
  supermarket: [{ key: "shop", value: "supermarket" }],
  supermercado: [{ key: "shop", value: "supermarket" }],
  fitness: [{ key: "leisure", value: "fitness_centre" }],
  gym: [{ key: "leisure", value: "fitness_centre" }],
  gimnasio: [{ key: "leisure", value: "fitness_centre" }],
};

interface NominatimResult {
  lat?: string;
  lon?: string;
  /** [south, north, west, east] */
  boundingbox?: string[];
}

interface OverpassElement {
  type: string; // "node" | "way" | "relation"
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

/**
 * Surface the underlying syscall error (e.g. ENOTFOUND) when Node
 * fetch wraps it as `TypeError: fetch failed`. The wrapped cause
 * carries the OS-level errno that maps cleanly to PROVIDER_UNAVAILABLE
 * per the spec.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { message?: string } | null }).cause;
    if (
      cause &&
      typeof cause === "object" &&
      "message" in cause &&
      typeof cause.message === "string"
    ) {
      return `${err.message}: ${cause.message}`;
    }
    return err.message;
  }
  return String(err);
}

export class OverpassDiscoveryProvider implements DiscoveryProvider {
  name = "OpenStreetMap";

  async isConfigured(): Promise<boolean> {
    // Public Overpass + Nominatim endpoints. No API key needed.
    return true;
  }

  async discover(
    input: OverpassInput
  ): Promise<ProviderResult<CandidateLead[]>> {
    const city = (input.city ?? input.location ?? "").trim();
    const country = (input.country ?? "").trim();
    const category = (input.category ?? input.niche ?? input.query ?? "")
      .trim()
      .toLowerCase();
    const keywords = (input.keywords ?? "").trim();

    if (!city) {
      return {
        ok: false,
        error: makeError(
          "INVALID_INPUT",
          "Overpass discovery requires a city/location",
          { provider: this.name }
        ),
      };
    }

    // Step 1 — geocode the city via Nominatim to get a bounding box.
    const bboxResult = await this.geocode(city, country);
    if (!bboxResult.ok) return { ok: false, error: bboxResult.error };

    // Step 2 — build the Overpass QL query.
    const query = this.buildQuery(bboxResult.bbox, category, keywords);

    // Step 3 — try each Overpass mirror until one responds.
    let lastError: ProviderError | null = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      const res = await this.runOverpass(endpoint, query);
      if (res.ok) {
        const candidates = this.normalizeElements(res.elements, input);
        if (candidates.length === 0) {
          return {
            ok: false,
            error: makeError(
              "EMPTY_RESULT",
              "Overpass returned 0 named businesses",
              { provider: this.name }
            ),
          };
        }
        return { ok: true, data: candidates };
      }
      lastError = res.error;
      // AUTH_FAILURE / INVALID_INPUT are not transient — stop trying.
      if (
        res.error.type === "AUTH_FAILURE" ||
        res.error.type === "INVALID_INPUT"
      ) {
        return { ok: false, error: res.error };
      }
      // Otherwise (RATE_LIMIT / TIMEOUT / PROVIDER_UNAVAILABLE /
      // TEMPORARY_FAILURE) try the next mirror.
    }

    return {
      ok: false,
      error:
        lastError ??
        makeError("PROVIDER_UNAVAILABLE", "All Overpass endpoints failed", {
          provider: this.name,
        }),
    };
  }

  // ── Nominatim geocoding ───────────────────────────────────────────
  private async geocode(
    city: string,
    country: string
  ): Promise<
    | { ok: true; bbox: string }
    | { ok: false; error: ProviderError }
  > {
    const q = country ? `${city}, ${country}` : city;
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(
      q
    )}&format=json&limit=1`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        return {
          ok: false,
          error: normalizeError(
            { status: res.status, statusText: res.statusText },
            this.name
          ),
        };
      }
      const data = (await res.json()) as NominatimResult[];
      const first = data?.[0];
      if (!first || !first.boundingbox || first.boundingbox.length < 4) {
        return {
          ok: false,
          error: makeError("EMPTY_RESULT", `Nominatim could not geocode "${q}"`, {
            provider: this.name,
          }),
        };
      }
      const [south, north, west, east] = first.boundingbox;
      const bbox = `${south},${west},${north},${east}`;
      return { ok: true, bbox };
    } catch (err) {
      return { ok: false, error: normalizeError(describeError(err), this.name) };
    }
  }

  // ── Overpass QL builder ───────────────────────────────────────────
  private buildQuery(bbox: string, category: string, keywords: string): string {
    const tags = CATEGORY_TAGS[category];
    let filterBlock: string;
    if (tags && tags.length > 0) {
      filterBlock = tags
        .map((t) => {
          const k = this.escapeQl(t.key);
          if (t.value) {
            const v = this.escapeQl(t.value);
            return `node["${k}"="${v}"](${bbox});way["${k}"="${v}"](${bbox});`;
          }
          return `node["${k}"](${bbox});way["${k}"](${bbox});`;
        })
        .join("");
    } else {
      // Generic name search — fallback when category is unknown.
      const term = this.escapeQl(keywords || category);
      filterBlock = `node["name"~"${term}",i](${bbox});way["name"~"${term}",i](${bbox});`;
    }
    return `[out:json][timeout:25];(${filterBlock});out center tags 50;`;
  }

  private escapeQl(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  // ── Overpass fetch ───────────────────────────────────────────────
  private async runOverpass(
    endpoint: string,
    query: string
  ): Promise<
    | { ok: true; elements: OverpassElement[] }
    | { ok: false; error: ProviderError }
  > {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        return {
          ok: false,
          error: normalizeError(
            { status: res.status, statusText: res.statusText },
            this.name
          ),
        };
      }
      const data = (await res.json()) as OverpassResponse;
      return { ok: true, elements: data.elements ?? [] };
    } catch (err) {
      return { ok: false, error: normalizeError(describeError(err), this.name) };
    }
  }

  // ── Response normalization ───────────────────────────────────────
  private normalizeElements(
    elements: OverpassElement[],
    input: OverpassInput
  ): CandidateLead[] {
    const out: CandidateLead[] = [];
    for (const el of elements) {
      const tags = el.tags ?? {};
      const name = tags.name;
      if (!name) continue; // skip anonymous POIs

      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;

      const addrStreet = tags["addr:street"] ?? "";
      const addrHousenumber = tags["addr:housenumber"] ?? "";
      const addrParts = [addrHousenumber, addrStreet].filter(Boolean);
      const address = addrParts.join(" ").trim() || null;

      const phone = tags.phone || tags["contact:phone"] || null;
      const email = tags.email || tags["contact:email"] || null;
      const website = tags.website || tags["contact:website"] || null;

      const social_links: string[] = [];
      for (const k of [
        "contact:instagram",
        "contact:facebook",
        "contact:twitter",
        "contact:linkedin",
      ]) {
        const v = tags[k];
        if (v) social_links.push(v);
      }

      // Composed description — business-descriptive tags only.
      // Contact info (phone/email/website/social) lives in raw_data
      // (= the full OSM tags object) for the pipeline to read.
      const descriptionBits: string[] = [];
      if (tags.description) descriptionBits.push(tags.description);
      if (tags.cuisine) descriptionBits.push(`cuisine: ${tags.cuisine}`);
      if (tags.specialty) descriptionBits.push(`specialty: ${tags.specialty}`);
      const description = descriptionBits.length > 0
        ? descriptionBits.join(" | ")
        : null;

      const osmUrl =
        lat !== undefined && lon !== undefined
          ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`
          : null;

      out.push({
        name,
        username: null,
        platform: "openstreetmap",
        url: osmUrl,
        location: input.city ?? input.location ?? null,
        category: input.category ?? input.niche ?? null,
        niche: input.niche ?? null,
        description,
        raw_data: { ...tags },
        source: "OpenStreetMap",
        discovered_at: new Date().toISOString(),
      });
    }
    return out;
  }
}
