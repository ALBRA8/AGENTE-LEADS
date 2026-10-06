// ============================================================
// src/lib/leads/google-places-adapter.ts
// Google Places API (New) official adapter. Activates when
// GOOGLE_PLACES_API_KEY is configured in user's Integration row.
// ============================================================

import type { LeadSourceAdapter, RawProspect, SearchInput } from "./types";

export class GooglePlacesLeadSourceAdapter
  implements LeadSourceAdapter
{
  constructor(private apiKey: string) {}

  name = "Google Places API";
  description =
    "Fuente oficial Google Places API (New). Requiere API key con Places API habilitada en Google Cloud Console.";

  async isConfigured() {
    return Boolean(this.apiKey && this.apiKey.length > 10);
  }

  async search(input: SearchInput): Promise<RawProspect[]> {
    if (!this.apiKey) return [];
    // Build a text query like "clinica estetica in Bogota Colombia"
    const q = [input.category, "in", input.city, input.country].filter(Boolean).join(" ");
    const url = "https://places.googleapis.com/v1/places:searchText";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask":
          "places.displayName,places.formattedAddress,places.websiteUri,places.internationalPhoneNumber,places.googleMapsUri,places.primaryTypeDisplayName,places.editorialSummary",
      },
      body: JSON.stringify({
        textQuery: q,
        languageCode: "es",
        regionCode: input.country || "CO",
      }),
    });
    if (!res.ok) {
      const e = await res.text();
      throw new Error(`Google Places error: ${res.status} ${e}`);
    }
    const data = await res.json();
    const places = (data.places || []) as any[];
    return places.map((p): RawProspect => ({
      name: p.displayName?.text || "Sin nombre",
      category: p.primaryTypeDisplayName?.text || input.category,
      address: p.formattedAddress,
      city: input.city,
      country: input.country,
      website: p.websiteUri,
      phone: p.internationalPhoneNumber,
      socialLinks: undefined,
      description: p.editorialSummary?.text,
      source: "google_places",
      sourceUrl: p.googleMapsUri,
    }));
  }
}
