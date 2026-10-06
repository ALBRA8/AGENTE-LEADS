// ============================================================
// tests/quality.test.ts — P1.4 Provider quality metrics
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeProviderMetrics, formatProviderMetrics } from "../src/agent/pipelines/quality.js";
import type { ExecutionTrace } from "../src/agent/core/execution.js";

function makeTrace(steps: Partial<ExecutionTrace["steps"][number]>[]): ExecutionTrace {
  return {
    id: "test_trace",
    user_request: "test",
    started_at: new Date().toISOString(),
    steps: steps.map((s, i) => ({
      name: s.name ?? `step_${i}`,
      status: s.status ?? "ok",
      started_at: s.started_at ?? new Date().toISOString(),
      ended_at: s.ended_at ?? new Date().toISOString(),
      duration_ms: s.duration_ms ?? 100,
      provider: s.provider,
      intent: s.intent,
      input: s.input,
      output: s.output,
      error_type: s.error_type,
      error_message: s.error_message,
    })),
    outcome: "success",
  };
}

test("computeProviderMetrics: returns empty array for trace with no provider steps", () => {
  const trace = makeTrace([{ name: "step1" }, { name: "step2" }]);
  const m = computeProviderMetrics(trace);
  assert.equal(m.length, 0);
});

test("computeProviderMetrics: groups calls by provider", () => {
  const trace = makeTrace([
    { name: "discovery.mock", provider: "MockDiscovery", status: "ok", duration_ms: 50 },
    { name: "discovery.mock", provider: "MockDiscovery", status: "ok", duration_ms: 70 },
    { name: "validation.email", provider: "FakeVerifier", status: "ok", duration_ms: 100 },
    { name: "validation.email", provider: "FakeVerifier", status: "failed", error_type: "TIMEOUT", duration_ms: 0 },
  ]);
  const m = computeProviderMetrics(trace);
  assert.equal(m.length, 2);
  const mock = m.find((x) => x.provider === "MockDiscovery");
  assert.ok(mock);
  assert.equal(mock!.total_calls, 2);
  assert.equal(mock!.successful_calls, 2);
  assert.equal(mock!.failed_calls, 0);
  assert.equal(mock!.success_rate, 100);
  assert.equal(mock!.avg_latency_ms, 60);  // (50 + 70) / 2
});

test("computeProviderMetrics: computes failure breakdown", () => {
  const trace = makeTrace([
    { name: "x", provider: "P", status: "failed", error_type: "TIMEOUT" },
    { name: "x", provider: "P", status: "failed", error_type: "TIMEOUT" },
    { name: "x", provider: "P", status: "failed", error_type: "AUTH_FAILURE" },
    { name: "x", provider: "P", status: "ok" },
  ]);
  const m = computeProviderMetrics(trace);
  assert.equal(m.length, 1);
  const p = m[0];
  assert.equal(p.total_calls, 4);
  assert.equal(p.successful_calls, 1);
  assert.equal(p.failed_calls, 3);
  assert.equal(p.failure_breakdown.TIMEOUT, 2);
  assert.equal(p.failure_breakdown.AUTH_FAILURE, 1);
  assert.equal(p.success_rate, 25);  // 1 of 4 = 25%
});

test("computeProviderMetrics: sorts by total_calls descending", () => {
  const trace = makeTrace([
    { provider: "A", status: "ok" },
    { provider: "A", status: "ok" },
    { provider: "B", status: "ok" },
  ]);
  const m = computeProviderMetrics(trace);
  assert.equal(m[0].provider, "A");
  assert.equal(m[0].total_calls, 2);
  assert.equal(m[1].provider, "B");
  assert.equal(m[1].total_calls, 1);
});

test("formatProviderMetrics: produces Markdown table", () => {
  const trace = makeTrace([
    { provider: "MockDiscovery", status: "ok", duration_ms: 50 },
    { provider: "MockDiscovery", status: "failed", error_type: "RATE_LIMIT", duration_ms: 0 },
  ]);
  const m = computeProviderMetrics(trace);
  const text = formatProviderMetrics(m);
  assert.ok(text.includes("| Provider"));
  assert.ok(text.includes("MockDiscovery"));
  assert.ok(text.includes("RATE_LIMIT"));
});

test("formatProviderMetrics: empty metrics returns 'No provider calls recorded.'", () => {
  const text = formatProviderMetrics([]);
  assert.equal(text, "No provider calls recorded.");
});
