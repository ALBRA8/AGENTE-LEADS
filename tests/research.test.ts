// ============================================================
// tests/research.test.ts — P0.4 Research pipeline
//
// Tests that research:
//   - takes a CandidateLead and produces a Lead with evidence
//   - treats scraper as infrastructure, not intelligence
//   - produces EvidenceRecord for each important field with FOUND/NOT_FOUND status
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { runResearch } from "../src/agent/pipelines/research.js";
import { ExecutionRecorder } from "../src/agent/core/execution.js";
import type { CandidateLead, Lead } from "../src/agent/core/lead.js";
import type { ResearchProvider, ScrapingProvider, ProviderResult } from "../src/agent/providers/types.js";
import { makeError } from "../src/agent/core/errors.js";

function makeCandidate(overrides?: Partial<CandidateLead>): CandidateLead {
  return {
    name: "Vegan Heaven Medellín",
    username: "veganheavenmed",
    platform: "instagram",
    url: "https://instagram.com/veganheavenmed",
    location: "Medellín",
    category: "restaurant",
    niche: "vegano",
    description: "Restaurante vegano en El Poblado.",
    source: "MockDiscovery",
    discovered_at: new Date().toISOString(),
    ...overrides,
  };
}

test("runResearch: produces a Lead with research_state = RESEARCHED", async () => {
  const result = await runResearch(null, null, { candidate: makeCandidate() });
  assert.equal(result.lead.research_state, "RESEARCHED");
  assert.equal(result.lead.name, "Vegan Heaven Medellín");
  assert.equal(result.lead.username, "veganheavenmed");
});

test("runResearch: produces EvidenceRecord[] for important fields", async () => {
  const result = await runResearch(null, null, { candidate: makeCandidate() });
  // Important fields: website, email, phone, instagram, linkedin, location
  const fields = result.lead.evidence.map((e) => e.field);
  assert.ok(fields.includes("website"));
  assert.ok(fields.includes("email"));
  assert.ok(fields.includes("phone"));
  assert.ok(fields.includes("instagram"));
  assert.ok(fields.includes("location"));
});

test("runResearch: marks fields as NOT_FOUND when no data available", async () => {
  const result = await runResearch(null, null, { candidate: makeCandidate() });
  const websiteEv = result.lead.evidence.find((e) => e.field === "website");
  assert.ok(websiteEv);
  // Without a research provider, website should be NOT_FOUND
  assert.equal(websiteEv!.status, "NOT_FOUND");
});

test("runResearch: uses research provider to find data", async () => {
  const researchProvider: ResearchProvider = {
    name: "FakeResearch",
    isConfigured: async () => true,
    async research(): Promise<ProviderResult<any>> {
      return {
        ok: true,
        data: {
          emails: ["hello@veganheaven.com"],
          phones: ["+57 311 567 8901"],
          websites: ["https://veganheaven.com.co"],
          social_links: [],
        },
      };
    },
  };
  const result = await runResearch(researchProvider, null, { candidate: makeCandidate() });
  const emailEv = result.lead.evidence.find((e) => e.field === "email");
  assert.equal(emailEv!.status, "FOUND");
  assert.equal(emailEv!.value, "hello@veganheaven.com");
  const websiteEv = result.lead.evidence.find((e) => e.field === "website");
  assert.equal(websiteEv!.status, "FOUND");
});

test("runResearch: uses scraping provider when candidate has URL", async () => {
  const scrapingProvider: ScrapingProvider = {
    name: "FakeScraping",
    isConfigured: async () => true,
    async scrape(): Promise<ProviderResult<any>> {
      return {
        ok: true,
        data: {
          url: "https://instagram.com/veganheavenmed",
          status: 200,
          text: "Contact us at hello@veganheaven.com or visit our site at veganheaven.com.co",
          emails_found: ["hello@veganheaven.com"],
          social_links: [],
        },
      };
    },
  };
  const result = await runResearch(null, scrapingProvider, { candidate: makeCandidate() });
  const emailEv = result.lead.evidence.find((e) => e.field === "email");
  assert.equal(emailEv!.status, "FOUND");
  assert.equal(emailEv!.value, "hello@veganheaven.com");
});

test("runResearch: dedup_signals is computed and populated", async () => {
  const result = await runResearch(null, null, { candidate: makeCandidate() });
  assert.ok(result.lead.dedup_signature);
  assert.equal(result.lead.dedup_signature!.instagram, "veganheavenmed");
});

test("runResearch: sources array includes candidate source + provider name", async () => {
  const researchProvider: ResearchProvider = {
    name: "FakeResearch",
    isConfigured: async () => true,
    async research(): Promise<ProviderResult<any>> {
      return { ok: true, data: { emails: [], phones: [], websites: [], social_links: [] } };
    },
  };
  const result = await runResearch(researchProvider, null, { candidate: makeCandidate() });
  assert.ok(result.lead.sources.includes("MockDiscovery"));
  assert.ok(result.lead.sources.includes("FakeResearch"));
});

test("runResearch: handles research provider errors gracefully (no throw)", async () => {
  const failingResearch: ResearchProvider = {
    name: "FailingResearch",
    isConfigured: async () => true,
    async research(): Promise<ProviderResult<any>> {
      return { ok: false, error: makeError("AUTH_FAILURE", "no token") };
    },
  };
  // Should not throw, should still produce a Lead (with NOT_FOUND evidence)
  const result = await runResearch(failingResearch, null, { candidate: makeCandidate() });
  assert.equal(result.lead.research_state, "RESEARCHED");
  const emailEv = result.lead.evidence.find((e) => e.field === "email");
  assert.equal(emailEv!.status, "NOT_FOUND");
});

test("runResearch: records trace steps", async () => {
  const researchProvider: ResearchProvider = {
    name: "FakeResearch",
    isConfigured: async () => true,
    async research(): Promise<ProviderResult<any>> {
      return { ok: true, data: { emails: [], phones: [], websites: [], social_links: [] } };
    },
  };
  const trace = new ExecutionRecorder("test");
  await runResearch(researchProvider, null, { candidate: makeCandidate() }, trace);
  const steps = trace.getTrace().steps;
  assert.ok(steps.some((s) => s.name === "research.FakeResearch"));
});
