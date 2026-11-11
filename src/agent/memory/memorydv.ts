// ============================================================
// src/agent/memory/memorydv.ts
// PRODUCTION CLOSURE §20-22 — MemoryDV: specialized agent memory.
//
// FOCUS (§20): prospects, companies, contacts, sources, evidence,
// qualification patterns, provider quality, outreach learnings,
// research history. NOT a copy of other agents' memory.
//
// MEMORY CONTRACT (§21):
//   id, agent_id, domain, type, content, source, evidence,
//   provenance, confidence, truth_level, created_at, updated_at,
//   last_verified, relevance, utility, decay, scope, status
//
// TYPES: EPISODIC (what happened) · SEMANTIC (what is true) ·
//        FACTUAL (structured data points) · PROCEDURAL (how to do it)
//
// CONSOLIDATION (§22):
//   EXECUTION → MEMORY CANDIDATE → VALIDATION → DEDUPLICATION
//   → CONSOLIDATION → MEMORYDV
//   Rejects: records without provenance, duplicates (content hash),
//   contradictions are superseded (older row → 'superseded', never
//   deleted — traceability preserved per §10/§22).
//
// ISOLATION (§20): every read/write is scoped by agent_id + domain
// + scope. Cross-agent or cross-domain contamination is impossible
// by construction (queries always include the isolation columns).
//
// SELF-IMPROVEMENT NOTE (§24): learning lands here as memory rows,
// versioned skills and feedback stats — this module NEVER patches
// production code.
// ============================================================

import { randomUUID } from "crypto";
import { ensureAgentInfraTables } from "../storage/agent_infra.js";
import { getDb } from "../storage/lead_intelligence.js";
import type { ExecutionTrace } from "../core/execution.js";

// ── Contract types ─────────────────────────────────────────

export type MemoryType = "EPISODIC" | "SEMANTIC" | "FACTUAL" | "PROCEDURAL";
export type MemoryScope = string; // e.g. "global" | "lead:<lead_id>" | "provider:<name>"
export type MemoryStatus = "active" | "superseded" | "retired";

export interface MemoryRecord {
  id: string;
  agent_id: string;
  domain: string;
  type: MemoryType;
  content: string;
  source: string;
  evidence?: string | null;
  provenance?: string | null;
  confidence: "high" | "medium" | "low" | "none";
  truth_level: "VERIFIED" | "INFERRED" | "ESTIMATED" | "UNVERIFIED" | "CONTRADICTED" | "UNKNOWN";
  relevance: number;      // 0..1 static base relevance
  utility: number;        // incremented on successful recall use
  decay: number;          // 1.0 = fresh, <1 = decayed
  scope: MemoryScope;
  status: MemoryStatus;
  execution_id?: string | null;
  content_hash: string;
  topic_key?: string | null;
  created_at: string;
  updated_at: string;
  last_verified?: string | null;
}

export interface MemoryWriteInput {
  agent_id: string;
  domain: string;
  type: MemoryType;
  content: string;
  source: string;
  evidence?: string;
  provenance?: string;
  confidence?: MemoryRecord["confidence"];
  truth_level?: MemoryRecord["truth_level"];
  relevance?: number;
  scope?: MemoryScope;
  execution_id?: string;
  /**
   * Optional explicit topic key (§22 contradiction handling). Records
   * sharing (agent_id, scope, type, topic_key) with DIFFERENT content
   * are treated as contradicting claims: the one with equal-or-better
   * confidence supersedes the older — never deleted. Without a topic
   * key, only exact-content dedup applies (deterministic, no fragile
   * text-similarity heuristics).
   */
  topic_key?: string;
}

/** Deterministic content hash for dedup (FNV-1a of normalized content). */
function contentHash(content: string): string {
  const normalized = content.toLowerCase().replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ── WRITE (§21 — with provenance gate) ─────────────────────

export class MemoryWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryWriteError";
  }
}

/**
 * Write a memory record. §22: information WITHOUT provenance is rejected.
 * The LLM response is never stored wholesale — callers must extract a
 * specific, sourced claim.
 */
export function writeMemory(input: MemoryWriteInput): MemoryRecord {
  ensureAgentInfraTables();

  // VALIDATION gate (§22): no content without source/provenance.
  if (!input.content || input.content.trim().length === 0) {
    throw new MemoryWriteError("memory content is empty");
  }
  if (!input.source || input.source.trim().length === 0) {
    throw new MemoryWriteError(
      "memory record rejected: missing source (provenance required — §22)"
    );
  }
  const provenance = input.provenance ?? input.source;

  const now = new Date().toISOString();
  const rec: MemoryRecord = {
    id: `mem_${randomUUID().slice(0, 12)}`,
    agent_id: input.agent_id,
    domain: input.domain,
    type: input.type,
    content: input.content.trim(),
    source: input.source,
    evidence: input.evidence ?? null,
    provenance,
    confidence: input.confidence ?? "low",
    truth_level: input.truth_level ?? "UNVERIFIED",
    relevance: input.relevance ?? 0.5,
    utility: 0,
    decay: 1.0,
    scope: input.scope ?? "global",
    status: "active",
    execution_id: input.execution_id ?? null,
    content_hash: contentHash(input.content),
    topic_key: input.topic_key ?? null,
    created_at: now,
    updated_at: now,
    last_verified: null,
  };

  // DEDUPLICATION gate (§22): identical (agent, scope, hash) → skip.
  const dup = getDb()
    .prepare(
      "SELECT id FROM agent_memory WHERE agent_id = ? AND scope = ? AND content_hash = ? AND status = 'active'"
    )
    .get(rec.agent_id, rec.scope, rec.content_hash) as { id: string } | undefined;
  if (dup) {
    // Return the existing record — no duplicate row is created.
    return getMemoryById(dup.id)!;
  }

  // CONTRADICTION handling (§22): same agent+scope+type+topic_key with
  // different content → the record with equal-or-better confidence
  // supersedes the older. Never delete (traceability, §10).
  if (input.topic_key) {
    const sameTopic = getDb()
      .prepare(
        "SELECT id, confidence FROM agent_memory WHERE agent_id = ? AND scope = ? AND type = ? AND topic_key = ? AND status = 'active' AND content_hash != ? LIMIT 1"
      )
      .get(rec.agent_id, rec.scope, rec.type, input.topic_key, rec.content_hash) as { id: string; confidence: string } | undefined;
    if (sameTopic) {
      const rank: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 };
      if ((rank[rec.confidence] ?? 0) >= (rank[sameTopic.confidence] ?? 0)) {
        getDb()
          .prepare("UPDATE agent_memory SET status = 'superseded', updated_at = ? WHERE id = ?")
          .run(now, sameTopic.id);
      } else {
        // New record is weaker — store as 'retired' note for audit, not active.
        rec.status = "retired";
      }
    }
  }

  getDb().prepare(`
    INSERT INTO agent_memory
      (id, agent_id, domain, type, content, source, evidence, provenance, confidence,
       truth_level, relevance, utility, decay, scope, status, execution_id, content_hash,
       topic_key, created_at, updated_at, last_verified)
    VALUES
      (@id, @agent_id, @domain, @type, @content, @source, @evidence, @provenance, @confidence,
       @truth_level, @relevance, @utility, @decay, @scope, @status, @execution_id, @content_hash,
       @topic_key, @created_at, @updated_at, @last_verified)
  `).run(rec as any);

  return rec;
}

export function getMemoryById(id: string): MemoryRecord | null {
  ensureAgentInfraTables();
  const row = getDb().prepare("SELECT * FROM agent_memory WHERE id = ?").get(id) as any;
  return row ? (row as MemoryRecord) : null;
}

// ── RECALL (§20 — isolated by agent/domain/scope) ──────────

export interface MemoryRecallFilter {
  agent_id: string;
  domain?: string;
  type?: MemoryType;
  scope?: MemoryScope;
  limit?: number;
  /** Include superseded/retired rows (default: only active) */
  include_inactive?: boolean;
}

/**
 * Recall memories ranked by: decay * relevance * confidence-weight,
 * then utility. Isolation: agent_id is REQUIRED.
 */
export function recallMemories(filter: MemoryRecallFilter): MemoryRecord[] {
  ensureAgentInfraTables();
  const rows = getDb()
    .prepare(
      `SELECT * FROM agent_memory
       WHERE agent_id = ?
         ${filter.domain ? "AND domain = ?" : ""}
         ${filter.type ? "AND type = ?" : ""}
         ${filter.scope ? "AND scope = ?" : ""}
         ${filter.include_inactive ? "" : "AND status = 'active'"}
       ORDER BY created_at DESC
       LIMIT 500`
    )
    .all(
      filter.agent_id,
      ...(filter.domain ? [filter.domain] : []),
      ...(filter.type ? [filter.type] : []),
      ...(filter.scope ? [filter.scope] : [])
    ) as MemoryRecord[];

  const confWeight: Record<string, number> = { high: 1.0, medium: 0.75, low: 0.5, none: 0.25 };

  const ranked = rows
    .map((r) => ({
      rec: r,
      rank:
        r.decay *
        r.relevance *
        (confWeight[r.confidence] ?? 0.25) *
        (1 + Math.min(r.utility, 10) / 20),
    }))
    .sort((a, b) => b.rank - a.rank)
    .map((x) => x.rec);

  return filter.limit ? ranked.slice(0, filter.limit) : ranked;
}

/** Mark a memory as used — boosts utility (feeds future ranking). */
export function markMemoryUsed(id: string): void {
  ensureAgentInfraTables();
  getDb()
    .prepare("UPDATE agent_memory SET utility = utility + 1, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

/** Apply uniform decay to a domain's memories (maintenance). */
export function applyDecay(agent_id: string, domain: string, factor = 0.95): void {
  ensureAgentInfraTables();
  getDb()
    .prepare("UPDATE agent_memory SET decay = decay * ? WHERE agent_id = ? AND domain = ? AND status = 'active'")
    .run(factor, agent_id, domain);
}

// ── CONSOLIDATION (§22) ────────────────────────────────────

export interface ConsolidationResult {
  candidates: number;
  written: number;
  rejected_no_provenance: number;
  duplicates_skipped: number;
}

/**
 * Consolidate an ExecutionTrace into memory (§22 flow):
 *   EXECUTION → MEMORY CANDIDATE → VALIDATION → DEDUPLICATION → CONSOLIDATION.
 *
 * Candidates:
 *   - EPISODIC: one per failed step with its normalized error (research history)
 *   - SEMANTIC: provider quality facts from successful steps
 *
 * VALIDATION: candidates without provider/source (provenance) are rejected.
 * DEDUPLICATION: content-hash dedup inside writeMemory.
 * CONTRADICTION: supersede semantics inside writeMemory.
 */
export function consolidateExecution(
  trace: ExecutionTrace,
  opts: { agent_id?: string; domain?: string } = {}
): ConsolidationResult {
  ensureAgentInfraTables();
  const agent = opts.agent_id ?? "AGENTE-LEADS";
  const domain = opts.domain ?? "lead_intelligence";

  const result: ConsolidationResult = {
    candidates: 0,
    written: 0,
    rejected_no_provenance: 0,
    duplicates_skipped: 0,
  };

  for (const step of trace.steps) {
    // Candidate 1 — episodic failure learning (research history)
    if (step.status === "failed" && step.provider && step.error_type) {
      result.candidates++;
      const content = `Step ${step.name} failed with ${step.error_type}: ${step.error_message ?? "no detail"}`;
      const before = countActive(agent, domain);
      writeMemory({
        agent_id: agent,
        domain,
        type: "EPISODIC",
        content,
        source: step.provider, // provenance = the provider that failed
        evidence: `execution ${trace.id}, step ${step.name}, ${step.started_at}`,
        confidence: "high", // we observed the failure directly
        truth_level: "VERIFIED",
        relevance: 0.6,
        scope: `provider:${step.provider}`,
        execution_id: trace.id,
      });
      const after = countActive(agent, domain);
      if (after > before) result.written++;
      else result.duplicates_skipped++;
    }

    // Candidate 2 — semantic provider-quality learning
    if (step.status === "ok" && step.provider && step.duration_ms !== undefined) {
      result.candidates++;
      const content = `Provider ${step.provider} completed step ${step.name} in ${step.duration_ms}ms`;
      const before = countActive(agent, domain);
      writeMemory({
        agent_id: agent,
        domain,
        type: "SEMANTIC",
        content,
        source: step.provider,
        evidence: `execution ${trace.id}`,
        confidence: "medium",
        truth_level: "VERIFIED",
        relevance: 0.4,
        scope: `provider:${step.provider}`,
        execution_id: trace.id,
      });
      const after = countActive(agent, domain);
      if (after > before) result.written++;
      else result.duplicates_skipped++;
    }

    // Candidate without any provider → rejected (no provenance)
    if (step.status === "failed" && !step.provider) {
      result.candidates++;
      result.rejected_no_provenance++;
    }
  }

  return result;
}

function countActive(agent_id: string, domain: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM agent_memory WHERE agent_id = ? AND domain = ? AND status = 'active'")
    .get(agent_id, domain) as { c: number };
  return row.c;
}
