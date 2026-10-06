// ============================================================
// src/lib/leads/overpass-adapter.ts
// OpenStreetMap Overpass API adapter — REAL public business data,
// no API key required, no rate limits that matter for normal use.
// Uses Nominatim for city→coords geocoding (also OSM, free).
// ============================================================

import type { LeadSourceAdapter, RawProspect, SearchInput } from "./types";

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

async function geocodeCity(
  city: string,
  country?: string
): Promise<BoundingBox | null> {
  const q = [city, country].filter(Boolean).join(", ");
  const url = `${NOMINATIM_ENDPOINT}?q=${encodeURIComponent(
    q
  )}&format=json&limit=1&accept-language=es`;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "AGENTE-LEADS/1.0 (B2B prospecting; contact: dev)",
      },
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const bb = data[0].boundingbox;
    if (!bb) return null;
    // Nominatim returns boundingbox as [south, north, west, east] as strings
    return {
      south: parseFloat(bb[0]),
      north: parseFloat(bb[1]),
      west: parseFloat(bb[2]),
      east: parseFloat(bb[3]),
    };
  } catch (e) {
    console.error("[Overpass] geocode failed:", e);
    return null;
  }
}

function buildOverpassQuery(
  bb: BoundingBox,
  category?: string,
  keywords?: string
): string {
  // Map common service categories to OSM tags
  const tagMap: Record<string, string[]> = [
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

function extractProspect(el: any, city: string, country: string): RawProspect | null {
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

  const social: any = {};
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

  async search(input: SearchInput): Promise<RawProspect[]> {
    const country = input.country || "";
    // Step 1: geocode the city to get bounding box
    const bb = await geocodeCity(input.city, country);
    if (!bb) {
      console.warn("[Overpass] could not geocode city:", input.city);
      return [];
    }

    // Step 2: build Overpass query
    const query = buildOverpassQuery(bb, input.category, input.keywords);

    // Step 3: query Overpass (try multiple endpoints in case one is down)
    let data: any = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const r = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: `data=${encodeURIComponent(query)}`,
        });
        if (!r.ok) {
          console.warn(`[Overpass] ${endpoint} returned ${r.status}`);
          continue;
        }
        data = await r.json();
        break;
      } catch (e) {
        console.warn(`[Overpass] ${endpoint} failed:`, (e as Error).message);
        continue;
      }
    }

    if (!data || !data.elements) {
      console.warn("[Overpass] all endpoints failed or returned empty");
      return [];
    }

    // Step 4: extract prospects
    const elements = data.elements as any[];
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
    return prospects;
  },
};
