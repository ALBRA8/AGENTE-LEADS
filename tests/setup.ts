// ============================================================
// tests/setup.ts
// Shared setup: per-test DB file + cleanup helpers
// ============================================================

import fs from "fs";
import path from "path";
import { resetStorageForTests } from "../src/agent/storage/lead_intelligence.js";

const TEST_DIR = path.resolve(process.cwd(), "data-test");
const TEST_DB = path.join(TEST_DIR, "test-lead-intelligence.db");

export function setupTestEnv(): void {
  // Clear any data from previous test (same DB connection — we don't close it
  // to avoid the better-sqlite3 native destructor crash on statement GC).
  resetStorageForTests();
  process.env.LEADS_DB_PATH = TEST_DB;
  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
}

export function cleanupTestEnv(): void {
  // Clear data for the next test — same connection, fresh rows.
  resetStorageForTests();
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
