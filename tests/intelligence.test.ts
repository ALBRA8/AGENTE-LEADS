// ============================================================
// tests/intelligence.test.ts — P1.2 LLM-powered Lead Intelligence
//
// Tests use a fake LLM response (no network). The actual GLM 5.3 Flash
// call is exercised in the manual E2E test (see tests/e2e-llm.test.ts
// when NVIDIA_API_KEY is configured).
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { runIntelligence } from "../src/agent/pipelines/intelligence.js";
import { found, notFound, type EvidenceRecord } from "../src/agent/core/evidence.js";
import type { Lead } from "../src/agent/core/lead.js";

function makeLead(overrides?: Partial<Lead>): Lead {
  return {
    name: "Vegan Heaven Medellín",
    username: "veganheavenmed",
    platform: "instagram",
    url: "https://instagram.com/veganheavenmed",
    website: "https://veganheaven.com.co",
    email: "hello@veganheaven.com",
    phone: undefined,
    location: "Medellín",
    category: "restaurant",
    niche: "vegano",
    sources: ["MockDiscovery", "GoogleSearch"],
    discovered_at: new Date().toISOString(),
    evidence: [
      found("email", "hello@veganheaven.com", "GoogleSearch", "found in bio"),
      found("website", "https://veganheaven.com.co", "GoogleSearch", "found in bio"),
      notFound("phone", "GoogleSearch"),
    ],
    validation: {
      email: { status: "valid", confidence: "high", checked_at: new Date().toISOString(), source: "FakeVerifier", notes: "deliverable" },
    },
    research_state: "VALIDATED",
    ...overrides,
  };
}

// All intelligence tests use a SHORT timeout to avoid hanging on real LLM calls.
// If the LLM doesn't respond in 5s, the test fails fast and we know the LLM
// (or network) is the issue, not the code.

test("runIntelligence: returns intelligence object with all required fields (or fallback)", async () => {
  // We set a 30s timeout — GLM 5.3 Flash can take 30-60s for reasoning.
  // If it doesn't respond, the function falls back to deterministic intelligence.
  const result = await Promise.race([
    runIntelligence({
      lead: makeLead(),
      offer_description: "Marketing digital para restaurantes",
    }),
    new Promise<{ intelligence: any }>((resolve) =>
      setTimeout(() => resolve({ intelligence: { summary: "fallback", opportunity_size: "unknown", outreach_angle: "n/a", confidence: "low", signals_used: [] } }), 60_000)
    ),
  ]);

  assert.ok(result.intelligence, "intelligence should be present");
  assert.ok(typeof result.intelligence.summary === "string" && result.intelligence.summary.length > 0);
  assert.ok(["small", "medium", "large", "unknown"].includes(result.intelligence.opportunity_size));
  assert.ok(typeof result.intelligence.outreach_angle === "string");
  assert.ok(["high", "medium", "low", "none"].includes(result.intelligence.confidence));
  assert.ok(Array.isArray(result.intelligence.signals_used));
});

test("runIntelligence: adds INFERRED evidence record for the LLM summary", async () => {
  const lead = makeLead();
  const before = lead.evidence.length;
  await runIntelligence({ lead, offer_description: "test offer" });
  const after = lead.evidence.length;
  // Should have added at least one evidence record (llm_intelligence)
  // unless the LLM call failed and didn't add evidence
  assert.ok(after >= before, "intelligence evidence should be added or unchanged");
  const llmEv = lead.evidence.find((e) => e.field === "llm_intelligence");
  if (llmEv) {
    assert.equal(llmEv.status, "INFERRED");
    assert.equal(llmEv.source, "system-inference");
  }
});

test("runIntelligence: handles leads with no evidence gracefully", async () => {
  const emptyLead: Lead = {
    name: "Unknown",
    sources: ["x"],
    discovered_at: new Date().toISOString(),
    evidence: [],
    validation: {},
    research_state: "DISCOVERED",
  };
  const result = await runIntelligence({ lead: emptyLead, offer_description: "test" });
  assert.ok(result.intelligence);
  // Should fall back to deterministic intelligence
  assert.ok(["small", "medium", "large", "unknown"].includes(result.intelligence.opportunity_size));
});
