// ============================================================
// src/agent/storage/lead_intelligence.ts
// P0.8 — Lead intelligence storage layer.
//
// This DB is SEPARATE from the conversation-memory DB
// (src/database/sqlite.ts → ./data/agente-leads.db).
//
// Per P0.8:
//   "Separa conceptualmente conversation memory de lead intelligence."
//
// Path: process.env.LEADS_DB_PATH ?? "./data/lead-intelligence.db"
//
// Tables:
//   - lead_intelligence_leads      (P0.1 canonical Lead)
//   - lead_intelligence_evidence   (P0.6 per-field evidence)
//   - lead_intelligence_sources     (per-provider raw payloads)
//   - executions                    (P0.11 execution traces)
//   - dedup_matches                 (P0.7 audit log)
//
// All schema statements use CREATE TABLE/INDEX IF NOT EXISTS so
// re-running is safe (idempotent).
// ============================================================

import Database, { type Database as BetterDB } from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { Lead, CandidateLead, DedupSignature, MatchLevel } from "../core/lead.js";
import { normalizeUrl } from "../core/lead.js";
import type { EvidenceRecord } from "../core/evidence.js";
import type { ExecutionTrace } from "../core/execution.js";

// Lazy-init: db is created on first access via getDb() so tests can
// reset it between runs via resetStorageForTests().
let _db: BetterDB | null = null;

function getDbPath(): string {
  return process.env.LEADS_DB_PATH ?? "./data/lead-intelligence.db";
}

function ensureDir(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function initDb(dbPath: string): BetterDB {
  ensureDir(dbPath);
  const conn = new Database(dbPath);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  // Idempotent schema
  conn.exec(`
    CREATE TABLE IF NOT EXISTS lead_intelligence_leads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      platform TEXT,
      url TEXT,
      website TEXT,
      email TEXT,
      phone TEXT,
      location TEXT,
      category TEXT,
      niche TEXT,
      description TEXT,
      sources TEXT NOT NULL,
      discovered_at TEXT NOT NULL,
      research_state TEXT NOT NULL DEFAULT 'DISCOVERED',
      validation_state TEXT,
      dedup_signature TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_leads_email ON lead_intelligence_leads(email);
    CREATE INDEX IF NOT EXISTS idx_leads_username ON lead_intelligence_leads(username);
    CREATE INDEX IF NOT EXISTS idx_leads_website ON lead_intelligence_leads(website);
    CREATE INDEX IF NOT EXISTS idx_leads_dedup ON lead_intelligence_leads(dedup_signature);
    CREATE TABLE IF NOT EXISTS lead_intelligence_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      field TEXT NOT NULL,
      value TEXT,
      status TEXT NOT NULL,
      source TEXT,
      retrieved_at TEXT NOT NULL,
      confidence TEXT NOT NULL,
      evidence TEXT,
      inferred_from TEXT,
      truth_level TEXT,
      FOREIGN KEY (lead_id) REFERENCES lead_intelligence_leads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_lead ON lead_intelligence_evidence(lead_id, field);

    CREATE TABLE IF NOT EXISTS lead_intelligence_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      raw_payload TEXT,
      retrieved_at TEXT NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES lead_intelligence_leads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      user_request TEXT NOT NULL,
      parsed_intent TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      total_duration_ms INTEGER,
      outcome TEXT NOT NULL,
      summary TEXT,
      steps TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dedup_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      new_lead_id TEXT NOT NULL,
      existing_lead_id TEXT NOT NULL,
      match_level TEXT NOT NULL,
      matched_on TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration for DBs created before the §9 truth_level column
  // (idempotent: ALTER TABLE fails harmlessly if the column exists).
  try {
    conn.exec("ALTER TABLE lead_intelligence_evidence ADD COLUMN truth_level TEXT");
  } catch {
    // column already exists
  }

  return conn;
}

// ── Statement cache (native-crash fix) ─────────────────────
// PRODUCTION CLOSURE ROOT FIX for the known better-sqlite3 teardown
// crash ("RemoveEnvironmentCleanupHook: (env) != nullptr"):
//
// Every `db.prepare(sql)` used to create a NEW Statement wrapper that
// became garbage immediately after the call. Whether V8 collected those
// wrappers before env teardown was a RACE — collecting them DURING
// teardown runs Statement::~Statement() → RemoveEnvironmentCleanupHook
// with a dead environment → native assertion → flaky test crashes.
//
// Fix: a Proxy over the Database instance caches every prepared
// statement in a module-level Map (STRONG reference). No Statement is
// ever garbage, so no destructor ever runs at teardown. Statements from
// a closed-and-reopened connection are replaced lazily (checked via
// .database identity); the replaced (dead) wrapper is then GC'd while
// the environment is still valid, which is safe.
const _stmtCache = new Map<string, any>();

function makeSafeDb(conn: BetterDB): BetterDB {
  return new Proxy(conn, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string, ...rest: unknown[]) => {
          const cached = _stmtCache.get(sql);
          if (cached && (cached as any).database === target) return cached;
          const st = (target.prepare as any)(sql, ...rest);
          _stmtCache.set(sql, st);
          return st;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as any).bind(target) : value;
    },
  }) as unknown as BetterDB;
}

function db(): BetterDB {
  if (!_db) _db = makeSafeDb(initDb(getDbPath()));
  return _db;
}

/**
 * TEST-ONLY: clears all data from the lead intelligence tables.
 *
 * IMPORTANT: we do NOT close the DB connection here mid-test. Closing the
 * connection invalidates all prepared statements, and better-sqlite3's
 * native destructor crashes when those statements are GC'd later. Instead,
 * we just DELETE all rows from the existing tables so the next test starts
 * with a clean slate.
 *
 * The schema stays intact (CREATE TABLE IF NOT EXISTS is idempotent).
 */
export function resetStorageForTests(): void {
  if (!_db) return;
  try {
    _db.exec("DELETE FROM lead_intelligence_evidence;");
    _db.exec("DELETE FROM lead_intelligence_sources;");
    _db.exec("DELETE FROM lead_intelligence_leads;");
    _db.exec("DELETE FROM executions;");
    _db.exec("DELETE FROM dedup_matches;");
    _db.exec("DELETE FROM sqlite_sequence WHERE name IN ('lead_intelligence_evidence','lead_intelligence_sources','dedup_matches');");
  } catch (e) {
    // Schema might not be initialized yet on first call — that's OK
  }
}

// At process exit, properly close the DB so prepared statements are freed
// while the V8 environment is still valid. This prevents the native crash:
//   node::RemoveEnvironmentCleanupHook: Assertion failed: (env) != nullptr
//
// PRODUCTION CLOSURE FIX: previously we registered BOTH 'beforeExit' and
// 'exit'. 'beforeExit' fires EVERY time the event loop drains — including
// between test() invocations — which closed the DB mid-run and forced a
// reopen (statement churn + different-path reopen → "no such table" and
// teardown races). The close now happens ONLY in the synchronous 'exit'
// phase. Tests additionally close explicitly via closeLeadDbForTests().
const _closeDb = () => {
  if (_db) {
    try { _db.close(); } catch {}
    _db = null;
  }
  // Release the cached Statement wrappers IMMEDIATELY so the GC can
  // finalize them while the V8 environment is still valid (the final
  // teardown collects the whole module graph — including this Map —
  // with a dead environment, which triggers the native assertion).
  _stmtCache.clear();
};
process.on("exit", _closeDb);

/** Explicit close hook (tests / graceful shutdown) — idempotent. */
export function closeLeadDbForTests(): void {
  _closeDb();
}

// (Schema is created inside initDb() — see above. No need for a top-level exec.)

// ── Lead CRUD ─────────────────────────────────────────────

export interface StoredLead extends Lead {
  id: string;
}

// FIX (SEC-M2): saveLead runs inside a transaction so the lead INSERT/UPDATE +
// evidence DELETE + evidence INSERTs are atomic. Without this, a crash between
// DELETE and INSERT leaves the lead with zero evidence (silent data loss).
// We create the transaction dynamically (not at module level) so it works
// with the lazy-init db() and can be reset between tests.
function _saveLeadImpl(lead: Lead): StoredLead {
  const id = lead.id ?? `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const existing = lead.id ? db().prepare("SELECT id FROM lead_intelligence_leads WHERE id = ?").get(lead.id) : null;
  const sourcesJson = JSON.stringify(lead.sources ?? []);
  const validationJson = lead.validation ? JSON.stringify(lead.validation) : null;
  const dedupSigJson = lead.dedup_signature ? JSON.stringify(lead.dedup_signature) : null;
  // Normalize website so dedup queries match regardless of protocol/www/trailing slash
  const normalizedWebsite = lead.website ? normalizeUrl(lead.website) : null;

  if (existing) {
    db().prepare(`
      UPDATE lead_intelligence_leads SET
        name=@name, username=@username, platform=@platform, url=@url,
        website=@website, email=@email, phone=@phone, location=@location,
        category=@category, niche=@niche, description=@description,
        sources=@sources, research_state=@research_state, validation_state=@validation_state,
        dedup_signature=@dedup_signature, updated_at=datetime('now')
      WHERE id=@id
    `).run({
      id, name: lead.name, username: lead.username ?? null, platform: lead.platform ?? null,
      url: lead.url ?? null, website: normalizedWebsite, email: lead.email ?? null,
      phone: lead.phone ?? null, location: lead.location ?? null, category: lead.category ?? null,
      niche: lead.niche ?? null, description: lead.description ?? null, sources: sourcesJson,
      research_state: lead.research_state, validation_state: validationJson,
      dedup_signature: dedupSigJson,
    });
  } else {
    db().prepare(`
      INSERT INTO lead_intelligence_leads
        (id, name, username, platform, url, website, email, phone, location, category, niche, description, sources, discovered_at, research_state, validation_state, dedup_signature)
      VALUES
        (@id, @name, @username, @platform, @url, @website, @email, @phone, @location, @category, @niche, @description, @sources, @discovered_at, @research_state, @validation_state, @dedup_signature)
    `).run({
      id, name: lead.name, username: lead.username ?? null, platform: lead.platform ?? null,
      url: lead.url ?? null, website: normalizedWebsite, email: lead.email ?? null,
      phone: lead.phone ?? null, location: lead.location ?? null, category: lead.category ?? null,
      niche: lead.niche ?? null, description: lead.description ?? null, sources: sourcesJson,
      discovered_at: lead.discovered_at, research_state: lead.research_state,
      validation_state: validationJson, dedup_signature: dedupSigJson,
    });
  }

  // Replace evidence (delete + insert)
  if (lead.evidence?.length) {
    db().prepare("DELETE FROM lead_intelligence_evidence WHERE lead_id = ?").run(id);
    const stmt = db().prepare(`
      INSERT INTO lead_intelligence_evidence
        (lead_id, field, value, status, source, retrieved_at, confidence, evidence, inferred_from, truth_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of lead.evidence) {
      stmt.run(id, e.field, e.value ? String(e.value) : null, e.status, e.source ?? null,
        e.retrieved_at, e.confidence, e.evidence, e.inferred_from ? JSON.stringify(e.inferred_from) : null,
        (e as any).truth_level ?? null);
    }
  }

  return { ...lead, id };
}

// Public wrapper that executes inside a transaction (SEC-M2 fix)
export function saveLead(lead: Lead): StoredLead {
  return db().transaction(() => _saveLeadImpl(lead)).immediate() as StoredLead;
}

export function getLeadById(id: string): StoredLead | null {
  const row = db().prepare("SELECT * FROM lead_intelligence_leads WHERE id = ?").get(id) as any;
  if (!row) return null;
  return rowToLead(row);
}

export function getAllLeads(limit = 100): StoredLead[] {
  const rows = db().prepare("SELECT * FROM lead_intelligence_leads ORDER BY created_at DESC LIMIT ?").all(limit) as any[];
  return rows.map(rowToLead);
}

function rowToLead(row: any): StoredLead {
  let validation: any = null;
  try { validation = row.validation_state ? JSON.parse(row.validation_state) : null; } catch {}
  let dedupSig: any = undefined;
  try { dedupSig = row.dedup_signature ? JSON.parse(row.dedup_signature) : undefined; } catch {}
  let sources: string[] = [];
  try { sources = row.sources ? JSON.parse(row.sources) : []; } catch {}

  const evidenceRows = db().prepare("SELECT * FROM lead_intelligence_evidence WHERE lead_id = ?").all(row.id) as any[];
  const evidence: EvidenceRecord[] = evidenceRows.map((e) => ({
    field: e.field,
    value: e.value,
    status: e.status,
    source: e.source ?? undefined,
    retrieved_at: e.retrieved_at,
    confidence: e.confidence,
    evidence: e.evidence ?? "",
    inferred_from: e.inferred_from ? JSON.parse(e.inferred_from) : undefined,
    ...(e.truth_level ? { truth_level: e.truth_level } : {}),
  }));

  // CRITICAL FIX (ARCH-C1): reconstruct lead_score from evidence records
  // so /stats and run_outreach can see the score even after loading from DB.
  const scoreEvidence = evidence.find((e) => e.field === "lead_score" && e.value);
  const lead_score = scoreEvidence ? Number(scoreEvidence.value) : undefined;

  return {
    id: row.id,
    name: row.name,
    username: row.username,
    platform: row.platform,
    url: row.url,
    website: row.website,
    email: row.email,
    phone: row.phone,
    location: row.location,
    category: row.category,
    niche: row.niche,
    description: row.description,
    sources,
    discovered_at: row.discovered_at,
    evidence,
    validation: validation ?? undefined,
    research_state: row.research_state as any,
    dedup_signature: dedupSig,
    lead_score,
  };
}

// ── Dedup match log (P0.7 audit) ───────────────────────────

export function recordDedupMatch(
  newLeadId: string,
  existingLeadId: string,
  matchLevel: MatchLevel,
  matchedOn: string[]
): void {
  db().prepare(`
    INSERT INTO dedup_matches (new_lead_id, existing_lead_id, match_level, matched_on)
    VALUES (?, ?, ?, ?)
  `).run(newLeadId, existingLeadId, matchLevel, matchedOn.join(","));
}

/**
 * Find a lead that matches the given dedup signature using multi-signal matching.
 * Returns the matched lead id and the match level (per P0.7).
 */
export function findDedupMatch(sig: DedupSignature): { leadId: string; matchLevel: MatchLevel; matchedOn: string[] } | null {
  // Try EXACT match first (email unique)
  if (sig.email) {
    const row = db().prepare("SELECT id FROM lead_intelligence_leads WHERE email = ?").get(sig.email.toLowerCase()) as any;
    if (row) return { leadId: row.id, matchLevel: "EXACT", matchedOn: ["email"] };
  }
  if (sig.website) {
    const row = db().prepare("SELECT id FROM lead_intelligence_leads WHERE website = ?").get(sig.website) as any;
    if (row) return { leadId: row.id, matchLevel: "EXACT", matchedOn: ["website"] };
  }
  if (sig.instagram) {
    const row = db().prepare("SELECT id FROM lead_intelligence_leads WHERE username = ?").get(sig.instagram) as any;
    if (row) return { leadId: row.id, matchLevel: "STRONG", matchedOn: ["instagram"] };
  }
  if (sig.phone) {
    const row = db().prepare("SELECT id FROM lead_intelligence_leads WHERE phone = ?").get(sig.phone) as any;
    if (row) return { leadId: row.id, matchLevel: "STRONG", matchedOn: ["phone"] };
  }
  if (sig.domain) {
    // STRONG match: same domain on a different website URL
    const rows = db().prepare("SELECT id, website FROM lead_intelligence_leads WHERE website IS NOT NULL").all() as any[];
    for (const r of rows) {
      try {
        const u = new URL(r.website.startsWith("http") ? r.website : `https://${r.website}`);
        if (u.hostname.replace(/^www\./, "").toLowerCase() === sig.domain) {
          return { leadId: r.id, matchLevel: "STRONG", matchedOn: ["domain"] };
        }
      } catch {}
    }
  }
  if (sig.normalized_name_location) {
    const rows = db().prepare("SELECT id, name, location FROM lead_intelligence_leads").all() as any[];
    const normalizeName = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    for (const r of rows) {
      if (r.name && r.location) {
        const sig2 = `${normalizeName(r.name)}|${normalizeName(r.location)}`;
        if (sig2 === sig.normalized_name_location) {
          return { leadId: r.id, matchLevel: "PROBABLE", matchedOn: ["normalized_name_location"] };
        }
      }
    }
  }
  return null;
}

// ── Execution trace storage (P0.11) ────────────────────────

export function saveExecution(trace: ExecutionTrace): void {
  db().prepare(`
    INSERT OR REPLACE INTO executions (id, user_request, parsed_intent, started_at, ended_at, total_duration_ms, outcome, summary, steps)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    trace.id,
    trace.user_request,
    trace.parsed_intent ? JSON.stringify(trace.parsed_intent) : null,
    trace.started_at,
    trace.ended_at ?? null,
    trace.total_duration_ms ?? null,
    trace.outcome,
    trace.summary ?? null,
    JSON.stringify(trace.steps)
  );
}

export function getExecution(id: string): ExecutionTrace | null {
  const row = db().prepare("SELECT * FROM executions WHERE id = ?").get(id) as any;
  if (!row) return null;
  let steps: any[] = [];
  try { steps = JSON.parse(row.steps); } catch {}
  let parsed_intent: any = undefined;
  try { parsed_intent = row.parsed_intent ? JSON.parse(row.parsed_intent) : undefined; } catch {}
  return {
    id: row.id,
    user_request: row.user_request,
    parsed_intent,
    started_at: row.started_at,
    ended_at: row.ended_at ?? undefined,
    total_duration_ms: row.total_duration_ms ?? undefined,
    outcome: row.outcome,
    summary: row.summary ?? undefined,
    steps,
  };
}

// ── Health check ────────────────────────────────────────────

export function checkStorageHealth(): { ok: boolean; tables: string[]; dbPath: string } {
  const rows = db().prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  return {
    ok: true,
    tables: rows.map((r) => r.name),
    dbPath: getDbPath(),
  };
}

// Note: callers should import { saveLead, getLeadById, ... } rather than the default export.
// We export a getter function instead of the raw Database instance to preserve lazy init.
export function getDb(): BetterDB {
  return db();
}
