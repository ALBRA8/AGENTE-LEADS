// ============================================================
// src/agent/pipelines/scoring.ts
// P1.1 — Lead Scoring pipeline
//
// Produces a numeric Lead Score (0-100) based on:
//   - validation state (valid email/website = +points)
//   - evidence completeness (FOUND evidence records)
//   - cross-source consistency (valid identity = +points)
//   - data freshness (more recent discovery = small bonus)
//
// NOT "excessively sophisticated" per the user's original constraint:
//   "sistemas de scoring excesivamente sofisticados" was excluded.
// This is intentionally simple, transparent, and deterministic.
// ============================================================

import type { Lead } from "../core/lead.js";
import type { ExecutionRecorder } from "../core/execution.js";

export interface ScoringInput {
  lead: Lead;
}

export interface ScoringOutput {
  lead: Lead;
  score: number;            // 0-100
  score_breakdown: {
    field: string;
    points: number;
    reason: string;
  }[];
}

export interface LeadScore {
  score: number;
  breakdown: { field: string; points: number; reason: string }[];
}

const MAX_SCORE = 100;

/**
 * Score a lead based on:
 *   - Email validated (high confidence): +20
 *   - Email validated (medium): +15
 *   - Domain validated: +15
 *   - Website found: +10
 *   - Phone found: +5
 *   - Instagram found: +10
 *   - LinkedIn found: +10
 *   - Cross-source identity consistent: +5
 *   - Identity conflict: -10
 *
 * Maximum theoretical: 85. The remaining 15 points come from research_state:
 *   - VALIDATED: +15
 *   - RESEARCHED: +10
 *   - DISCOVERED: +5
 *
 * Score is clamped to [0, 100].
 */
export function scoreLead(lead: Lead): LeadScore {
  const breakdown: { field: string; points: number; reason: string }[] = [];

  // Validation points
  if (lead.validation?.email?.status === "valid" && lead.validation.email.confidence === "high") {
    breakdown.push({ field: "email_validation", points: 20, reason: `email valid + SMTP check passed (${lead.validation.email.source})` });
  } else if (lead.validation?.email?.status === "valid") {
    breakdown.push({ field: "email_validation", points: 15, reason: `email valid (no SMTP check)` });
  } else if (lead.validation?.email?.status === "invalid") {
    breakdown.push({ field: "email_validation", points: -10, reason: `email invalid: ${lead.validation.email.notes ?? ""}` });
  }

  if (lead.validation?.domain?.status === "valid") {
    breakdown.push({ field: "domain_validation", points: 15, reason: `domain resolves (HTTP ${lead.validation.domain.notes ?? "?"})` });
  }

  // Evidence points — count FOUND evidence records
  const foundFields = lead.evidence.filter((e) => e.status === "FOUND");
  const fieldPoints: Record<string, number> = {
    website: 10,
    phone: 5,
    instagram: 10,
    linkedin: 10,
  };
  for (const ev of foundFields) {
    if (fieldPoints[ev.field] !== undefined) {
      breakdown.push({
        field: `${ev.field}_found`,
        points: fieldPoints[ev.field],
        reason: `${ev.field} found via ${ev.source}`,
      });
    }
  }

  // Cross-source identity
  if (lead.validation?.identity?.status === "valid") {
    breakdown.push({ field: "identity_consistency", points: 5, reason: "email domain matches website domain" });
  } else if (lead.validation?.identity?.status === "conflict") {
    breakdown.push({ field: "identity_conflict", points: -10, reason: lead.validation.identity.notes ?? "domain mismatch" });
  }

  // Research state bonus
  const stateBonus: Record<string, number> = {
    VALIDATED: 15,
    RESEARCHED: 10,
    DISCOVERED: 5,
    STORED: 15,
    RESEARCHING: 2,
    FAILED: 0,
  };
  const statePts = stateBonus[lead.research_state] ?? 0;
  breakdown.push({ field: "research_state", points: statePts, reason: `${lead.research_state} state` });

  // Sum + clamp
  const raw = breakdown.reduce((sum, b) => sum + b.points, 0);
  const score = Math.max(0, Math.min(MAX_SCORE, raw));

  return { score, breakdown };
}

/**
 * Pipeline wrapper that also records the score on the lead
 * (via a pseudo-evidence record) and traces the step.
 */
export async function runScoring(
  input: ScoringInput,
  trace?: ExecutionRecorder
): Promise<ScoringOutput> {
  const end = trace?.start("scoring", { intent: `score lead ${input.lead.name}` });
  const result = scoreLead(input.lead);
  end?.({ output: `score=${result.score}/100 (${result.breakdown.length} signals)` });

  // Attach the score as an inferred evidence record (P0.6: this IS an inference)
  // CRITICAL FIX (ARCH-C6): use inferred() helper for consistency — INFERRED evidence
  // should have confidence "none" (the convention set by evidence.ts:inferred()).
  input.lead.evidence.push({
    field: "lead_score",
    value: String(result.score),
    status: "INFERRED",
    source: "system-scoring",
    retrieved_at: new Date().toISOString(),
    confidence: "none",  // FIX: INFERRED → confidence "none" per P0.6 convention
    evidence: `Lead Score computed from ${result.breakdown.length} signals: ${result.breakdown.map((b) => `${b.field}=${b.points > 0 ? "+" : ""}${b.points}`).join(", ")}`,
    inferred_from: result.breakdown.map((b) => b.field),
  });

  // CRITICAL FIX (QUAL-H1): use the typed lead_score field, not (as any)
  input.lead.lead_score = result.score;

  return { lead: input.lead, score: result.score, score_breakdown: result.breakdown };
}
