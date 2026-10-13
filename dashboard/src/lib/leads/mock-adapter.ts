// ============================================================
// src/lib/leads/mock-adapter.ts — Demo lead source adapter
// P1 · Contrato 10: los resultados demo van marcados ESTRUCTURALMENTE
// con isMock:true y sin sourceUrl (null) — bloquean outreach aguas abajo.
// P1 · Contrato 7: devuelve envelope ProviderResult (nunca lanza).
// ============================================================

import type { LeadSourceAdapter, RawProspect, SearchInput } from "./types";
import type { ProviderResult } from "./envelope";
import { providerMeta, providerOk } from "./envelope";
import { buildMockProspects } from "./mock-source-data";

// P1 · Contrato 7: nombre de proveedor ESTABLE para el envelope/meta
// (adapter.name se conserva como etiqueta legible para la UI).
const PROVIDER = "mock";

export const MockLeadSourceAdapter: LeadSourceAdapter = {
  name: "Demo",
  description:
    "Fuente de datos demo con clínicas de estética realistas (Bogotá, Medellín, Cali). No requiere API keys.",
  async isConfigured() {
    return true;
  },
  async search(input: SearchInput): Promise<ProviderResult<RawProspect[]>> {
    const startedAt = Date.now();
    // Simulate latency
    await new Promise((r) => setTimeout(r, 800));
    // P1 · Contrato 10: marcado estructural DEMO en cada resultado —
    // isMock:true bloquea outreach y sourceUrl se anula (null).
    const data: RawProspect[] = buildMockProspects(input).map((p) => ({
      ...p,
      isMock: true,
      sourceUrl: undefined,
    }));
    // P1 · Contrato 7: no hace llamadas HTTP → calls: 0.
    return providerOk(data, providerMeta(PROVIDER, 0, Date.now() - startedAt));
  },
};
