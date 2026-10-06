// ============================================================
// tests/setup.ts
// Shared setup: per-test DB file + cleanup helpers
// ============================================================

import fs from "fs";
import path from "path";
import { resetStorageForTests, closeLeadDbForTests } from "../src/agent/storage/lead_intelligence.js";
import { resetAgentInfraForTests } from "../src/agent/storage/agent_infra.js";

const TEST_DIR = path.resolve(process.cwd(), "data-test");
const TEST_DB = path.join(TEST_DIR, "test-lead-intelligence.db");

export function setupTestEnv(): void {
  // PRODUCTION CLOSURE FIX: the env var MUST be set BEFORE any getDb() call.
  // The previous order (reset → set env) opened the DB at the DEFAULT path
  // (./data/lead-intelligence.db) on the first reset, so tests ran against
  // the REAL data DB (pollution + cross-process WAL contention → flaky
  // native crashes). We now: (1) point the env at the test DB, (2) close
  // any stale connection opened elsewhere, (3) reset rows on a connection
  // lazily opened at the correct path.
  process.env.LEADS_DB_PATH = TEST_DB;
  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
  // NOTE: no mid-run close here — one connection per process, opened at
  // the (already correct) test path by the lazy resets below. Mid-run
  // close/reopen cycles churn statements and feed the native teardown
  // race. The after() hook closes + drains deterministically at file end.
  resetStorageForTests();
  resetAgentInfraForTests();
}

export function cleanupTestEnv(): void {
  // Clear data for the next test — same connection, fresh rows.
  resetStorageForTests();
  resetAgentInfraForTests();
}

// Re-export core types for tests
export {
  makeError,
  normalizeError,
  shouldRetry,
  backoffDelayMs,
  found,
  notFound,
  confirmedAbsent,
  inferred,
  statusLabel,
  confidenceLabel,
  buildDedupSignature,
  type CandidateLead,
  type Lead,
  type EvidenceRecord,
  type ProviderError,
  type ErrorType,
  type MatchLevel,
  type ObservationStatus,
  type ConfidenceLevel,
} from "../src/agent/core/index.js";

// ============================================================
// PRODUCTION CLOSURE — universal native-crash guard.
//
// Known issue (documented in storage/lead_intelligence.ts):
// better-sqlite3's native Statement destructor crashes Node 24 when
// statements are GC'd AFTER the environment teardown
// ("RemoveEnvironmentCleanupHook: (env) != nullptr").
//
// This module-level `after()` hook runs at the end of EVERY test file
// that imports setup.js. It forces full GC + event-loop drains while
// the environment is still valid, so every Statement wrapper is
// finalized deterministically before exit. Requires --expose-gc
// (wired into the npm test scripts — test-infra only, never in prod).
// ============================================================
import { after, afterEach } from "node:test";

import { closeLeadDbForTests } from "../src/agent/storage/lead_intelligence.js";
import { closeConversationsDb } from "../src/database/sqlite.js";

const gcNow = async () => {
  const gc = (globalThis as any).gc;
  for (let i = 0; i < 3; i++) {
    if (typeof gc === "function") gc();
    await new Promise((r) => setImmediate(r));
  }
  if (typeof gc === "function") gc();
};

// After EVERY test: keep better-sqlite3 Statement wrappers from piling up
// un-GC'd (the DB may be closed and reopened between tests via the
// beforeExit handler, churning statements).
afterEach(async () => {
  await gcNow();
});

// At file end: close the DB explicitly (finalizes ALL statements while the
// environment is fully valid), then drain GC so every Statement wrapper is
// finalized before the process exits. This makes the known better-sqlite3
// teardown race deterministic instead of probabilistic.
after(async () => {
  await gcNow();
  closeLeadDbForTests();
  closeConversationsDb();
  await gcNow();
});
