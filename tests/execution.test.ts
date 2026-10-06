// ============================================================
// tests/execution.test.ts — P0.11 Observability (ExecutionTrace)
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { ExecutionRecorder } from "../src/agent/core/execution.js";

test("ExecutionRecorder: starts with in_progress outcome", () => {
  const r = new ExecutionRecorder("test request");
  const trace = r.getTrace();
  assert.equal(trace.outcome, "in_progress");
  assert.equal(trace.user_request, "test request");
  assert.equal(trace.steps.length, 0);
  assert.ok(trace.id.startsWith("exec_"));
});

test("ExecutionRecorder: start() returns end function", () => {
  const r = new ExecutionRecorder("test");
  const end = r.start("discovery.apify", { provider: "Apify", intent: "search" });
  assert.equal(r.getTrace().steps.length, 1);
  assert.equal(r.getTrace().steps[0].status, "started");
  end({ output: "5 candidates" });
  assert.equal(r.getTrace().steps[0].status, "ok");
  assert.equal(r.getTrace().steps[0].output, "5 candidates");
  assert.ok(r.getTrace().steps[0].duration_ms !== undefined);
});

test("ExecutionRecorder: end with error marks step failed + records error_type", () => {
  const r = new ExecutionRecorder("test");
  const end = r.start("validation.email");
  end({ error: { type: "AUTH_FAILURE", message: "no token", retryable: false } });
  const step = r.getTrace().steps[0];
  assert.equal(step.status, "failed");
  assert.equal(step.error_type, "AUTH_FAILURE");
  assert.equal(step.error_message, "no token");
});

test("ExecutionRecorder: end with Error instance marks UNKNOWN error_type", () => {
  const r = new ExecutionRecorder("test");
  const end = r.start("validation.email");
  end({ error: new Error("network glitch") });
  const step = r.getTrace().steps[0];
  assert.equal(step.status, "failed");
  assert.equal(step.error_type, "UNKNOWN");
  assert.equal(step.error_message, "network glitch");
});

test("ExecutionRecorder: skip() records a skipped step", () => {
  const r = new ExecutionRecorder("test");
  r.skip("research.scrapling", "provider not configured", { provider: "Scrapling" });
  const step = r.getTrace().steps[0];
  assert.equal(step.status, "skipped");
  assert.equal(step.provider, "Scrapling");
});

test("ExecutionRecorder: finish() sets outcome + ended_at + total_duration_ms", () => {
  const r = new ExecutionRecorder("test request");
  // Wait a tiny bit to ensure duration > 0
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      const trace = r.finish("success", "10 leads stored");
      assert.equal(trace.outcome, "success");
      assert.equal(trace.summary, "10 leads stored");
      assert.ok(trace.ended_at);
      assert.ok(trace.total_duration_ms !== undefined && trace.total_duration_ms >= 0);
      resolve();
    }, 10);
  });
});

test("ExecutionRecorder: trace answers all observability questions", () => {
  // P0.11 requires each execution to answer:
  //   - what it tried to do       (intent)
  //   - which provider it used    (provider)
  //   - what it found              (output)
  //   - what failed                (error_type + error_message)
  //   - what was validated         (step name + status)
  //   - what was stored             (output of storage step)
  //   - how long it took           (duration_ms)
  const r = new ExecutionRecorder("restaurantes veganos en Medellín +5000 seguidores");
  r.start("discovery.mock", { provider: "MockDiscovery", intent: "search vegan Medellín" })({ output: "3 candidates" });
  r.start("research.googles")({ output: "found website + email" });
  r.start("validation.email", { provider: "RapidEmailVerifier" })({ output: "email valid" });
  r.start("dedup")({ output: "created lead_123" });
  r.skip("research.scrapling", "venv not configured");
  const trace = r.finish("success", "3 leads stored");
  assert.equal(trace.steps.length, 5);
  assert.equal(trace.steps[0].name, "discovery.mock");
  assert.equal(trace.steps[0].provider, "MockDiscovery");
  assert.equal(trace.steps[0].intent, "search vegan Medellín");
  assert.equal(trace.steps[1].output, "found website + email");
  assert.equal(trace.steps[3].output, "created lead_123");
  assert.equal(trace.steps[4].status, "skipped");
  assert.ok(trace.total_duration_ms !== undefined);
});
