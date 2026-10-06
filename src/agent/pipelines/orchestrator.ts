// ============================================================
// src/agent/pipelines/orchestrator.ts
// P0.9 + P1.3 — Deterministic orchestrator that chains:
//   DISCOVERY → RESEARCH → VALIDATION → EVIDENCE → DEDUPLICATION → SCORING → INTELLIGENCE → STORAGE → REPORT
//
// P1.3: RESEARCH, VALIDATION, and DEDUP now run in PARALLEL via Promise.all
// (batch of N candidates processed concurrently instead of sequentially).
// Per-provider concurrency can be tuned via `max_concurrency` (default 3).
//
// P1.1: SCORING added as a stage after DEDUP.
// P1.2: INTELLIGENCE (LLM reasoning with GLM 5.3 Flash) added after SCORING.
//
// The LLM decides WHAT to do (call this orchestrator with a parsed intent).
// The orchestrator decides HOW to do it (provider selection, retry policy, etc).
// ============================================================

import type { DiscoveryProvider, ResearchProvider, VerificationProvider, ScrapingProvider } from "../providers/types.js";
import type { Lead, CandidateLead } from "../core/lead.js";
import { ExecutionRecorder } from "../core/execution.js";
import { runDiscovery } from "./discovery.js";
import { runResearch } from "./research.js";
import { runValidation } from "./validation.js";
import { runDedup } from "./dedup.js";
import { runScoring } from "./scoring.js";
import { runIntelligence } from "./intelligence.js";
import { generateReport } from "./report.js";
import { saveExecution, saveLead } from "../storage/lead_intelligence.js";

export interface ParsedIntent {
  /** What the user is looking for, e.g. "restaurantes veganos" */
  query: string;
  /** Where the user is looking, e.g. "Medellín" */
  location?: string;
  /** Niche hint, e.g. "vegano" */
  niche?: string;
  /** Platform hint, e.g. "instagram" */
  platform?: string;
  /** Minimum followers filter (optional) */
  min_followers?: number;
  /** Maximum number of top leads to report */
  top_n?: number;
  /** P1.3: maximum parallel processing of candidates (default 3) */
  max_concurrency?: number;
  /** P1.2: optional offer context for LLM intelligence */
  offer_description?: string;
  /** P1.2: skip LLM intelligence if false (saves tokens) */
  enable_intelligence?: boolean;
}

export interface ProviderRegistry {
  discovery: DiscoveryProvider[];
  research: ResearchProvider | null;
  verification: VerificationProvider | null;
  scraping: ScrapingProvider | null;
}

export interface PipelineResult {
  report_text: string;
  report_json: string;
  candidates_count: number;
  researched_count: number;
  validated_count: number;
  stored_count: number;
  scored_count: number;
  intelligenced_count: number;
  execution_id: string;
  outcome: "success" | "partial" | "failed";
}

/**
 * Run the full lead pipeline deterministically with parallel batch processing.
 *
 * Stages:
 *   1. DISCOVERY — find candidates
 *   2. FILTER (apply min_followers if provided)
 *   3. RESEARCH — investigate each candidate (PARALLEL, batch of N)
 *   4. VALIDATION — verify email/website (PARALLEL)
 *   5. DEDUPLICATION + STORAGE — persist with merge if duplicate (PARALLEL)
 *   6. SCORING — compute Lead Score 0-100 per lead (PARALLEL)
 *   7. INTELLIGENCE — LLM reasoning (PARALLEL, optional)
 *   8. REPORT — generate TOP LEADS report
 *
 * Saves the ExecutionTrace to the executions table for observability (P0.11).
 */
export async function runLeadPipeline(
  intent: ParsedIntent,
  providers: ProviderRegistry
): Promise<PipelineResult> {
  const trace = new ExecutionRecorder(
    `${intent.query} en ${intent.location ?? "any"}${intent.min_followers ? ` (min ${intent.min_followers} seguidores)` : ""}`,
    intent as any
  );
  const concurrency = intent.max_concurrency ?? 3;

  // ── 1. DISCOVERY ───────────────────────────────────────────
  const discovery = await runDiscovery(providers.discovery, {
    query: intent.query,
    location: intent.location,
    niche: intent.niche,
    platform: intent.platform,
    min_followers: intent.min_followers,
  }, trace);

  // ── 2. FILTER (apply min_followers at pipeline level for providers that don't support it) ──
  let candidates: CandidateLead[] = discovery.candidates;
  if (intent.min_followers) {
    candidates = candidates.filter((c) => Number(c.raw_data?.followers ?? 0) >= intent.min_followers!);
  }

  if (candidates.length === 0) {
    const trace_done = trace.finish("partial", "No candidates found");
    saveExecution(trace_done);
    const report = generateReport({
      leads: [],
      user_request: trace_done.user_request,
      top_n: intent.top_n,
    });
    return {
      report_text: report.text,
      report_json: report.json,
      candidates_count: 0,
      researched_count: 0,
      validated_count: 0,
      stored_count: 0,
      scored_count: 0,
      intelligenced_count: 0,
      execution_id: trace_done.id,
      outcome: "partial",
    };
  }

  // ── 3. RESEARCH (PARALLEL batches) ──────────────────────
  const researchedLeads: Lead[] = [];
  for (const batch of chunk(candidates, concurrency)) {
    const results = await Promise.all(
      batch.map((c) => runResearch(providers.research, providers.scraping, { candidate: c }, trace))
    );
    researchedLeads.push(...results.map((r) => r.lead));
  }

  // ── 4. VALIDATION (PARALLEL) ─────────────────────────────
  const validatedLeads: Lead[] = [];
  for (const batch of chunk(researchedLeads, concurrency)) {
    const results = await Promise.all(
      batch.map((lead) => runValidation(providers.verification, { lead }, trace))
    );
    validatedLeads.push(...results.map((r) => r.lead));
  }

  // ── 5. DEDUP + STORAGE (PARALLEL but careful — DB writes) ──
  // For DB safety, dedup is serialized within a batch but batches are parallel-ish
  const storedLeads: Lead[] = [];
  for (const batch of chunk(validatedLeads, Math.max(1, Math.floor(concurrency / 2)))) {
    const results = await Promise.all(
      batch.map((lead) => runDedup({ lead }, trace))
    );
    storedLeads.push(...results.map((r) => r.stored));
  }

  // ── 6. SCORING (PARALLEL — pure computation) ──────────────
  // CRITICAL FIX (ARCH-C1): re-save the lead after scoring so the lead_score
  // evidence is persisted to the DB. Without this, /stats shows 0 scored
  // leads and run_outreach skips every lead (score unknown).
  const scoredLeads: Lead[] = [];
  for (const batch of chunk(storedLeads, concurrency)) {
    const results = await Promise.all(
      batch.map((lead) => runScoring({ lead }, trace))
    );
    // Re-save each scored lead to persist the lead_score evidence
    for (const r of results) {
      saveLead(r.lead);
    }
    scoredLeads.push(...results.map((r) => r.lead));
  }

  // ── 7. INTELLIGENCE (PARALLEL — LLM calls, optional) ──────
  // CRITICAL FIX (ARCH-C1): re-save the lead after intelligence so the
  // llm_intelligence evidence is persisted to the DB.
  let intelligencedLeads = scoredLeads;
  let intelligencedCount = 0;
  if (intent.enable_intelligence !== false && intent.offer_description) {
    intelligencedLeads = [];
    for (const batch of chunk(scoredLeads, Math.max(1, Math.floor(concurrency / 2)))) {
      const results = await Promise.all(
        batch.map((lead) => runIntelligence({ lead, offer_description: intent.offer_description }, trace))
      );
      // Re-save each intelligenced lead to persist the llm_intelligence evidence
      for (const r of results) {
        saveLead(r.lead);
      }
      intelligencedLeads.push(...results.map((r) => r.lead));
      intelligencedCount += results.length;
    }
  }

  // ── 8. REPORT ───────────────────────────────────────────────
  const report = generateReport({
    leads: intelligencedLeads,
    user_request: trace.getTrace().user_request,
    top_n: intent.top_n,
  });

  const trace_done = trace.finish("success", `${intelligencedLeads.length} leads stored`);
  saveExecution(trace_done);

  return {
    report_text: report.text,
    report_json: report.json,
    candidates_count: candidates.length,
    researched_count: researchedLeads.length,
    validated_count: validatedLeads.length,
    stored_count: storedLeads.length,
    scored_count: scoredLeads.length,
    intelligenced_count: intelligencedCount,
    execution_id: trace_done.id,
    outcome: "success",
  };
}

/** Helper: chunk an array into sub-arrays of size n */
function chunk<T>(arr: T[], n: number): T[][] {
  if (n <= 1) return arr.map((x) => [x]);
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += n) {
    chunks.push(arr.slice(i, i + n));
  }
  return chunks;
}
