// ============================================================
// src/lib/leads/index.ts — Adapter registry & factory
// ============================================================

import type { LeadSourceAdapter } from "./types";
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

export {
  MockLeadSourceAdapter,
  WebScraperLeadSourceAdapter,
  OverpassLeadSourceAdapter,
  WebSearchLeadSourceAdapter,
};
export type { LeadSourceAdapter, RawProspect, SearchInput } from "./types";
