// ============================================================
// tests/quality_persistence.test.ts — PRODUCTION CLOSURE §14
// Provider quality: persistence + degradation detection.
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, cleanupTestEnv } from "./setup.js";
import { ExecutionRecorder } from "../src/agent/core/execution.js";
import {
  computeProviderMetrics,
  persistProviderMetrics,
  isProviderDegraded,
  formatProviderMetrics,
} from "../src/agent/pipelines/quality.js";
import { getDb } from "../src/agent/storage/lead_intelligence.js";

function makeTrace(provider: string, oks: number, fails: number) {
  const trace = new ExecutionRecorder("test request");
  for (let i = 0; i < oks; i++) {
    const end = trace.start(`step.ok.${i}`, { provider, intent: "test" });
    end({ output: `${i} results` });
  }
  for (let i = 0; i < fails; i++) {
    const end = trace.start(`step.fail.${i}`, { provider, intent: "test" });
    end({ error: { type: "RATE_LIMIT", message: "429", retryable: true } });
  }
  return trace.finish(oks > 0 ? "success" : "failed", "done");
}

test("quality: computeProviderMetrics measures success/failure/latency", () => {
  const trace = makeTrace("TestProvider", 3, 1);
  const metrics = computeProviderMetrics(trace);
  assert.equal(metrics.length, 1);
  const m = metrics[0];
  assert.equal(m.provider, "TestProvider");
  assert.equal(m.total_calls, 4);
  assert.equal(m.successful_calls, 3);
  assert.equal(m.failed_calls, 1);
  assert.equal(m.success_rate, 75);
  assert.equal(m.failure_breakdown["RATE_LIMIT"], 1);
});

test("quality: persistProviderMetrics writes rows with usable_results", () => {
  setupTestEnv();
  try {
    const trace = makeTrace("PersistProvider", 2, 1);
    persistProviderMetrics(trace);
    const rows = getDb()
      .prepare("SELECT * FROM provider_metrics WHERE provider = 'PersistProvider'")
      .all() as any[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].requests, 3);
    assert.equal(rows[0].success_rate, 67); // Math.round(2/3*100) = 67 (integer rounding per P1.4)
    assert.equal(rows[0].usable_results, 2); // ok steps with output
  } finally {
    cleanupTestEnv();
  }
});

test("quality: isProviderDegraded flags providers below threshold (weighted window)", () => {
  setupTestEnv();
  try {
    // 4 consecutive executions at 0% success → degraded
    for (let i = 0; i < 4; i++) {
      persistProviderMetrics(makeTrace("BadProvider", 0, 3));
    }
    persistProviderMetrics(makeTrace("GoodProvider", 3, 0));

    const bad = isProviderDegraded("BadProvider");
    assert.equal(bad.degraded, true);
    assert.equal(bad.window_requests, 12);

    const good = isProviderDegraded("GoodProvider");
    assert.equal(good.degraded, false);

    // Unknown provider → not degraded (no history)
    const unknown = isProviderDegraded("NeverSeenProvider");
    assert.equal(unknown.degraded, false);
    assert.equal(unknown.window_requests, 0);
  } finally {
    cleanupTestEnv();
  }
});

test("quality: formatProviderMetrics renders a readable table", () => {
  const trace = makeTrace("FormatProvider", 2, 1);
  const text = formatProviderMetrics(computeProviderMetrics(trace));
  assert.ok(text.includes("Provider"));
  assert.ok(text.includes("FormatProvider"));
  assert.ok(text.includes("33.33%") || text.includes("RATE_LIMIT"));
});
