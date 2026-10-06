// ============================================================
// tests/health.test.ts — P3 production health check
//
// Verifies:
//   - checkHealth returns a status string (ok | degraded | down)
//   - timestamp is a valid ISO 8601 date
//   - all expected component keys are present
//   - uptime_seconds is a non-negative number
//   - formatHealth renders human-readable text with emoji + LLM model
//
// Run with:  node --test --import tsx tests/health.test.ts
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkHealth, formatHealth } from "../src/agent/health.js";

test("checkHealth: returns status string", () => {
  const h = checkHealth();
  assert.ok(["ok", "degraded", "down"].includes(h.status));
});

test("checkHealth: includes timestamp", () => {
  const h = checkHealth();
  assert.ok(h.timestamp);
  assert.ok(new Date(h.timestamp).getTime() > 0);
});

test("checkHealth: includes all component keys", () => {
  const h = checkHealth();
  assert.ok(h.components.nvidia_api_key);
  assert.ok(h.components.nvidia_model);
  assert.ok(h.components.telegram_bot_token);
  assert.ok(h.components.apify_token);
  assert.ok(h.components.sendgrid);
  assert.ok(h.components.whatsapp);
  assert.ok(h.components.crm_albra_webhook);
  assert.ok(h.components.conversations_db);
  assert.ok(h.components.lead_intelligence_db);
  assert.ok(h.components.python_venv);
});

test("checkHealth: returns uptime_seconds >= 0", () => {
  const h = checkHealth();
  assert.ok(h.uptime_seconds >= 0);
});

test("formatHealth: returns human-readable text with emoji", () => {
  const h = checkHealth();
  const text = formatHealth(h);
  assert.ok(text.includes("AGENTE LEADS"));
  assert.ok(text.includes("Health"));
  assert.ok(text.match(/✅|⚠️|❌/));
});

test("formatHealth: includes LLM model name", () => {
  const h = checkHealth();
  const text = formatHealth(h);
  assert.ok(text.includes("LLM:"));
  assert.ok(text.includes(h.components.nvidia_model));
});
