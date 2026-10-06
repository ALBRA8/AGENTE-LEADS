// ============================================================
// tests/scoring.test.ts — P1.1 Lead Scoring
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreLead, runScoring } from "../src/agent/pipelines/scoring.js";
import { found, notFound, confirmedAbsent } from "../src/agent/core/evidence.js";
import { buildDedupSignature, type Lead } from "../src/agent/core/lead.js";

function makeLead(overrides?: Partial<Lead>): Lead {
  return {
    name: "Vegan Heaven",
    email: "hello@veganheaven.com",
    website: "https://veganheaven.com.co",
    sources: ["MockDiscovery"],
    discovered_at: new Date().toISOString(),
    evidence: [
      found("email", "hello@veganheaven.com", "Google", "found in bio"),
      found("website", "https://veganheaven.com.co", "Google", "found in bio"),
      notFound("phone", "Google"),
    ],
    validation: {
      email: { status: "valid", confidence: "high", checked_at: new Date().toISOString(), source: "RapidEmail", notes: "deliverable" },
      domain: { status: "valid", confidence: "medium", checked_at: new Date().toISOString(), source: "RapidEmail", notes: "HTTP 200" },
      identity: { status: "valid", confidence: "low", checked_at: new Date().toISOString(), source: "system-consistency", notes: "domains match" },
    },
    research_state: "VALIDATED",
    ...overrides,
  };
}

test("scoreLead: returns score in [0, 100]", () => {
  const { score } = scoreLead(makeLead());
  assert.ok(score >= 0 && score <= 100, `score ${score} out of range`);
});

test("scoreLead: validated email with high confidence = +20", () => {
  const { score, breakdown } = scoreLead(makeLead());
  const emailVal = breakdown.find((b) => b.field === "email_validation");
  assert.ok(emailVal);
  assert.equal(emailVal!.points, 20);
});

test("scoreLead: validated email medium confidence = +15", () => {
  const lead = makeLead({
    validation: {
      email: { status: "valid", confidence: "medium", checked_at: new Date().toISOString(), source: "x", notes: "" },
    },
  });
  const { breakdown } = scoreLead(lead);
  const emailVal = breakdown.find((b) => b.field === "email_validation");
  assert.equal(emailVal!.points, 15);
});

test("scoreLead: invalid email = -10", () => {
  const lead = makeLead({
    validation: {
      email: { status: "invalid", confidence: "medium", checked_at: new Date().toISOString(), source: "x", notes: "bounced" },
    },
  });
  const { breakdown } = scoreLead(lead);
  const emailVal = breakdown.find((b) => b.field === "email_validation");
  assert.equal(emailVal!.points, -10);
});

test("scoreLead: FOUND website = +10", () => {
  const { breakdown } = scoreLead(makeLead());
  const web = breakdown.find((b) => b.field === "website_found");
  assert.ok(web);
  assert.equal(web!.points, 10);
});

test("scoreLead: FOUND phone = +5", () => {
  const lead = makeLead({
    evidence: [found("phone", "+57 311", "x", "found")],
  });
  const { breakdown } = scoreLead(lead);
  const phone = breakdown.find((b) => b.field === "phone_found");
  assert.ok(phone);
  assert.equal(phone!.points, 5);
});

test("scoreLead: identity conflict = -10", () => {
  const lead = makeLead({
    validation: {
      identity: { status: "conflict", confidence: "low", checked_at: new Date().toISOString(), source: "system-consistency", notes: "domain mismatch" },
    },
  });
  const { breakdown } = scoreLead(lead);
  const conflict = breakdown.find((b) => b.field === "identity_conflict");
  assert.ok(conflict);
  assert.equal(conflict!.points, -10);
});

test("scoreLead: VALIDATED state bonus = +15", () => {
  const { breakdown } = scoreLead(makeLead({ research_state: "VALIDATED" }));
  const state = breakdown.find((b) => b.field === "research_state");
  assert.equal(state!.points, 15);
});

test("scoreLead: RESEARCHED state bonus = +10", () => {
  const { breakdown } = scoreLead(makeLead({ research_state: "RESEARCHED" }));
  const state = breakdown.find((b) => b.field === "research_state");
  assert.equal(state!.points, 10);
});

test("scoreLead: lead with full validated data scores high", () => {
  const lead = makeLead();  // already has validated email + found website
  const { score } = scoreLead(lead);
  assert.ok(score >= 50, `expected high score, got ${score}`);
});

test("scoreLead: empty lead scores low", () => {
  const emptyLead: Lead = {
    name: "Unknown",
    sources: ["x"],
    discovered_at: new Date().toISOString(),
    evidence: [],
    validation: {},
    research_state: "DISCOVERED",
  };
  const { score } = scoreLead(emptyLead);
  assert.ok(score <= 10, `expected low score, got ${score}`);
});

test("runScoring: attaches lead_score to lead + adds evidence", async () => {
  const lead = makeLead();
  const result = await runScoring({ lead });
  assert.equal(result.lead.lead_score, result.score);
  // Should have added an INFERRED evidence record for "lead_score"
  const scoreEv = result.lead.evidence.find((e) => e.field === "lead_score");
  assert.ok(scoreEv);
  assert.equal(scoreEv!.status, "INFERRED");
});
