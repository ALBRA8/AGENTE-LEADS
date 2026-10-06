// ============================================================
// tests/e2e.test.ts — End-to-end pipeline test
//
// Scenario from the spec:
//   "Busca restaurantes veganos en Medellín
//    con más de 5.000 seguidores
//    y sin website encontrado."
//
// All subtests run SEQUENTIALLY within a single root test to avoid
// DB file contention (better-sqlite3 doesn't tolerate parallel
// access to the same file).
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, cleanupTestEnv } from "./setup.js";
import { runLeadPipeline } from "../src/agent/pipelines/orchestrator.js";
import { MockDiscoveryProvider } from "../src/agent/providers/mock_discovery.js";
import { getAllTools } from "../src/agent/registry.js";
import { getExecution, getAllLeads } from "../src/agent/storage/lead_intelligence.js";
import type { ResearchProvider, VerificationProvider, ScrapingProvider } from "../src/agent/providers/types.js";

// Fakes for research/verification/scraping so the E2E is reproducible without network

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
          phones: [],
          social_links: [],
          raw_text: "Welcome to Vegan Heaven — vegan restaurant in El Poblado, Medellín",
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
        raw_text: "La Raíz Vegana — cocina vegana de autor en Envigado, Medellín",
      },
    };
  },
};

const fakeVerifier: VerificationProvider = {
  name: "FakeVerifier",
  isConfigured: async () => true,
  async verifyEmail(email) {
    if (email === "hello@veganheaven.com") {
      return { ok: true, data: { email, valid: true, smtp_check: true, reason: "deliverable" } };
    }
    return { ok: true, data: { email, valid: false, reason: "mailbox full" } };
  },
  async verifyDomain(domain) {
    return { ok: true, data: { domain, resolves: true, http_status: 200, https_enabled: true } };
  },
  async verifyUrl(url) {
    return { ok: true, data: { url, reachable: true, http_status: 200 } };
  },
};

const fakeScraping: ScrapingProvider = {
  name: "FakeScraping",
  isConfigured: async () => true,
  async scrape(input) {
    // Only return Vegan Heaven's email when scraping Vegan Heaven's URL
    if (input.url.includes("veganheavenmed")) {
      return {
        ok: true,
        data: {
          url: input.url,
          status: 200,
          text: "Welcome! Contact us at hello@veganheaven.com",
          emails_found: ["hello@veganheaven.com"],
          social_links: [],
        },
      };
    }
    // For other URLs (e.g. La Raíz Vegana) return empty — simulates no email found
    return {
      ok: true,
      data: {
        url: input.url,
        status: 200,
        text: "",
        emails_found: [],
        social_links: [],
      },
    };
  },
};

// Use a single root test with sequential subtests to avoid parallel DB contention
test("E2E — AGENTE LEADS pipeline", async (t) => {
  await t.test("full pipeline runs discovery → research → validation → dedup → storage → report", async () => {
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
        },
        {
          discovery: [new MockDiscoveryProvider()],
          research: fakeResearch,
          verification: fakeVerifier,
          scraping: fakeScraping,
        }
      );

      // Discovery filtered 2 candidates (8200 and 6100 followers, both >= 5000)
      // The 3200-follower candidate was filtered out
      assert.equal(result.candidates_count, 2);
      assert.equal(result.researched_count, 2);
      assert.equal(result.validated_count, 2);
      assert.equal(result.stored_count, 2);
      // P1.1: scoring runs on all stored leads
      assert.equal(result.scored_count, 2);
      // P1.2: intelligence runs only if offer_description is provided (it's not here)
      assert.equal(result.intelligenced_count, 0);
      assert.equal(result.outcome, "success");

      // Report is human-readable Markdown
      assert.ok(result.report_text.includes("TOP LEADS"));
      assert.ok(result.report_text.includes("Vegan Heaven"));
      assert.ok(result.report_text.includes("La Raíz Vegana"));

      // Execution ID is persisted
      assert.ok(result.execution_id.startsWith("exec_"));
    } finally {
      cleanupTestEnv();
    }
  });

  await t.test("produces correct report with observed/validated/inferred distinction", async () => {
    setupTestEnv();
    try {
      const result = await runLeadPipeline(
        {
          query: "restaurantes veganos",
          location: "Medellín",
          niche: "vegano",
          min_followers: 5000,
        },
        {
          discovery: [new MockDiscoveryProvider()],
          research: fakeResearch,
          verification: fakeVerifier,
          scraping: fakeScraping,
        }
      );

      // Vegan Heaven has email found AND validated → both "encontrado" and "validado"
      assert.ok(result.report_text.includes("encontrado"));
      assert.ok(result.report_text.includes("validado"));

      // La Raíz Vegana has NO website found → "no encontrado"
      // CRITICAL: report should say "no encontrado", NOT "no tiene website"
      assert.ok(result.report_text.includes("no encontrado"));
      assert.ok(!result.report_text.toLowerCase().includes("no tiene website"));
      assert.ok(!result.report_text.toLowerCase().includes("no tiene email"));
      assert.ok(!result.report_text.toLowerCase().includes("no tiene linkedin"));
    } finally {
      cleanupTestEnv();
    }
  });

  await t.test("empty result produces a helpful report (no crash)", async () => {
    setupTestEnv();
    try {
      const result = await runLeadPipeline(
        {
          query: "nonexistent niche",
          location: "Nonexistent City",
          min_followers: 999999, // higher than any candidate's followers
        },
        {
          discovery: [new MockDiscoveryProvider()],
          research: fakeResearch,
          verification: fakeVerifier,
          scraping: fakeScraping,
        }
      );

      assert.equal(result.candidates_count, 0);
      assert.equal(result.stored_count, 0);
      assert.equal(result.outcome, "partial");
      assert.ok(result.report_text.includes("No se encontraron leads"));
    } finally {
      cleanupTestEnv();
    }
  });

  await t.test("idempotent — running twice doesn't duplicate leads", async () => {
    setupTestEnv();
    try {
      const intent = {
        query: "restaurantes veganos",
        location: "Medellín",
        niche: "vegano",
        min_followers: 5000,
      };
      const providers = {
        discovery: [new MockDiscoveryProvider()],
        research: fakeResearch,
        verification: fakeVerifier,
        scraping: fakeScraping,
      };

      // First run — creates 2 leads
      const r1 = await runLeadPipeline(intent, providers);
      assert.equal(r1.stored_count, 2);

      // Second run — should merge into existing (dedup)
      const r2 = await runLeadPipeline(intent, providers);
      assert.equal(r2.stored_count, 2); // same 2 leads, merged not duplicated
    } finally {
      cleanupTestEnv();
    }
  });

  await t.test("tool registry includes run_lead_pipeline AND run_outreach (P2.4)", () => {
    const tools = getAllTools();
    const names = tools.map((t) => t.definition.function.name);
    assert.ok(names.includes("run_lead_pipeline"));
    assert.ok(names.includes("run_outreach"));  // P2.4
    assert.ok(names.includes("get_current_time")); // legacy preserved
    assert.ok(names.includes("scrape_instagram_leads")); // legacy preserved
    assert.ok(names.includes("save_lead")); // legacy preserved
  });

  await t.test("tool descriptions do NOT overclaim capabilities (P0 audit fixes)", () => {
    const tools = getAllTools();
    const saveLead = tools.find((t) => t.definition.function.name === "save_lead");
    const scrapeStealth = tools.find((t) => t.definition.function.name === "scrape_stealth");
    const enrichLead = tools.find((t) => t.definition.function.name === "enrich_lead_profile");

    // save_lead should NOT mention Airtable (it's SQLite only)
    assert.ok(!saveLead!.definition.function.description.toLowerCase().includes("airtable"));

    // scrape_stealth should NOT claim to evade Cloudflare/Akamai
    assert.ok(!scrapeStealth!.definition.function.description.toLowerCase().includes("evade cloudflare"));
    assert.ok(!scrapeStealth!.definition.function.description.toLowerCase().includes("evade akamai"));

    // enrich_lead_profile should clarify it's research infraestructura, not intelligence
    assert.ok(enrichLead!.definition.function.description.toLowerCase().includes("infraestructura"));
  });

  // ── PRODUCTION CLOSURE §36 — preservation + CRM event contract ──
  await t.test("§36: final result preserves lead, score, evidence, execution_id, provenance, status", async () => {
    setupTestEnv();
    try {
      const result = await runLeadPipeline(
        {
          query: "restaurantes veganos",
          location: "Medellín",
          niche: "vegano",
          min_followers: 5000,
        },
        {
          discovery: [new MockDiscoveryProvider()],
          research: fakeResearch,
          verification: fakeVerifier,
          scraping: fakeScraping,
        }
      );
      assert.ok(result.execution_id.startsWith("exec_"));

      // 1. The persisted lead carries id + score + evidence + provenance + status
      const reportJson = JSON.parse(result.report_json);
      assert.ok(reportJson.top.length >= 1);
      const firstLeadName = reportJson.top[0].name;

      // Find the stored lead by name through the DB
      const stored = getAllStoredLeadsByName(firstLeadName);
      assert.ok(stored, "lead must be persisted");
      assert.ok(stored.id!.startsWith("lead_"));
      assert.equal(stored.research_state, "VALIDATED"); // status preserved
      assert.ok(typeof stored.lead_score === "number" && stored.lead_score > 0); // score preserved
      assert.ok(stored.evidence.length > 0); // evidence preserved
      const emailEv = stored.evidence.find((e) => e.field === "email");
      assert.ok(emailEv, "email evidence preserved");
      assert.ok(emailEv!.source && emailEv!.source.length > 0, "provenance preserved");
      assert.ok(emailEv!.retrieved_at, "timestamp preserved");
      assert.ok(stored.sources.length > 0, "source chain preserved");
      // §9: evidence carries truth_level going forward
      assert.ok(emailEv!.truth_level !== undefined, "truth_level present on new evidence");

      // 2. The execution trace is persisted and reconstructable
      const trace = getExecution(result.execution_id);
      assert.ok(trace, "execution trace persisted");
      assert.equal(trace!.outcome, "success");
      assert.ok(trace!.steps.length > 0);
      assert.ok(trace!.steps.some((s) => s.name.startsWith("discovery.")));
      assert.ok(trace!.steps.some((s) => s.name.startsWith("validation.")));
    } finally {
      cleanupTestEnv();
    }
  });

  await t.test("§36: pipeline fires contractual CRM events (LEAD_QUALIFIED envelope)", async () => {
    setupTestEnv();
    try {
      const http = await import("http");
      const received: any[] = [];
      const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          received.push(JSON.parse(body));
          res.writeHead(200);
          res.end('{"ok":true}');
        });
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const port = (server.address() as any).port;

      // Wire CRM webhook via env (the orchestrator reads it)
      const prevUrl = process.env.CRM_ALBRA_WEBHOOK_URL;
      process.env.CRM_ALBRA_WEBHOOK_URL = `http://127.0.0.1:${port}/crm`;
      try {
        const result = await runLeadPipeline(
          {
            query: "restaurantes veganos",
            location: "Medellín",
            niche: "vegano",
            min_followers: 5000,
          },
          {
            discovery: [new MockDiscoveryProvider()],
            research: fakeResearch,
            verification: fakeVerifier,
            scraping: fakeScraping,
          }
        );

        // §36 flow: USER → ... → REPORT → CRM EVENT
        assert.ok(received.length >= 1, "CRM must receive events");
        const completed = received.find((e) => e.event_type === "execution.completed");
        assert.ok(completed, "execution.completed event received");
        // §26 envelope
        assert.ok(completed.event_id.startsWith("evt_"));
        assert.equal(completed.source_agent, process.env.AGENT_NAME ?? "AGENTE-LEADS");
        assert.equal(completed.target_agent, "CRM-ALBRA");
        assert.equal(completed.execution_id, result.execution_id);
        assert.equal(completed.correlation_id, result.execution_id);

        const scored = received.filter((e) => e.event_type === "lead.scored");
        assert.equal(scored.length, 2, "one lead.scored event per stored lead");
        for (const ev of scored) {
          assert.ok(ev.lead_id.startsWith("lead_"));
          assert.ok(typeof ev.payload.score === "number");
          assert.ok(Array.isArray(ev.evidence));
        }
      } finally {
        if (prevUrl === undefined) delete process.env.CRM_ALBRA_WEBHOOK_URL;
        else process.env.CRM_ALBRA_WEBHOOK_URL = prevUrl;
        await new Promise<void>((r) => server.close(() => r()));
      }
    } finally {
      cleanupTestEnv();
    }
  });
});

// Helper: find stored leads by name (they may share names — returns first)
function getAllStoredLeadsByName(name: string) {
  return getAllLeads(50).find((l) => l.name === name) ?? null;
}
