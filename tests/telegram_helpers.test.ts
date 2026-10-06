import { test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, cleanupTestEnv } from "./setup.js";
import {
  splitMessage,
  escapeMarkdownV2,
  formatLeadSummary,
  buildHelpText,
  buildStatsText,
  TELEGRAM_MAX_MESSAGE_LENGTH,
} from "../src/bot/telegram_helpers.js";
import type { Lead } from "../src/agent/core/lead.js";

test("splitMessage: short message returns single chunk", () => {
  const result = splitMessage("hello");
  assert.equal(result.length, 1);
  assert.equal(result[0], "hello");
});

test("splitMessage: long message splits on paragraph boundaries", () => {
  const long = "Para1 line1.\n\nPara2 line2.\n\nPara3 line3.";
  // Make it long enough to trigger split
  const repeated = long.repeat(200);
  const chunks = splitMessage(repeated, 200);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 200, `chunk length ${chunk.length} > 200`);
  }
});

test("splitMessage: each chunk fits within maxLen", () => {
  const long = "a".repeat(10000);
  const chunks = splitMessage(long, 1000);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 1000);
  }
});

test("escapeMarkdownV2: escapes special Telegram chars", () => {
  const escaped = escapeMarkdownV2("hello_world [test]");
  assert.ok(escaped.includes("\\_"));
  assert.ok(escaped.includes("\\["));
  assert.ok(escaped.includes("\\]"));
});

test("formatLeadSummary: includes name and score", () => {
  const lead: Lead = {
    name: "Test Business",
    email: "x@y.com",
    website: "https://example.com",
    sources: ["test"],
    discovered_at: new Date().toISOString(),
    evidence: [],
    validation: {},
    research_state: "VALIDATED",
  } as Lead;
  lead.lead_score = 75;
  const summary = formatLeadSummary(lead);
  assert.ok(summary.includes("Test Business"));
  assert.ok(summary.includes("75"));
});

test("buildHelpText: includes command list", () => {
  const help = buildHelpText();
  assert.ok(help.includes("/start"));
  assert.ok(help.includes("/help"));
  assert.ok(help.includes("/stats"));
});

test("buildStatsText: returns formatted stats (may be empty if DB clean)", () => {
  setupTestEnv();
  try {
    const stats = buildStatsText();
    assert.ok(stats.includes("AGENTE LEADS"));
    assert.ok(stats.includes("Leads almacenados"));
  } finally {
    cleanupTestEnv();
  }
});

test("TELEGRAM_MAX_MESSAGE_LENGTH: is 4096", () => {
  assert.equal(TELEGRAM_MAX_MESSAGE_LENGTH, 4096);
});
