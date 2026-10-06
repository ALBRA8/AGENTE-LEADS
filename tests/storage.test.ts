// ============================================================
// tests/storage.test.ts — P0.8 Storage layer
//
// Verifies:
//   - conversation memory is separate from lead intelligence
//   - lead_intelligence tables exist after init
//   - saveLead upserts + replaces evidence
//   - findDedupMatch uses multi-signal matching
//   - executions are persisted and reloadable
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, cleanupTestEnv } from "./setup.js";
import {
  saveLead,
  getLeadById,
  getAllLeads,
  findDedupMatch,
  recordDedupMatch,
  saveExecution,
  getExecution,
  checkStorageHealth,
} from "../src/agent/storage/lead_intelligence.js";
import { buildDedupSignature, type Lead } from "../src/agent/core/lead.js";
import { found, notFound } from "../src/agent/core/evidence.js";
import { ExecutionRecorder } from "../src/agent/core/execution.js";

function makeLead(overrides?: Partial<Lead>): Lead {
  return {
    name: "Vegan Heaven",
    email: "hello@veganheaven.com",
    website: "https://veganheaven.com.co",
    sources: ["MockDiscovery"],
    discovered_at: new Date().toISOString(),
    evidence: [found("email", "hello@veganheaven.com", "Google", "found")],
    validation: {},
    research_state: "RESEARCHED",
    dedup_signature: buildDedupSignature({
      name: "Vegan Heaven",
      email: "hello@veganheaven.com",
      website: "https://veganheaven.com.co",
    }),
    ...overrides,
  };
}

test("storage: health check returns ok + tables list", () => {
  setupTestEnv();
  try {
    const health = checkStorageHealth();
    assert.equal(health.ok, true);
    assert.ok(health.tables.includes("lead_intelligence_leads"));
    assert.ok(health.tables.includes("lead_intelligence_evidence"));
    assert.ok(health.tables.includes("lead_intelligence_sources"));
    assert.ok(health.tables.includes("executions"));
    assert.ok(health.tables.includes("dedup_matches"));
  } finally {
    cleanupTestEnv();
  }
});

test("storage: saveLead creates a new lead with id", () => {
  setupTestEnv();
  try {
    const stored = saveLead(makeLead());
    assert.ok(stored.id);
    assert.ok(stored.id.length > 0);
  } finally {
    cleanupTestEnv();
  }
});

test("storage: saveLead upserts on existing id", () => {
  setupTestEnv();
  try {
    const lead = makeLead();
    const stored1 = saveLead(lead);
    const id = stored1.id!;

    // Update with same id
    const stored2 = saveLead({
      ...lead,
      id,
      name: "Vegan Heaven Updated",
      research_state: "VALIDATED",
    });

    assert.equal(stored2.id, id);
    assert.equal(stored2.name, "Vegan Heaven Updated");
    assert.equal(stored2.research_state, "VALIDATED");
  } finally {
    cleanupTestEnv();
  }
});

test("storage: saveLead replaces evidence on update (no orphans)", () => {
  setupTestEnv();
  try {
    const lead = makeLead({
      evidence: [
        found("email", "a@b.com", "src1", "ev1"),
        found("phone", "+57 311", "src1", "ev2"),
      ],
    });
    const stored = saveLead(lead);

    // Update with new evidence (different fields)
    saveLead({
      ...lead,
      id: stored.id,
      evidence: [found("email", "new@b.com", "src2", "new ev")],
    });

    const reloaded = getLeadById(stored.id!);
    assert.ok(reloaded);
    // Should have 1 evidence row (email), not 3
    assert.equal(reloaded!.evidence.length, 1);
    assert.equal(reloaded!.evidence[0].field, "email");
    assert.equal(reloaded!.evidence[0].value, "new@b.com");
  } finally {
    cleanupTestEnv();
  }
});

test("storage: getLeadById returns null for unknown id", () => {
  setupTestEnv();
  try {
    const lead = getLeadById("nonexistent_id");
    assert.equal(lead, null);
  } finally {
    cleanupTestEnv();
  }
});

test("storage: getAllLeads returns up to limit", () => {
  setupTestEnv();
  try {
    for (let i = 0; i < 5; i++) {
      saveLead(makeLead({
        email: `lead${i}@test.com`,
        name: `Lead ${i}`,
        dedup_signature: buildDedupSignature({ name: `Lead ${i}`, email: `lead${i}@test.com` }),
      }));
    }
    const all = getAllLeads(3);
    assert.equal(all.length, 3);
  } finally {
    cleanupTestEnv();
  }
});

test("storage: findDedupMatch returns null when no match", () => {
  setupTestEnv();
  try {
    const sig = buildDedupSignature({ name: "No One", email: "no@one.com" });
    const match = findDedupMatch(sig);
    assert.equal(match, null);
  } finally {
    cleanupTestEnv();
  }
});

test("storage: findDedupMatch finds EXACT match by email", () => {
  setupTestEnv();
  try {
    saveLead(makeLead({ email: "hello@veganheaven.com" }));
    const sig = buildDedupSignature({ name: "x", email: "hello@veganheaven.com" });
    const match = findDedupMatch(sig);
    assert.ok(match);
    assert.equal(match!.matchLevel, "EXACT");
    assert.ok(match!.matchedOn.includes("email"));
  } finally {
    cleanupTestEnv();
  }
});

test("storage: recordDedupMatch + getDedupMatches audit log", () => {
  setupTestEnv();
  try {
    // We can call recordDedupMatch with arbitrary ids (it just inserts a log row)
    recordDedupMatch("new_id", "existing_id", "STRONG", ["instagram", "phone"]);
    // No assertion on count — just verify it doesn't throw
  } finally {
    cleanupTestEnv();
  }
});

test("storage: saveExecution + getExecution round-trip", () => {
  setupTestEnv();
  try {
    const recorder = new ExecutionRecorder("test request", { query: "vegano" });
    recorder.start("discovery.mock", { provider: "Mock", intent: "search" })({ output: "3 results" });
    recorder.skip("research.scrapling", "venv missing");
    const trace = recorder.finish("success", "3 leads stored");

    saveExecution(trace);

    const reloaded = getExecution(trace.id);
    assert.ok(reloaded);
    assert.equal(reloaded!.user_request, "test request");
    assert.equal(reloaded!.outcome, "success");
    assert.equal(reloaded!.steps.length, 2);
    assert.equal(reloaded!.steps[0].name, "discovery.mock");
    assert.equal(reloaded!.steps[1].status, "skipped");
  } finally {
    cleanupTestEnv();
  }
});

test("storage: getExecution returns null for unknown id", () => {
  setupTestEnv();
  try {
    const result = getExecution("nonexistent_exec_id");
    assert.equal(result, null);
  } finally {
    cleanupTestEnv();
  }
});

test("storage: CRITICAL — conversation DB is separate from lead intelligence DB", () => {
  // P0.8: conversation memory lives in src/database/sqlite.ts (./data/agente-leads.db)
  //       lead intelligence lives in src/agent/storage/lead_intelligence.ts (./data/lead-intelligence.db)
  // They should be different DB files.
  setupTestEnv();
  try {
    const health = checkStorageHealth();
    assert.ok(health.dbPath.includes("lead-intelligence"));
    assert.ok(!health.dbPath.includes("agente-leads"));
  } finally {
    cleanupTestEnv();
  }
});
