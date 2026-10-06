// ============================================================
// src/agent/providers/registry.ts
// Provider registry — instantiates and configures providers based on
// environment variables. Used by the orchestrator.
//
// Discovery chain (in order of preference):
//   1. Apify (if APIFY_TOKEN configured — most reliable, paid)
//   2. Overpass OSM (always free, real public data)
//   3. DuckDuckGo (always free, real public data)
//   4. Mock (last resort — for tests/dev without internet)
// ============================================================

import { ApifyDiscoveryProvider } from "./apify_discovery.js";
import { ScraplingScrapingProvider } from "./scrapling_scraper.js";
import { RapidEmailVerificationProvider } from "./email_verifier_provider.js";
import { GoogleSearchResearchProvider } from "./google_search_research.js";
import { MockDiscoveryProvider } from "./mock_discovery.js";
import { OverpassDiscoveryProvider } from "./overpass_discovery.js";
import { DuckDuckGoDiscoveryProvider } from "./duckduckgo_discovery.js";
import type { DiscoveryProvider, ResearchProvider, VerificationProvider, ScrapingProvider } from "./types.js";
import type { ProviderRegistry } from "../pipelines/orchestrator.js";

export function buildProviderRegistry(opts?: { use_mock_discovery?: boolean }): ProviderRegistry {
  const discovery: DiscoveryProvider[] = [];

  if (opts?.use_mock_discovery) {
    // Test mode: mock only (deterministic, no network)
    discovery.push(new MockDiscoveryProvider());
  } else {
    // Production chain: real providers in preference order + Mock fallback
    discovery.push(new ApifyDiscoveryProvider());      // 1. Apify (paid, most reliable)
    discovery.push(new OverpassDiscoveryProvider());   // 2. OpenStreetMap (free, real data)
    discovery.push(new DuckDuckGoDiscoveryProvider());  // 3. DuckDuckGo (free, real data)
    discovery.push(new MockDiscoveryProvider());       // 4. Mock fallback (test/dev)
  }

  const research: ResearchProvider | null = new GoogleSearchResearchProvider();
  const verification: VerificationProvider | null = new RapidEmailVerificationProvider();
  const scraping: ScrapingProvider | null = new ScraplingScrapingProvider();

  return { discovery, research, verification, scraping };
}
