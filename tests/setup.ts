// ============================================================
// tests/setup.ts
// Shared setup: per-test DB file + cleanup helpers
// ============================================================

import fs from "fs";
import path from "path";
import { closeDbForTests } from "../src/agent/storage/lead_intelligence.js";

const TEST_DIR = path.resolve(process.cwd(), "data-test");
const TEST_DB = path.join(TEST_DIR, "test-lead-intelligence.db");

export function setupTestEnv(): void {
  // Close any existing DB connection from a previous test
  closeDbForTests();
  process.env.LEADS_DB_PATH = TEST_DB;
  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
  // Delete the DB file for a truly fresh start
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch {}
    }
  }
}

export function cleanupTestEnv(): void {
  // Close the DB connection so prepared statements are properly finalized
  // before GC runs (prevents better-sqlite3 native crash on Node 24)
  closeDbForTests();
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
