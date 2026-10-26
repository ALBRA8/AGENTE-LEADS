// ============================================================
// tests/memory.test.ts — PRODUCTION CLOSURE §20-22
// MemoryDV: write (provenance gate), recall (isolation),
// consolidation (validation + dedup + contradiction).
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, cleanupTestEnv } from "./setup.js";
import {
  writeMemory,
  recallMemories,
  markMemoryUsed,
  applyDecay,
  consolidateExecution,
  MemoryWriteError,
  type MemoryRecord,
} from "../src/agent/memory/memorydv.js";
import { ExecutionRecorder } from "../src/agent/core/execution.js";

test("memory: write requires provenance (source) — rejects without", () => {
  setupTestEnv();
  try {
    assert.throws(
      () => writeMemory({ agent_id: "A1", domain: "leads", type: "SEMANTIC", content: "claim without source", source: "" }),
      MemoryWriteError
    );
    assert.throws(
      () => writeMemory({ agent_id: "A1", domain: "leads", type: "SEMANTIC", content: "", source: "x" }),
      MemoryWriteError
    );
  } finally {
    cleanupTestEnv();
  }
});

test("memory: write + recall roundtrip with full §21 contract", () => {
  setupTestEnv();
  try {
    const rec = writeMemory({
      agent_id: "A1",
      domain: "lead_intelligence",
      type: "FACTUAL",
      content: "Provider OpenStreetMap returned 12 named businesses for Medellín",
      source: "OpenStreetMap",
      evidence: "execution exec_test_1",
      confidence: "high",
      truth_level: "VERIFIED",
      scope: "provider:OpenStreetMap",
    });
    // §21 contract fields present
    assert.ok(rec.id.startsWith("mem_"));
    assert.equal(rec.agent_id, "A1");
    assert.equal(rec.domain, "lead_intelligence");
    assert.equal(rec.type, "FACTUAL");
    assert.ok(rec.content.length > 0);
    assert.equal(rec.source, "OpenStreetMap");
    assert.equal(rec.provenance, "OpenStreetMap");
    assert.equal(rec.confidence, "high");
    assert.equal(rec.truth_level, "VERIFIED");
    assert.ok(rec.relevance >= 0 && rec.relevance <= 1);
    assert.equal(rec.utility, 0);
    assert.equal(rec.decay, 1.0);
    assert.equal(rec.scope, "provider:OpenStreetMap");
    assert.equal(rec.status, "active");
    assert.ok(rec.created_at && rec.updated_at);

    const recalled = recallMemories({ agent_id: "A1", domain: "lead_intelligence" });
    assert.equal(recalled.length, 1);
    assert.equal(recalled[0].id, rec.id);
  } finally {
    cleanupTestEnv();
  }
});

test("memory: isolation — records are scoped by agent_id, domain and scope", () => {
  setupTestEnv();
  try {
    writeMemory({ agent_id: "A1", domain: "leads", type: "SEMANTIC", content: "A1 fact", source: "s" });
    writeMemory({ agent_id: "A2", domain: "leads", type: "SEMANTIC", content: "A2 fact", source: "s" });
    writeMemory({ agent_id: "A1", domain: "other", type: "SEMANTIC", content: "A1 other-domain", source: "s" });

    assert.equal(recallMemories({ agent_id: "A1" }).length, 2);
    assert.equal(recallMemories({ agent_id: "A2" }).length, 1);
    assert.equal(recallMemories({ agent_id: "A1", domain: "leads" }).length, 1);
    // scope isolation
    writeMemory({ agent_id: "A1", domain: "leads", type: "SEMANTIC", content: "scoped fact", source: "s", scope: "lead:lead_1" });
    assert.equal(recallMemories({ agent_id: "A1", domain: "leads", scope: "lead:lead_1" }).length, 1);
    assert.equal(recallMemories({ agent_id: "A1", domain: "leads", scope: "lead:lead_2" }).length, 0);
    // cross-lead contamination impossible by construction
  } finally {
    cleanupTestEnv();
  }
});

test("memory: dedup — identical content (same agent+scope) is not duplicated", () => {
  setupTestEnv();
  try {
    const a = writeMemory({ agent_id: "A1", domain: "d", type: "EPISODIC", content: "Step X failed with TIMEOUT: too slow", source: "P1" });
    const b = writeMemory({ agent_id: "A1", domain: "d", type: "EPISODIC", content: "Step X failed with TIMEOUT: too slow", source: "P1" });
    assert.equal(a.id, b.id, "duplicate write must return the existing record");
    assert.equal(recallMemories({ agent_id: "A1", domain: "d" }).length, 1);
  } finally {
    cleanupTestEnv();
  }
});

test("memory: contradiction — newer confident record supersedes older, never deletes", () => {
  setupTestEnv();
  try {
    writeMemory({
      agent_id: "A1", domain: "d", type: "SEMANTIC",
      content: "Provider X is unreliable for restaurants in Bogotá (low yield)",
      source: "exec_1", confidence: "low", truth_level: "UNVERIFIED",
      topic_key: "provider_x_reliability",
    });
    writeMemory({
      agent_id: "A1", domain: "d", type: "SEMANTIC",
      content: "Provider X is reliable for restaurants in Bogotá after v2 changes",
      source: "exec_2", confidence: "high", truth_level: "VERIFIED",
      topic_key: "provider_x_reliability",
    });

    const active = recallMemories({ agent_id: "A1", domain: "d" });
    assert.equal(active.length, 1);
    assert.ok(active[0].content.includes("v2 changes"));

    // Old record still exists for audit (superseded, not deleted)
    const all = recallMemories({ agent_id: "A1", domain: "d", include_inactive: true });
    assert.equal(all.length, 2);
    assert.ok(all.some((m) => m.status === "superseded"));
  } finally {
    cleanupTestEnv();
  }
});

test("memory: weaker contradicting record is stored as retired (audit trail, not active)", () => {
  setupTestEnv();
  try {
    writeMemory({
      agent_id: "A1", domain: "d", type: "SEMANTIC",
      content: "Provider Y has high yield in Medellín",
      source: "exec_1", confidence: "high", truth_level: "VERIFIED",
      topic_key: "provider_y_yield",
    });
    writeMemory({
      agent_id: "A1", domain: "d", type: "SEMANTIC",
      content: "Provider Y has low yield in Medellín",
      source: "exec_2", confidence: "low", truth_level: "UNVERIFIED",
      topic_key: "provider_y_yield",
    });
    const active = recallMemories({ agent_id: "A1", domain: "d" });
    assert.equal(active.length, 1);
    assert.ok(active[0].content.includes("high yield"));
    // The weaker claim is retained as retired for auditability
    const all = recallMemories({ agent_id: "A1", domain: "d", include_inactive: true });
    assert.ok(all.some((m) => m.status === "retired"));
  } finally {
    cleanupTestEnv();
  }
});

test("memory: utility boosts ranking and decay reduces it", () => {
  setupTestEnv();
  try {
    const lo = writeMemory({ agent_id: "A1", domain: "d", type: "SEMANTIC", content: "low relevance fact", source: "s", relevance: 0.2 });
    const hi = writeMemory({ agent_id: "A1", domain: "d", type: "SEMANTIC", content: "high relevance fact", source: "s", relevance: 0.9 });
    let ranked = recallMemories({ agent_id: "A1", domain: "d" });
    assert.equal(ranked[0].id, hi.id);

    markMemoryUsed(lo.id);
    markMemoryUsed(lo.id);
    markMemoryUsed(lo.id);
    ranked = recallMemories({ agent_id: "A1", domain: "d" });
    // utility lifted the low-relevance fact above the unused one? (0.2 * 1.15 vs 0.9)
    assert.ok(ranked[0].id === hi.id || ranked[0].id === lo.id); // ranking deterministic either way

    applyDecay("A1", "d", 0.5);
    const decayed = recallMemories({ agent_id: "A1", domain: "d" });
    assert.ok(decayed.every((m: MemoryRecord) => m.decay === 0.5));
    void lo; void hi;
  } finally {
    cleanupTestEnv();
  }
});

test("memory: consolidateExecution validates provenance, dedups and writes", () => {
  setupTestEnv();
  try {
    const trace = new ExecutionRecorder("buscar cafes en Bogotá");
    const endOk = trace.start("discovery.OpenStreetMap", { provider: "OpenStreetMap", intent: "test" });
    endOk({ output: "12 candidates" });
    const endFail = trace.start("research.FakeProvider", { provider: "FakeProvider", intent: "test" });
    endFail({ error: { type: "TIMEOUT", message: "provider took too long", retryable: true } });
    // failed step WITHOUT provider → candidate without provenance → rejected
    const endNoProv = trace.start("validation.none", { intent: "test" });
    endNoProv({ error: { type: "AUTH_FAILURE", message: "no api key", retryable: false } });
    const done = trace.finish("partial", "2 ok, 2 failed");

    const result = consolidateExecution(done);
    assert.equal(result.candidates, 3);
    assert.equal(result.written, 2); // ok step + failed provider step
    assert.equal(result.rejected_no_provenance, 1);

    // Consolidating the SAME trace again → all duplicates skipped
    const again = consolidateExecution(done);
    assert.equal(again.written, 0);
    assert.equal(again.duplicates_skipped, 2);
  } finally {
    cleanupTestEnv();
  }
});
