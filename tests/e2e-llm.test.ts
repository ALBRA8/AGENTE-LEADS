// ============================================================
// tests/e2e-llm.test.ts — E2E test that exercises the REAL
// GLM 5.3 Flash LLM via NVIDIA NIM.
//
// Skipped automatically if NVIDIA_API_KEY is not configured
// (so CI without creds doesn't fail).
//
// This test runs the orchestrator's INTELLIGENCE stage against
// the actual NVIDIA NIM API (model "z-ai/glm-5.3-flash"). The
// reasoning model can take 30–60s per call, hence the 90s
// timeout on the outer test.
//
// Verifications (per task spec):
//   1. LLM produces a non-empty intelligence summary
//   2. Summary does not invent phone numbers not in evidence (P0.6)
//   3. opportunity_size is one of: small | medium | large | unknown
//   4. outreach_angle is a non-empty string
//   5. confidence is one of: high | medium | low | none
//   6. Lead has an INFERRED evidence record for "llm_intelligence" after the run
//   7. Lead Score is computed (>= 0 and <= 100)
//   8. Execution trace has a step named "intelligence.glm_5_3_flash"
//
// IMPLEMENTATION NOTE: src/config/nvidia.ts THROWS at module-load
// time if NVIDIA_API_KEY is missing. To keep this test gracefully
// skippable in CI without creds, runLeadPipeline and runIntelligence
// are imported dynamically INSIDE the test body — AFTER the skip
// guard. The static imports at the top of the file do NOT touch
// nvidia.ts, so the test file loads cleanly even with no key.
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns";
import dotenv from "dotenv";
import { setupTestEnv, cleanupTestEnv } from "./setup.js";
import { scoreLead } from "../src/agent/pipelines/scoring.js";
import { MockDiscoveryProvider } from "../src/agent/providers/mock_discovery.js";
import { getExecution } from "../src/agent/storage/lead_intelligence.js";
import { found, notFound } from "../src/agent/core/evidence.js";
import type { Lead } from "../src/agent/core/lead.js";
import type {
  ResearchProvider,
  VerificationProvider,
  ScrapingProvider,
} from "../src/agent/providers/types.js";

// Force IPv4-first DNS resolution. The OpenAI SDK (used inside
// src/config/nvidia.ts) uses Node's HTTP stack, which by default
// may try IPv6 first and hang in sandboxes with broken IPv6
// routing. Setting this BEFORE the dynamic import of nvidia.ts
// ensures the SDK's fetch calls resolve over IPv4.
dns.setDefaultResultOrder("ipv4first");

// Load .env so process.env.NVIDIA_API_KEY reflects the file before the skip guard.
// IMPORTANT: we do NOT use `override: true` here — if a CI system explicitly
// sets NVIDIA_API_KEY to a placeholder (e.g. "your-key" / "xxx") to signal
// "no creds", that signal must be honored and the test must skip.
dotenv.config();

// Skip when NVIDIA_API_KEY is missing or still the placeholder.
const hasNvidiaKey = Boolean(
  process.env.NVIDIA_API_KEY &&
    !process.env.NVIDIA_API_KEY.includes("your") &&
    !process.env.NVIDIA_API_KEY.includes("xxx") &&
    !process.env.NVIDIA_API_KEY.startsWith("nvapi-xxx")
);

// Fake providers (same shape as tests/e2e.test.ts).
// These return realistic data so the LLM has something to reason
// about, without requiring Apify / network access.

const fakeResearch: ResearchProvider = {
  name: "FakeResearch",
  isConfigured: async () => true,
  async research(input) {
    if (input.candidate.username === "veganheavenmed") {
      return {
        ok: true,
        data: {
          emails: ["hello@veganheaven.com"],
          websites: ["https://veganheaven.com.co"],
          phones: ["+57 311 567 8901"],
          social_links: ["https://instagram.com/veganheavenmed"],
          raw_text:
            "Vegan Heaven Medellín — restaurante vegano en El Poblado con 8200 seguidores en Instagram.",
        },
      };
    }
    return {
      ok: true,
      data: {
        emails: [],
        websites: [],
        phones: [],
        social_links: [],
        raw_text:
          "La Raíz Vegana — cocina vegana de autor en Envigado, Medellín.",
      },
    };
  },
};

const fakeVerifier: VerificationProvider = {
  name: "FakeVerifier",
  isConfigured: async () => true,
  async verifyEmail(email) {
    if (email === "hello@veganheaven.com") {
      return {
        ok: true,
        data: { email, valid: true, smtp_check: true, reason: "deliverable" },
      };
    }
    return { ok: true, data: { email, valid: false, reason: "mailbox full" } };
  },
  async verifyDomain(domain) {
    return {
      ok: true,
      data: { domain, resolves: true, http_status: 200, https_enabled: true },
    };
  },
  async verifyUrl(url) {
    return { ok: true, data: { url, reachable: true, http_status: 200 } };
  },
};

const fakeScraping: ScrapingProvider = {
  name: "FakeScraping",
  isConfigured: async () => true,
  async scrape(input) {
    if (input.url.includes("veganheavenmed")) {
      return {
        ok: true,
        data: {
          url: input.url,
          status: 200,
          text: "Welcome to Vegan Heaven! Email: hello@veganheaven.com",
          emails_found: ["hello@veganheaven.com"],
          social_links: [],
        },
      };
    }
    return {
      ok: true,
      data: { url: input.url, status: 200, text: "", emails_found: [], social_links: [] },
    };
  },
};

// Helper: build a fully-formed Lead with evidence.
// Used for direct runIntelligence calls so we can inspect the
// actual LeadIntelligence object fields (summary, opportunity_size,
// outreach_angle, confidence) — these are NOT exposed in
// PipelineResult / report JSON.
function makeLeadWithEvidence(overrides: Partial<Lead> = {}): Lead {
  return {
    name: "Vegan Heaven Medellín",
    username: "veganheavenmed",
    platform: "instagram",
    url: "https://instagram.com/veganheavenmed",
    website: "https://veganheaven.com.co",
    email: "hello@veganheaven.com",
    phone: null,
    location: "Medellín",
    category: "restaurant",
    niche: "vegano",
    sources: ["MockDiscovery", "FakeResearch"],
    discovered_at: new Date().toISOString(),
    evidence: [
      found("instagram", "veganheavenmed", "MockDiscovery", "discovered via Instagram"),
      found("website", "https://veganheaven.com.co", "FakeResearch", "found in bio"),
      found("email", "hello@veganheaven.com", "FakeResearch", "found in bio"),
      notFound("phone", "FakeResearch", "Searched — value did not appear"),
      found("location", "Medellín", "MockDiscovery", "from candidate location"),
    ],
    validation: {
      email: {
        status: "valid",
        confidence: "high",
        checked_at: new Date().toISOString(),
        source: "FakeVerifier",
        notes: "deliverable",
      },
      domain: {
        status: "valid",
        confidence: "medium",
        checked_at: new Date().toISOString(),
        source: "FakeVerifier",
        notes: "HTTP 200, HTTPS enabled",
      },
    },
    research_state: "VALIDATED",
    ...overrides,
  };
}

// Helper: retry a function up to `maxAttempts` times until the LLM
// actually succeeds (some sandboxes have flaky IPv6/HTTP-stack
// connectivity to NVIDIA NIM that causes intermittent
// "Connection error." failures). The existing `withRetry` in
// nvidia.ts doesn't classify these as retryable (it only matches
// "timeout"/"ECONNRESET"/5xx), so we add our own outer retry.
//
// `isSuccess` is called after each attempt to decide whether to
// stop retrying.
async function withLlmRetry<T>(
  fn: () => Promise<T>,
  isSuccess: (result: T) => boolean,
  maxAttempts = 3,
  delayMs = 5_000
): Promise<T> {
  let lastResult: T;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = await fn();
    if (isSuccess(lastResult)) return lastResult;
    if (attempt < maxAttempts) {
      console.warn(
        `[e2e-llm] LLM attempt ${attempt}/${maxAttempts} did not produce expected result — retrying in ${delayMs}ms…`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return lastResult!;
}

// Outer test (with extended timeout for LLM reasoning).
//
// The outer test timeout covers ALL sub-tests sequentially. GLM 5.3 Flash
// is a reasoning model — each call takes 30-60s. Sub-test 1 runs 2 LLM
// calls in parallel (one per lead), sub-tests 2 & 3 each make 1 LLM call,
// sub-test 4 is fast (no LLM). 5 minutes gives ample headroom.
test("Real LLM E2E (GLM 5.3 Flash)", { timeout: 300_000 }, async (t) => {
  if (!hasNvidiaKey) {
    t.skip("NVIDIA_API_KEY not set — skipping real LLM E2E test");
    return;
  }

  // Dynamic imports — only loaded AFTER the skip guard has passed.
  // These modules transitively import src/config/nvidia.ts, which
  // throws at module-load time if NVIDIA_API_KEY is missing.
  const { runLeadPipeline } = await import(
    "../src/agent/pipelines/orchestrator.js"
  );
  const { runIntelligence } = await import(
    "../src/agent/pipelines/intelligence.js"
  );

  // Sub-test 1: full pipeline triggers LLM intelligence on all leads.
  // Verifies: (6) llm_intelligence INFERRED evidence + (8) trace step.
  // 2 LLM calls in parallel (max_concurrency=2) — 90s is enough headroom.
  await t.test(
    "runLeadPipeline with offer_description triggers LLM intelligence on all leads",
    { timeout: 90_000 },
    async () => {
      setupTestEnv();
      try {
        const result = await runLeadPipeline(
          {
            query: "restaurantes veganos",
            location: "Medellín",
            niche: "vegano",
            platform: "instagram",
            min_followers: 5000,
            top_n: 5,
            max_concurrency: 2, // reduce concurrency for LLM calls
            offer_description:
              "Servicio de marketing digital y diseño web para restaurantes veganos. " +
              "Incluye gestión de Instagram, publicidad en Meta Ads y SEO local.",
            enable_intelligence: true,
          },
          {
            discovery: [new MockDiscoveryProvider()],
            research: fakeResearch,
            verification: fakeVerifier,
            scraping: fakeScraping,
          }
        );

        // Pipeline completed for both candidates (8200 + 6100 followers).
        assert.equal(result.outcome, "success");
        assert.equal(result.candidates_count, 2);
        assert.equal(result.stored_count, 2);
        assert.equal(result.intelligenced_count, 2); // LLM called for both

        // Report mentions both leads.
        assert.ok(result.report_text.includes("Vegan Heaven"));
        assert.ok(result.report_text.includes("La Raíz Vegana"));

        // (6) Each lead should have an INFERRED evidence record for
        // "llm_intelligence" in the report JSON's evidence_summary.
        const json = JSON.parse(result.report_json);
        assert.ok(
          Array.isArray(json.top) && json.top.length === 2,
          "report should contain 2 top leads"
        );
        for (const lead of json.top) {
          const llmEv = (lead.evidence_summary ?? []).find(
            (e: { field: string; status: string; source?: string }) =>
              e.field === "llm_intelligence"
          );
          assert.ok(
            llmEv,
            `lead "${lead.name}" should have an llm_intelligence evidence record after the run`
          );
          assert.equal(llmEv.status, "INFERRED");
          assert.equal(llmEv.source, "system-inference");
        }

        // (8) Execution trace persisted with the LLM step recorded.
        const trace = getExecution(result.execution_id);
        assert.ok(trace, "execution trace should be persisted");
        const llmStep = (trace!.steps ?? []).find(
          (s) => s.name === "intelligence.glm_5_3_flash"
        );
        assert.ok(
          llmStep,
          "trace should have a step named 'intelligence.glm_5_3_flash'"
        );
      } finally {
        cleanupTestEnv();
      }
    }
  );

  // Sub-test 2: direct runIntelligence — verify all object fields.
  // Verifies: (1) non-empty summary, (3) opportunity_size enum,
  //           (4) outreach_angle non-empty, (5) confidence enum,
  //           (6) llm_intelligence INFERRED evidence.
  // 1 LLM call — 90s covers the reasoning model's typical 30-60s latency.
  await t.test(
    "LLM intelligence produces non-empty summary + valid opportunity_size + outreach_angle + confidence",
    { timeout: 90_000 },
    async () => {
      setupTestEnv();
      try {
        const lead = makeLeadWithEvidence();
        const result = await runIntelligence({
          lead,
          offer_description: "Marketing digital para restaurantes veganos",
        });

        // (1) Non-empty summary.
        assert.ok(
          typeof result.intelligence.summary === "string" &&
            result.intelligence.summary.length > 0,
          `summary should be a non-empty string, got: ${JSON.stringify(result.intelligence.summary)}`
        );

        // (3) opportunity_size is one of the allowed values.
        assert.ok(
          ["small", "medium", "large", "unknown"].includes(
            result.intelligence.opportunity_size
          ),
          `opportunity_size should be one of small/medium/large/unknown, got: ${result.intelligence.opportunity_size}`
        );

        // (4) outreach_angle is a non-empty string.
        assert.ok(
          typeof result.intelligence.outreach_angle === "string" &&
            result.intelligence.outreach_angle.length > 0,
          `outreach_angle should be a non-empty string, got: ${JSON.stringify(result.intelligence.outreach_angle)}`
        );

        // (5) confidence is one of the allowed values.
        assert.ok(
          ["high", "medium", "low", "none"].includes(
            result.intelligence.confidence
          ),
          `confidence should be one of high/medium/low/none, got: ${result.intelligence.confidence}`
        );

        // signals_used is an array.
        assert.ok(
          Array.isArray(result.intelligence.signals_used),
          "signals_used should be an array"
        );

        // (6) The lead should now carry an INFERRED evidence record
        // for "llm_intelligence" — its value is the summary text.
        const llmEv = lead.evidence.find((e) => e.field === "llm_intelligence");
        assert.ok(
          llmEv,
          "lead should have an llm_intelligence evidence record after runIntelligence"
        );
        assert.equal(llmEv!.status, "INFERRED");
        assert.equal(llmEv!.source, "system-inference");
        assert.equal(
          llmEv!.value,
          result.intelligence.summary,
          "llm_intelligence evidence value should equal the LLM summary"
        );
      } finally {
        cleanupTestEnv();
      }
    }
  );

  // Sub-test 3: P0.6 — LLM must NOT invent phone numbers.
  // 1 LLM call — 90s covers the reasoning model's typical 30-60s latency.
  await t.test(
    "LLM does NOT invent phone numbers not in evidence (P0.6 rule)",
    { timeout: 90_000 },
    async () => {
      setupTestEnv();
      try {
        // Construct a lead with NO phone in evidence. The LLM should
        // not invent a Colombian phone number in its summary or angle.
        const lead = makeLeadWithEvidence({
          phone: null,
          evidence: [
            found("instagram", "veganheavenmed", "MockDiscovery", "discovered"),
            found("website", "https://veganheaven.com.co", "FakeResearch", "in bio"),
            found("email", "hello@veganheaven.com", "FakeResearch", "in bio"),
            notFound("phone", "FakeResearch", "Searched — value did not appear"),
            found("location", "Medellín", "MockDiscovery", "candidate location"),
          ],
        });

        const result = await runIntelligence({
          lead,
          offer_description: "Marketing digital para restaurantes veganos",
        });

        // Pull summary + outreach_angle text.
        const summary = (result.intelligence.summary ?? "").toLowerCase();
        const angle = (result.intelligence.outreach_angle ?? "").toLowerCase();

        // Patterns that would indicate an invented phone number:
        //   - "+57 ..." (Colombian country code)
        //   - "311 567 8901" style (mobile prefix + digits)
        //   - 9+ consecutive digits in a row
        const phonePatterns = [
          /\+57[\s\d]/,
          /\b3\d{2}[\s\-]?\d{3}[\s\-]?\d{4}\b/,
          /\b\d{9,}\b/,
        ];
        for (const p of phonePatterns) {
          assert.ok(
            !p.test(summary),
            `summary should not invent a phone number matching ${p}, got: ${summary}`
          );
          assert.ok(
            !p.test(angle),
            `outreach_angle should not invent a phone number matching ${p}, got: ${angle}`
          );
        }

        // The lead still has llm_intelligence INFERRED evidence.
        const llmEv = lead.evidence.find((e) => e.field === "llm_intelligence");
        assert.ok(llmEv, "lead should have llm_intelligence evidence");
        assert.equal(llmEv!.status, "INFERRED");
      } finally {
        cleanupTestEnv();
      }
    }
  );

  // Sub-test 4: Lead Score computed (P1.1) — no LLM needed.
  // Fast (enable_intelligence=false) so a short timeout is fine.
  await t.test(
    "Lead Score is computed for all stored leads (P1.1)",
    { timeout: 30_000 },
    async () => {
      setupTestEnv();
      try {
        const result = await runLeadPipeline(
          {
            query: "vegano",
            location: "Medellín",
            min_followers: 5000,
            max_concurrency: 2,
            offer_description: "Marketing",
            enable_intelligence: false, // skip LLM to keep this test fast
          },
          {
            discovery: [new MockDiscoveryProvider()],
            research: fakeResearch,
            verification: fakeVerifier,
            scraping: fakeScraping,
          }
        );

        assert.equal(result.scored_count, 2);

        // Each lead's evidence_summary in the report JSON should
        // include a lead_score INFERRED record (source = system-scoring).
        const json = JSON.parse(result.report_json);
        for (const lead of json.top) {
          const scoreEv = (lead.evidence_summary ?? []).find(
            (e: { field: string; status: string; source?: string }) =>
              e.field === "lead_score"
          );
          assert.ok(
            scoreEv,
            `lead "${lead.name}" should have a lead_score evidence record`
          );
          assert.equal(scoreEv.status, "INFERRED");
          assert.equal(scoreEv.source, "system-scoring");
        }

        // (7) Also verify the actual numeric score directly via the
        // deterministic scoreLead function — the value is in [0, 100].
        const directLead = makeLeadWithEvidence();
        const score = scoreLead(directLead);
        assert.ok(
          score.score >= 0 && score.score <= 100,
          `score ${score.score} should be in [0, 100]`
        );
        assert.ok(
          score.breakdown.length > 0,
          "score should have a non-empty breakdown"
        );
      } finally {
        cleanupTestEnv();
      }
    }
  );
});
