// ============================================================
// src/lib/leads/mock-adapter.ts — Demo lead source adapter
// ============================================================

import type { LeadSourceAdapter, RawProspect, SearchInput } from "./types";
import { buildMockProspects } from "./mock-source-data";

export const MockLeadSourceAdapter: LeadSourceAdapter = {
  name: "Demo",
  description:
    "Fuente de datos demo con clínicas de estética realistas (Bogotá, Medellín, Cali). No requiere API keys.",
  async isConfigured() {
    return true;
  },
  async search(input: SearchInput): Promise<RawProspect[]> {
    // Simulate latency
    await new Promise((r) => setTimeout(r, 800));
    return buildMockProspects(input);
  },
};
