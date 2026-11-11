// ============================================================
// tests/feedback.test.ts — PRODUCTION CLOSURE §23
// Feedback: lead accepted/rejected, score, provider, outreach.
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, cleanupTestEnv } from "./setup.js";
import {
  recordLeadFeedback,
  recordProviderFeedback,
  recordOutreachFeedback,
  getFeedbackStats,
} from "../src/agent/feedback.js";

test("feedback: records and aggregates all four feedback classes", () => {
  setupTestEnv();
  try {
    recordLeadFeedback("lead_1", "lead_accepted", "good fit", "operator");
    recordLeadFeedback("lead_2", "lead_rejected", "out of niche", "operator");
    recordLeadFeedback("lead_1", "score_correct");
    recordLeadFeedback("lead_3", "score_incorrect", "overrated");

    recordProviderFeedback("OpenStreetMap", true, "exec_1");
    recordProviderFeedback("DuckDuckGo", false, "exec_1");

    recordOutreachFeedback("lead_1", "email", true, "sg_123");
    recordOutreachFeedback("lead_2", "whatsapp", false);

    const stats = getFeedbackStats();
    assert.equal(stats.leads.accepted, 1);
    assert.equal(stats.leads.rejected, 1);
    assert.equal(stats.scores.correct, 1);
    assert.equal(stats.scores.incorrect, 1);
    assert.equal(stats.providers.useful, 1);
    assert.equal(stats.providers.not_useful, 1);
    assert.equal(stats.outreach.successful, 1);
    assert.equal(stats.outreach.failed, 1);
  } finally {
    cleanupTestEnv();
  }
});

test("feedback: empty store returns zeroed stats (no crash)", () => {
  setupTestEnv();
  try {
    const stats = getFeedbackStats();
    assert.equal(stats.leads.accepted, 0);
    assert.equal(stats.outreach.failed, 0);
  } finally {
    cleanupTestEnv();
  }
});
