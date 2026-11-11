// ============================================================
// tests/outreach_idempotency.test.ts — PRODUCTION CLOSURE §25
// Outreach idempotency: retries/restarts must NEVER duplicate sends.
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, cleanupTestEnv } from "./setup.js";
import { runOutreach } from "../src/agent/pipelines/outreach.js";
import { MockOutreachProvider } from "../src/agent/providers/outreach.js";
import { found } from "../src/agent/core/evidence.js";
import { getDb } from "../src/agent/storage/lead_intelligence.js";
import type { Lead } from "../src/agent/core/lead.js";

function makeQualifiedLead(id: string): Lead {
  return {
    id,
    name: `Lead ${id}`,
    email: `hola@${id}.com`,
    website: `https://${id}.com`,
    sources: ["MockDiscovery"],
    discovered_at: new Date().toISOString(),
    evidence: [found("email", `hola@${id}.com`, "Google", "found")],
    validation: {
      email: { status: "valid", confidence: "high", checked_at: new Date().toISOString(), source: "FakeVerifier" },
    },
    research_state: "VALIDATED",
    lead_score: 80,
  } as Lead;
}

const FAKE_GEN = async (lead: Lead) => `Propuesta para ${lead.name} — oferta X determinística`;

function pipelineInput(leads: Lead[], offer = "Oferta determinística de prueba") {
  return {
    leads,
    min_score: 50,
    offer_description: offer,
    email_provider: new MockOutreachProvider() as any,
    whatsapp_provider: new MockOutreachProvider() as any,
    crm_hooks: null,
    proposal_generator: FAKE_GEN,
    dry_run: false as const,
  };
}

test("idempotency: first run sends, retry of the same run skips (already_sent)", async () => {
  setupTestEnv();
  try {
    const lead = makeQualifiedLead("idem_1");

    // First execution — sends
    const r1 = await runOutreach(pipelineInput([lead]));
    assert.equal(r1.sent, 1);
    assert.equal(r1.results[0].status, "sent");

    // Retry (LLM called the tool twice, or process restarted) — must skip
    const r2 = await runOutreach(pipelineInput([lead]));
    assert.equal(r2.sent, 0);
    assert.equal(r2.skipped, 1);
    assert.ok(r2.results[0].skip_reason!.includes("already_sent"));
    assert.ok(r2.skip_reasons.some((sr) => sr.reason === "already_sent_idempotency"));

    // Outreach log has exactly ONE sent row for this lead+channel
    const rows = getDb()
      .prepare("SELECT * FROM outreach_log WHERE lead_id = 'idem_1' AND status = 'sent'")
      .all() as any[];
    assert.equal(rows.length, 1);
  } finally {
    cleanupTestEnv();
  }
});

test("idempotency: different offer → different key → can send again (legit new campaign)", async () => {
  setupTestEnv();
  try {
    const lead = makeQualifiedLead("idem_2");
    const r1 = await runOutreach(pipelineInput([lead], "Oferta A"));
    assert.equal(r1.sent, 1);
    const r2 = await runOutreach(pipelineInput([lead], "Oferta B (distinta)"));
    assert.equal(r2.sent, 1);
  } finally {
    cleanupTestEnv();
  }
});

test("idempotency: other leads in the same run are not affected", async () => {
  setupTestEnv();
  try {
    const a = makeQualifiedLead("idem_3");
    const b = makeQualifiedLead("idem_4");

    await runOutreach(pipelineInput([a, b]));
    // Both sent once
    const r3 = await runOutreach(pipelineInput([a, b]));
    assert.equal(r3.sent, 0);
    assert.equal(r3.skipped, 2);

    // A NEW lead still gets its message
    const c = makeQualifiedLead("idem_5");
    const r4 = await runOutreach(pipelineInput([a, c]));
    assert.equal(r4.sent, 1);
    assert.equal(r4.results.find((x) => x.lead.id === "idem_5")!.status, "sent");
    assert.equal(r4.results.find((x) => x.lead.id === "idem_3")!.status, "skipped");
  } finally {
    cleanupTestEnv();
  }
});

test("idempotency: dry_run does NOT register the log (preview doesn't block future sends)", async () => {
  setupTestEnv();
  try {
    const lead = makeQualifiedLead("idem_6");
    const dry = await runOutreach({ ...pipelineInput([lead]), dry_run: true });
    assert.equal(dry.sent, 0);
    assert.equal(dry.results[0].status, "dry_run");

    const rows = getDb()
      .prepare("SELECT COUNT(*) AS c FROM outreach_log WHERE lead_id = 'idem_6'")
      .get() as { c: number };
    assert.equal(rows.c, 0, "dry run must not write outreach_log");

    // Real send after dry run works
    const real = await runOutreach(pipelineInput([lead]));
    assert.equal(real.sent, 1);
  } finally {
    cleanupTestEnv();
  }
});
