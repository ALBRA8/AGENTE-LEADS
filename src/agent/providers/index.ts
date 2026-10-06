// ============================================================
// src/agent/providers/index.ts — Barrel export
// ============================================================

export * from "./types.js";
export { ApifyDiscoveryProvider } from "./apify_discovery.js";
export { ScraplingScrapingProvider } from "./scrapling_scraper.js";
export { RapidEmailVerificationProvider } from "./email_verifier_provider.js";
export { GoogleSearchResearchProvider } from "./google_search_research.js";
export { MockDiscoveryProvider } from "./mock_discovery.js";
// P3 — additional lead sources (real public data, no API key needed)
export { OverpassDiscoveryProvider } from "./overpass_discovery.js";
export { DuckDuckGoDiscoveryProvider } from "./duckduckgo_discovery.js";
