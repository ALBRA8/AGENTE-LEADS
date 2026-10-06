// ============================================================
// tests/outreach.test.ts — P2.1 + P2.2 + P2.3 + P2.4 Outreach
//
// Tests use MockOutreachProvider so no real SendGrid/WhatsApp
// calls are made.
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { runOutreach } from "../src/agent/pipelines/outreach.js";
import { MockOutreachProvider } from "../src/agent/providers/outreach.js";
import { CRMAlbraHooks } from "../src/agent/pipelines/crm_albra_hooks.js";
import { found, notFound } from "../src/agent/core/evidence.js";
import type { Lead } from "../src/agent/core/lead.js";

function makeLead(overrides?: Partial<Lead>): Lead {
  return {
    name: "Vegan Heaven Medellín",
    email: "hello@veganheaven.com",
    website: "https://veganheaven.com.co",
    sources: ["MockDiscovery", "GoogleSearch"],
    discovered_at: new Date().toISOString(),
    evidence: [
      found("email", "hello@veganheaven.com", "Google", "found in bio"),
      found("website", "https://veganheaven.com.co", "Google", "found in bio"),
    ],
    validation: {
      email: { status: "valid", confidence: "high", checked_at: new Date().toISOString(), source: "FakeVerifier", notes: "ok" },
    },
    research_state: "VALIDATED",
    ...overrides,
  } as Lead;
}

// Fake proposal generator — used to avoid real LLM calls in tests.
// Returns a deterministic 150-word proposal mentioning the lead's name.
const FAKE_PROPOSAL_GENERATOR = async (lead: Lead, _offer: string, _style: string): Promise<string> => {
  return `Hola ${lead.name},\n\nNotamos que tu negocio podría beneficiarse de nuestros servicios. ` +
    `Basándonos en la información pública disponible, vemos oportunidades de mejora. ` +
    `Nos gustaría conversar contigo sobre cómo podemos ayudarte a crecer. ` +
    `¿Tienes disponibilidad esta semana para una llamada de 15 minutos?\n\nSaludos cordiales,\nEquipo AGENTE LEADS`;
};

test("runOutreach: skips leads below min_score", async () => {
  // Lead with score 30 < min_score 50 → skipped
  const lead = makeLead();
  lead.lead_score = 30;

  const result = await runOutreach({
    leads: [lead],
    min_score: 50,
    offer_description: "Marketing digital",
    email_provider: new MockOutreachProvider(),
    whatsapp_provider: new MockOutreachProvider(),
    crm_hooks: null,
    proposal_generator: FAKE_PROPOSAL_GENERATOR,
    dry_run: true,
  });

  assert.equal(result.total_leads, 1);
  assert.equal(result.qualified_leads, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.results[0].status, "skipped");
  // skip_reason mentions the score threshold, and skip_reasons aggregate has "below_score_threshold"
  assert.ok(result.results[0].skip_reason!.includes("score"), `got: ${result.results[0].skip_reason}`);
  assert.ok(result.skip_reasons.some((sr) => sr.reason === "below_score_threshold"));
});

test("runOutreach: skips leads with no contact channel", async () => {
  const lead = makeLead({ email: undefined, phone: undefined, validation: {} });
  lead.lead_score = 70;

  const result = await runOutreach({
    leads: [lead],
    min_score: 50,
    offer_description: "Marketing",
    email_provider: new MockOutreachProvider(),
    whatsapp_provider: new MockOutreachProvider(),
    crm_hooks: null,
    proposal_generator: FAKE_PROPOSAL_GENERATOR,
    dry_run: false,  // would send if it had a channel
  });

  assert.equal(result.skipped, 1);
  assert.ok(result.results[0].skip_reason!.includes("no_contact_channel"));
});

test("runOutreach: dry_run=true generates proposal but doesn't send", async () => {
  const lead = makeLead();
  lead.lead_score = 70;

  const result = await runOutreach({
    leads: [lead],
    min_score: 50,
    offer_description: "Marketing",
    email_provider: new MockOutreachProvider(),
    whatsapp_provider: new MockOutreachProvider(),
    crm_hooks: null,
    proposal_generator: FAKE_PROPOSAL_GENERATOR,
    dry_run: true,
  });

  assert.equal(result.sent, 0);  // nothing sent in dry run
  // Should have generated a proposal
  assert.ok(result.results[0].proposal !== undefined || result.results[0].status === "dry_run");
});

test("runOutreach: with email provider configured, sends email for validated email leads", async () => {
  const lead = makeLead();
  lead.lead_score = 70;

  const result = await runOutreach({
    leads: [lead],
    min_score: 50,
    offer_description: "Marketing digital para restaurantes",
    email_provider: new MockOutreachProvider(),
    whatsapp_provider: new MockOutreachProvider(),
    crm_hooks: null,
    proposal_generator: FAKE_PROPOSAL_GENERATOR,
    dry_run: false,  // ACTUALLY SEND via mock
  });

  assert.equal(result.sent, 1);
  assert.equal(result.results[0].status, "sent");
  assert.equal(result.results[0].channel, "email");
  assert.ok(result.results[0].message_id);
});

test("runOutreach: uses WhatsApp for leads without email but with phone", async () => {
  const lead = makeLead({
    email: undefined,
    phone: "+573115678901",
    validation: {},  // no validated email → fall back to whatsapp
  });
  lead.lead_score = 70;

  const result = await runOutreach({
    leads: [lead],
    min_score: 50,
    offer_description: "Marketing",
    email_provider: new MockOutreachProvider(),
    whatsapp_provider: new MockOutreachProvider(),
    crm_hooks: null,
    proposal_generator: FAKE_PROPOSAL_GENERATOR,
    dry_run: false,
  });

  assert.equal(result.sent, 1);
  assert.equal(result.results[0].channel, "whatsapp");
  assert.equal(result.results[0].status, "sent");
});

test("runOutreach: attaches outreach_sent evidence to lead", async () => {
  const lead = makeLead();
  lead.lead_score = 70;
  const before = lead.evidence.length;

  await runOutreach({
    leads: [lead],
    min_score: 50,
    offer_description: "Marketing",
    email_provider: new MockOutreachProvider(),
    whatsapp_provider: new MockOutreachProvider(),
    crm_hooks: null,
    proposal_generator: FAKE_PROPOSAL_GENERATOR,
    dry_run: false,
  });

  const after = lead.evidence.length;
  assert.ok(after > before, "outreach_sent evidence should be added");
  const ev = lead.evidence.find((e) => e.field === "outreach_sent");
  assert.ok(ev);
  assert.equal(ev!.status, "INFERRED");
});

test("runOutreach: fires CRM-ALBRA webhook on send (if configured)", async () => {
  const lead = makeLead();
  lead.lead_score = 70;

  const crmHooks = new CRMAlbraHooks({
    webhook_url: "http://127.0.0.1:1/crm-hook",  // port 1 = instant connection refused
    enabled: true,
  });

  const result = await runOutreach({
    leads: [lead],
    min_score: 50,
    offer_description: "Marketing",
    email_provider: new MockOutreachProvider(),
    whatsapp_provider: new MockOutreachProvider(),
    crm_hooks: crmHooks,
    proposal_generator: FAKE_PROPOSAL_GENERATOR,
    dry_run: false,
  });

  assert.equal(result.sent, 1);
  // CRM hook stats: 1 attempt (may or may not have succeeded due to invalid URL)
  const stats = crmHooks.getStats();
  assert.ok(stats.sent + stats.failed >= 1, "CRM hook should have been attempted");
});

// ── CRM-ALBRA hooks (P2.3) ────────────────────────────────

test("CRMAlbraHooks: isConfigured returns false without webhook_url", () => {
  const h = new CRMAlbraHooks({});
  assert.equal(h.isConfigured(), false);
});

test("CRMAlbraHooks: isConfigured returns true with webhook_url + enabled", () => {
  const h = new CRMAlbraHooks({ webhook_url: "https://example.com/hook", enabled: true });
  assert.equal(h.isConfigured(), true);
});

test("CRMAlbraHooks: fire() returns delivered=false when not configured", async () => {
  const h = new CRMAlbraHooks({});
  const r = await h.fire({ type: "lead.created", payload: {}, fired_at: new Date().toISOString() });
  assert.equal(r.ok, true);
  assert.equal(r.data!.delivered, false);
});

test("CRMAlbraHooks: getStats returns sent+failed counts", () => {
  const h = new CRMAlbraHooks({});
  const stats = h.getStats();
  assert.equal(stats.sent, 0);
  assert.equal(stats.failed, 0);
});
