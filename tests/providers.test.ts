// ============================================================
// tests/providers.test.ts — P0.2 Provider abstraction
// Uses MockDiscoveryProvider and fakes for verification
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { MockDiscoveryProvider } from "../src/agent/providers/mock_discovery.js";
import { ApifyDiscoveryProvider } from "../src/agent/providers/apify_discovery.js";
import { ScraplingScrapingProvider } from "../src/agent/providers/scrapling_scraper.js";
import { RapidEmailVerificationProvider } from "../src/agent/providers/email_verifier_provider.js";
import { GoogleSearchResearchProvider } from "../src/agent/providers/google_search_research.js";
import { ok, fail, type ProviderResult } from "../src/agent/providers/types.js";
import type { ProviderError } from "../src/agent/core/errors.js";

test("MockDiscoveryProvider: isConfigured returns true", async () => {
  const p = new MockDiscoveryProvider();
  assert.equal(await p.isConfigured(), true);
});

test("MockDiscoveryProvider: discover returns CandidateLead[]", async () => {
  const p = new MockDiscoveryProvider();
  const result = await p.discover({ query: "vegano", location: "Medellín" });
  assert.equal(result.ok, true);
  assert.ok(result.data);
  assert.ok(result.data.length > 0);
  assert.equal(result.data[0].source, "MockDiscovery");
  assert.ok(result.data[0].discovered_at.includes("T"));
});

test("MockDiscoveryProvider: filters by min_followers", async () => {
  const p = new MockDiscoveryProvider();
  const result = await p.discover({ query: "vegano", location: "Medellín", min_followers: 5000 });
  assert.equal(result.ok, true);
  assert.ok(result.data);
  // 2 candidates have 8200 and 6100 followers (>= 5000)
  // 1 candidate has 3200 (filtered out)
  assert.equal(result.data.length, 2);
  for (const c of result.data) {
    assert.ok(Number(c.raw_data?.followers) >= 5000);
  }
});

test("MockDiscoveryProvider: filter by niche works", async () => {
  const p = new MockDiscoveryProvider();
  const result = await p.discover({ query: "vegano", niche: "vegano" });
  assert.equal(result.ok, true);
  for (const c of result.data!) {
    assert.equal(c.niche, "vegano");
  }
});

test("ApifyDiscoveryProvider: not configured without token", async () => {
  // Save and clear token
  const saved = process.env.APIFY_TOKEN;
  delete process.env.APIFY_TOKEN;
  try {
    const p = new ApifyDiscoveryProvider();
    assert.equal(await p.isConfigured(), false);
    const result = await p.discover({ query: "test" });
    assert.equal(result.ok, false);
    assert.equal(result.error!.type, "AUTH_FAILURE");
  } finally {
    if (saved) process.env.APIFY_TOKEN = saved;
  }
});

test("ApifyDiscoveryProvider: not configured with placeholder token", async () => {
  const saved = process.env.APIFY_TOKEN;
  process.env.APIFY_TOKEN = "your_apify_token_here";
  try {
    const p = new ApifyDiscoveryProvider();
    assert.equal(await p.isConfigured(), false);
  } finally {
    if (saved) process.env.APIFY_TOKEN = saved;
    else delete process.env.APIFY_TOKEN;
  }
});

test("ScraplingScrapingProvider: not configured if venv missing", async () => {
  // In sandbox, no .venv directory exists
  const p = new ScraplingScrapingProvider();
  // isConfigured returns false because no .venv/bin/python
  assert.equal(await p.isConfigured(), false);
  const result = await p.scrape({ url: "https://example.com" });
  assert.equal(result.ok, false);
  assert.equal(result.error!.type, "PROVIDER_UNAVAILABLE");
});

test("RapidEmailVerificationProvider: isConfigured returns true (no token needed)", async () => {
  const p = new RapidEmailVerificationProvider();
  assert.equal(await p.isConfigured(), true);
  // NOTE: We don't actually call verifyEmail here to avoid network calls in tests
});

test("GoogleSearchResearchProvider: not configured without Apify token", async () => {
  const saved = process.env.APIFY_TOKEN;
  delete process.env.APIFY_TOKEN;
  try {
    const p = new GoogleSearchResearchProvider();
    assert.equal(await p.isConfigured(), false);
  } finally {
    if (saved) process.env.APIFY_TOKEN = saved;
  }
});

test("ProviderResult envelope: ok() helper returns ok=true", () => {
  const r = ok("hello");
  assert.equal(r.ok, true);
  assert.equal(r.data, "hello");
  assert.equal(r.error, undefined);
});

test("ProviderResult envelope: fail() helper returns ok=false with error", () => {
  const err: ProviderError = { type: "AUTH_FAILURE", message: "no token", retryable: false };
  const r = fail<string>(err);
  assert.equal(r.ok, false);
  assert.equal(r.error!.type, "AUTH_FAILURE");
});

test("Provider interface: every provider has name property", async () => {
  const providers = [
    new MockDiscoveryProvider(),
    new ApifyDiscoveryProvider(),
    new ScraplingScrapingProvider(),
    new RapidEmailVerificationProvider(),
    new GoogleSearchResearchProvider(),
  ];
  for (const p of providers) {
    assert.ok(typeof p.name === "string" && p.name.length > 0, `${p.constructor.name} should have a name`);
    assert.ok(typeof p.isConfigured === "function");
  }
});
