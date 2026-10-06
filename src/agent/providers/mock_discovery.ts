// ============================================================
// src/agent/providers/mock_discovery.ts
// P0.2 — In-memory DiscoveryProvider for tests and E2E.
//
// Lets the pipeline run end-to-end without an APIFY_TOKEN. The default
// fixture matches the E2E scenario: vegan restaurants in Medellín,
// with some above and some below the 5000-followers floor so the
// `min_followers` filter is exercised realistically.
// ============================================================

import type {
  DiscoveryProvider,
  DiscoveryInput,
  ProviderResult,
} from "./types.js";
import type { CandidateLead } from "../core/lead.js";

const DEFAULT_FIXTURE: CandidateLead[] = [
  {
    name: "Vegan Heaven Medellín",
    username: "veganheavenmed",
    platform: "instagram",
    url: "https://instagram.com/veganheavenmed",
    location: "Medellín",
    category: "restaurant",
    niche: "vegano",
    description:
      "Restaurante vegano en El Poblado. Cocina 100% plant-based, más de 50 platos.",
    raw_data: { followers: 8200 },
    source: "MockDiscovery",
    discovered_at: new Date().toISOString(),
  },
  {
    name: "La Raíz Vegana",
    username: "laraizvegana",
    platform: "instagram",
    url: "https://instagram.com/laraizvegana",
    location: "Medellín",
    category: "restaurant",
    niche: "vegano",
    description: "Cocina vegana de autor. Envigado, Medellín.",
    raw_data: { followers: 6100 },
    source: "MockDiscovery",
    discovered_at: new Date().toISOString(),
  },
  {
    name: "Green Bowl Medellín",
    username: "greenbowlmed",
    platform: "instagram",
    url: "https://instagram.com/greenbowlmed",
    location: "Medellín",
    category: "restaurant",
    niche: "vegano",
    description: "Bowls saludables veganos. Laureles.",
    raw_data: { followers: 3200 },
    source: "MockDiscovery",
    discovered_at: new Date().toISOString(),
  },
];

export class MockDiscoveryProvider implements DiscoveryProvider {
  name = "MockDiscovery";
  private readonly candidates: CandidateLead[];

  constructor(candidates?: CandidateLead[]) {
    this.candidates = candidates ?? DEFAULT_FIXTURE;
  }

  async isConfigured(): Promise<boolean> {
    return true;
  }

  async discover(
    input: DiscoveryInput
  ): Promise<ProviderResult<CandidateLead[]>> {
    let results = this.candidates;

    if (input.location) {
      const loc = input.location.toLowerCase();
      results = results.filter((c) =>
        c.location?.toLowerCase().includes(loc)
      );
    }
    if (input.niche) {
      const n = input.niche.toLowerCase();
      results = results.filter((c) => (c.niche ?? "").toLowerCase().includes(n));
    }
    if (input.min_followers !== undefined) {
      results = results.filter(
        (c) =>
          Number((c.raw_data as { followers?: unknown } | null)?.followers ?? 0) >=
          input.min_followers!
      );
    }

    return { ok: true, data: results };
  }
}
