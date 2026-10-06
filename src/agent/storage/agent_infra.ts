// ============================================================
// src/agent/storage/agent_infra.ts
// PRODUCTION CLOSURE — Agent infrastructure storage.
//
// Hosts the tables required by the closure spec on the SAME
// lead-intelligence SQLite DB (lazy, idempotent schema):
//
//   tool_audit        (§17 — every tool invocation, auditable)
//   agent_memory      (§20-21 — MemoryDV: specialized agent memory)
//   agent_skills      (§18-19 — Skills with lifecycle)
//   skill_runs        (§19 — regression / success-rate tracking)
//   lead_feedback     (§23 — accepted / rejected / score feedback)
//   outreach_log      (§25 — idempotency + duplicate prevention)
//   provider_metrics  (§14 — historical quality per provider)
//
// Design rules:
//   - CREATE TABLE IF NOT EXISTS → safe on existing DBs.
//   - Every table is isolated by agent_id where the spec requires it.
//   - No LLM response is ever persisted as memory without provenance
//     (§21/§22 — writeMemory rejects records without a source).
//   - SELF-IMPROVEMENT (§24): learning is confined to memory rows,
//     versioned skills and feedback stats. This module NEVER rewrites
//     production code — structural changes require external validation.
// ============================================================

import { getDb } from "./lead_intelligence.js";

// ── Idempotent schema ─────────────────────────────────────
// PRODUCTION CLOSURE FIX: the DB connection can be closed and re-opened
// at runtime (lead_intelligence registers beforeExit/exit handlers that
// close it, and the next access lazily re-opens a fresh connection —
// possibly at a different path, e.g. tests). A module-level boolean flag
// was NOT enough: after a reopen, the new DB instance lacks the infra
// tables while the stale flag skipped the DDL → "no such table". We now
// track the exact connection instance that was initialized and re-run
// the (idempotent) DDL whenever the connection instance changes.
let _initializedConn: import("better-sqlite3").Database | null = null;

export function ensureAgentInfraTables(): void {
  const db = getDb();
  if (_initializedConn === db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL,
      args_summary TEXT,
      status TEXT NOT NULL,             -- ok | failed | timeout
      error_type TEXT,
      duration_ms INTEGER,
      execution_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tool_audit_tool ON tool_audit(tool_name, created_at);

    CREATE TABLE IF NOT EXISTS agent_memory (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('EPISODIC','SEMANTIC','FACTUAL','PROCEDURAL')),
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      evidence TEXT,
      provenance TEXT,
      confidence TEXT NOT NULL DEFAULT 'low',
      truth_level TEXT NOT NULL DEFAULT 'UNVERIFIED',
      relevance REAL NOT NULL DEFAULT 0.5,
      utility INTEGER NOT NULL DEFAULT 0,
      decay REAL NOT NULL DEFAULT 1.0,
      scope TEXT NOT NULL DEFAULT 'global',
      status TEXT NOT NULL DEFAULT 'active',
      execution_id TEXT,
      content_hash TEXT NOT NULL,
      topic_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_verified TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memory_agent ON agent_memory(agent_id, domain, type, scope);
    CREATE INDEX IF NOT EXISTS idx_memory_hash ON agent_memory(agent_id, content_hash);

    CREATE TABLE IF NOT EXISTS agent_skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'PROPOSED',
      spec TEXT NOT NULL,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_validated TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS skill_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id TEXT NOT NULL,
      execution_id TEXT,
      success INTEGER NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_skill_runs ON skill_runs(skill_id, created_at);

    CREATE TABLE IF NOT EXISTS lead_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      feedback_type TEXT NOT NULL,      -- lead_accepted | lead_rejected | score_correct | score_incorrect
      reason TEXT,
      given_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_lead ON lead_feedback(lead_id, feedback_type);

    CREATE TABLE IF NOT EXISTS provider_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      useful INTEGER NOT NULL,
      execution_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS outreach_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      success INTEGER NOT NULL,
      message_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS outreach_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT NOT NULL UNIQUE,
      lead_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      message_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_outreach_log_lead ON outreach_log(lead_id, channel);

    CREATE TABLE IF NOT EXISTS provider_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      execution_id TEXT,
      requests INTEGER NOT NULL,
      success_rate REAL NOT NULL,
      failure_rate REAL NOT NULL,
      avg_latency_ms REAL NOT NULL,
      usable_results INTEGER NOT NULL DEFAULT 0,
      failure_breakdown TEXT,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_provider_metrics ON provider_metrics(provider, recorded_at);
  `);

  // Migrations for DBs created by earlier versions of this module
  // (idempotent: ALTER TABLE fails harmlessly if the column exists).
  const migrations = [
    "ALTER TABLE agent_memory ADD COLUMN topic_key TEXT",
  ];
  for (const m of migrations) {
    try { db.exec(m); } catch { /* column already exists */ }
  }

  _initializedConn = db;
}

/**
 * TEST-ONLY: clears infrastructure tables. Guarded per-table so it works
 * even before ensureAgentInfraTables() has run in the current process.
 */
export function resetAgentInfraForTests(): void {
  const db = getDb();
  const tables = [
    "tool_audit",
    "agent_memory",
    "agent_skills",
    "skill_runs",
    "lead_feedback",
    "provider_feedback",
    "outreach_feedback",
    "outreach_log",
    "provider_metrics",
  ];
  for (const t of tables) {
    try { db.exec(`DELETE FROM ${t};`); } catch { /* table may not exist yet */ }
  }
}

// ── Tool audit (§17) ───────────────────────────────────────

export interface ToolAuditRow {
  tool_name: string;
  args_summary?: string;
  status: "ok" | "failed" | "timeout";
  error_type?: string;
  duration_ms?: number;
  execution_note?: string;
}

export function recordToolAudit(row: ToolAuditRow): void {
  ensureAgentInfraTables();
  getDb().prepare(`
    INSERT INTO tool_audit (tool_name, args_summary, status, error_type, duration_ms, execution_note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    row.tool_name,
    row.args_summary ?? null,
    row.status,
    row.error_type ?? null,
    row.duration_ms ?? null,
    row.execution_note ?? null
  );
}

export function getToolAudit(limit = 50): any[] {
  ensureAgentInfraTables();
  return getDb()
    .prepare("SELECT * FROM tool_audit ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit) as any[];
}
