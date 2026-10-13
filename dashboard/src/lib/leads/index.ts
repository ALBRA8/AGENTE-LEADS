// ============================================================
// src/lib/leads/index.ts — Adapter registry & factory
// P1 · Contrato 7: searchWithFallback — recorre los adapters en orden
// de preferencia y devuelve el primer éxito con datos; los fallos
// (envelope !ok) y los EMPTY pasan al siguiente proveedor.
// ============================================================

import type {
  LeadSourceAdapter,
  RawProspect,
  SearchInput,
} from "./types";
import type {
  ProviderErrorCode,
  ProviderResult,
} from "./envelope";
import { providerFail } from "./envelope";
import { MockLeadSourceAdapter } from "./mock-adapter";
import { WebScraperLeadSourceAdapter } from "./web-scraper-adapter";
import { GooglePlacesLeadSourceAdapter } from "./google-places-adapter";
import { OverpassLeadSourceAdapter } from "./overpass-adapter";
import { WebSearchLeadSourceAdapter } from "./web-search-adapter";

/**
 * Build the list of available lead source adapters for a given user.
 * Order = preference order. Google Places (if configured) first (richest data),
 * then Web Search via z.ai SDK (real Google results, no API key needed),
 * then OpenStreetMap (real public data, no API key needed),
 * then Web Scraper, then Mock as last-resort fallback for demos.
 */
export function getLeadSources(
  integration?: {
    googlePlacesApiKey?: string | null;
    apifyToken?: string | null;
  } | null
): LeadSourceAdapter[] {
  const list: LeadSourceAdapter[] = [];
  if (integration?.googlePlacesApiKey) {
    list.push(
      new GooglePlacesLeadSourceAdapter(integration.googlePlacesApiKey)
    );
  }
  list.push(WebSearchLeadSourceAdapter); // ← REAL Google results via z.ai SDK, no API key
  list.push(OverpassLeadSourceAdapter); // ← REAL public data via OSM, no API key
  list.push(WebScraperLeadSourceAdapter);
  list.push(MockLeadSourceAdapter); // always available as fallback
  return list;
}

// ───────────────────────────────────────────────────────────
// P1 · Contrato 7 — Fallback entre proveedores con envelope
// ───────────────────────────────────────────────────────────

/** Traza de un intento sobre un adapter (éxito, EMPTY o fallo clasificado). */
export interface FallbackAttempt {
  provider: string;
  ok: boolean;
  code?: ProviderErrorCode;
  message?: string;
  count?: number;
}

export interface FallbackOutcome {
  result: ProviderResult<RawProspect[]>;
  attempts: FallbackAttempt[];
  /** Adapter que devolvió datos (undefined si ninguno tuvo resultados). */
  succeededProvider?: string;
  /** Suma de meta.calls de todos los adapters ejecutados (trazabilidad de coste). */
  totalCalls: number;
}

/**
 * Ejecuta `adapters` en orden y devuelve el primer resultado con datos.
 * Reglas:
 *  - adapter no configurado → attempt {code:"AUTH"} y se salta.
 *  - envelope !ok           → attempt con el código del envelope y sigue.
 *  - envelope ok con datos  → éxito inmediato (retorna).
 *  - envelope ok con []     → attempt {code:"EMPTY"} y sigue.
 *  - excepción (violación del contrato "nunca lanzar") → attempt UNKNOWN.
 * Nunca lanza: si todos fallan devuelve el último envelope (o uno EMPTY
 * de "registry" si no hubo adapters ejecutables).
 */
export async function searchWithFallback(
  adapters: LeadSourceAdapter[],
  input: SearchInput
): Promise<FallbackOutcome> {
  const attempts: FallbackAttempt[] = [];
  let totalCalls = 0;
  let last: ProviderResult<RawProspect[]> | null = null;
  for (const adapter of adapters) {
    if (!(await adapter.isConfigured())) {
      attempts.push({ provider: adapter.name, ok: false, code: "AUTH", message: "no configurado" });
      continue;
    }
    try {
      const r = await adapter.search(input);
      totalCalls += r.meta?.calls ?? 0;
      if (r.ok) {
        if (r.data.length > 0) {
          attempts.push({ provider: adapter.name, ok: true, count: r.data.length });
          return { result: r, attempts, succeededProvider: adapter.name, totalCalls };
        }
        attempts.push({ provider: adapter.name, ok: true, code: "EMPTY", count: 0, message: "sin resultados" });
        last = r;
      } else {
        attempts.push({ provider: adapter.name, ok: false, code: r.error.code, message: r.error.message });
        last = r;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      attempts.push({ provider: adapter.name, ok: false, code: "UNKNOWN", message: msg });
      last = providerFail<RawProspect[]>(adapter.name, "UNKNOWN", msg);
    }
  }
  return {
    result: last ?? providerFail<RawProspect[]>("registry", "EMPTY", "sin adapters disponibles"),
    attempts,
    totalCalls,
  };
}

export {
  MockLeadSourceAdapter,
  WebScraperLeadSourceAdapter,
  OverpassLeadSourceAdapter,
  WebSearchLeadSourceAdapter,
};
// P1 · Contrato 7: helpers del envelope re-exportados para consumidores
// (route.ts, chat) desde un único módulo.
export {
  providerOk,
  providerFail,
  providerMeta,
  classifyHttpError,
  isProviderError,
} from "./envelope";
export type {
  ProviderResult,
  ProviderError,
  ProviderCallMeta,
  ProviderErrorCode,
} from "./envelope";
export type { LeadSourceAdapter, RawProspect, SearchInput } from "./types";
