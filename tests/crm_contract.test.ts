// ============================================================
// tests/crm_contract.test.ts — PRODUCTION CLOSURE §26
// CRM-ALBRA contractual envelope: LEAD_QUALIFIED payload.
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, cleanupTestEnv } from "./setup.js";
import { CRMAlbraHooks } from "../src/agent/pipelines/crm_albra_hooks.js";
import { found } from "../src/agent/core/evidence.js";
import type { Lead } from "../src/agent/core/lead.js";

function makeLead(): Lead {
  return {
    id: "lead_crm_1",
    name: "Vegan Heaven",
    email: "hello@veganheaven.com",
    website: "https://veganheaven.com.co",
    sources: ["MockDiscovery"],
    discovered_at: new Date().toISOString(),
    evidence: [
      found("email", "hello@veganheaven.com", "Google", "found in bio"),
      found("website", "https://veganheaven.com.co", "Google", "found"),
    ],
    validation: {},
    research_state: "VALIDATED",
    lead_score: 78,
  } as Lead;
}

test("crm: buildEvent produces the full §26 contractual envelope", () => {
  setupTestEnv();
  try {
    const hooks = new CRMAlbraHooks({});
    const lead = makeLead();
    const event = hooks.buildEvent("lead.scored", { score: lead.lead_score }, {
      lead_id: lead.id,
      evidence: [
        { field: "email", status: "FOUND", source: "Google", value: lead.email },
        { field: "lead_score", status: "INFERRED", source: "system-scoring", value: "78" },
      ],
      execution_id: "exec_abc_123",
    });

    // §26 payload mínimo
    assert.ok(event.event_id.startsWith("evt_"));
    assert.equal(event.event_type, "lead.scored");
    assert.equal(event.source_agent, process.env.AGENT_NAME ?? "AGENTE-LEADS");
    assert.equal(event.target_agent, "CRM-ALBRA");
    assert.ok(event.timestamp);
    assert.equal(event.lead_id, "lead_crm_1");
    assert.deepEqual(event.payload, { score: 78 });
    assert.equal(event.evidence!.length, 2);
    assert.equal(event.execution_id, "exec_abc_123");
    assert.equal(event.correlation_id, "exec_abc_123"); // defaults to execution_id
    assert.ok(event.fired_at);
  } finally {
    cleanupTestEnv();
  }
});

test("crm: fireLeadCreated includes evidence refs and execution_id", async () => {
  setupTestEnv();
  try {
    const hooks = new CRMAlbraHooks({}); // not configured → fire() no-ops but we test buildEvent path
    // Access buildEvent through the convenience method by intercepting fire
    let captured: any = null;
    const origFire = (hooks as any).fire.bind(hooks);
    (hooks as any).fire = async (e: any) => { captured = e; return origFire(e); };

    await hooks.fireLeadCreated(makeLead(), { execution_id: "exec_e2e_9" });

    assert.ok(captured);
    assert.equal(captured.event_type, "lead.created");
    assert.equal(captured.lead_id, "lead_crm_1");
    assert.equal(captured.execution_id, "exec_e2e_9");
    assert.ok(Array.isArray(captured.evidence));
    assert.ok(captured.evidence.some((e: any) => e.field === "email"));
  } finally {
    cleanupTestEnv();
  }
});

test("crm: contractual delivery works against a real local HTTP endpoint", async () => {
  setupTestEnv();
  try {
    const http = await import("http");
    const received: any[] = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ headers: req.headers, body: JSON.parse(body) });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address() as any;

    const hooks = new CRMAlbraHooks({ webhook_url: `http://127.0.0.1:${addr.port}/hook`, enabled: true });
    const lead = makeLead();
    await hooks.fireLeadScored(lead, 78, { execution_id: "exec_crm_deliver_1" });

    assert.equal(received.length, 1);
    const ev = received[0].body;
    assert.ok(ev.event_id.startsWith("evt_"));
    assert.equal(ev.event_type, "lead.scored");
    assert.equal(ev.target_agent, "CRM-ALBRA");
    assert.equal(ev.execution_id, "exec_crm_deliver_1");
    assert.equal(received[0].headers["x-agente-leads-event"], "lead.scored");

    await new Promise<void>((r) => server.close(() => r()));
  } finally {
    cleanupTestEnv();
  }
});
