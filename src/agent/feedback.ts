// ============================================================
// src/agent/feedback.ts
// PRODUCTION CLOSURE §23 — Structured feedback loop.
//
// Registers (and exposes stats for):
//   - lead accepted / rejected (+ reason)
//   - score correct / incorrect
//   - provider useful / not useful
//   - outreach successful / failed
//
// FEEDS (§24 SELF-IMPROVEMENT): these rows are the substrate for
// learning — memory consolidation, skill success-rates and provider
// degradation decisions. This module never mutates code or leads.
// ============================================================

import { ensureAgentInfraTables } from "./storage/agent_infra.js";
import { getDb } from "./storage/lead_intelligence.js";

export type LeadFeedbackType =
  | "lead_accepted"
  | "lead_rejected"
  | "score_correct"
  | "score_incorrect";

export function recordLeadFeedback(
  lead_id: string,
  feedback_type: LeadFeedbackType,
  reason?: string,
  given_by?: string
): void {
  ensureAgentInfraTables();
  getDb()
    .prepare(
      "INSERT INTO lead_feedback (lead_id, feedback_type, reason, given_by) VALUES (?, ?, ?, ?)"
    )
    .run(lead_id, feedback_type, reason ?? null, given_by ?? null);
}

export function recordProviderFeedback(
  provider: string,
  useful: boolean,
  execution_id?: string
): void {
  ensureAgentInfraTables();
  getDb()
    .prepare("INSERT INTO provider_feedback (provider, useful, execution_id) VALUES (?, ?, ?)")
    .run(provider, useful ? 1 : 0, execution_id ?? null);
}

export function recordOutreachFeedback(
  lead_id: string,
  channel: string,
  success: boolean,
  message_id?: string
): void {
  ensureAgentInfraTables();
  getDb()
    .prepare(
      "INSERT INTO outreach_feedback (lead_id, channel, success, message_id) VALUES (?, ?, ?, ?)"
    )
    .run(lead_id, channel, success ? 1 : 0, message_id ?? null);
}

// ── Read models ────────────────────────────────────────────

export interface FeedbackStats {
  leads: { accepted: number; rejected: number };
  scores: { correct: number; incorrect: number };
  providers: { useful: number; not_useful: number };
  outreach: { successful: number; failed: number };
}

export function getFeedbackStats(): FeedbackStats {
  ensureAgentInfraTables();
  const db = getDb();
  const count = (sql: string, ...args: any[]): number => {
    const row = db.prepare(sql).get(...args) as { c: number } | undefined;
    return row?.c ?? 0;
  };

  return {
    leads: {
      accepted: count("SELECT COUNT(*) AS c FROM lead_feedback WHERE feedback_type = 'lead_accepted'"),
      rejected: count("SELECT COUNT(*) AS c FROM lead_feedback WHERE feedback_type = 'lead_rejected'"),
    },
    scores: {
      correct: count("SELECT COUNT(*) AS c FROM lead_feedback WHERE feedback_type = 'score_correct'"),
      incorrect: count("SELECT COUNT(*) AS c FROM lead_feedback WHERE feedback_type = 'score_incorrect'"),
    },
    providers: {
      useful: count("SELECT COUNT(*) AS c FROM provider_feedback WHERE useful = 1"),
      not_useful: count("SELECT COUNT(*) AS c FROM provider_feedback WHERE useful = 0"),
    },
    outreach: {
      successful: count("SELECT COUNT(*) AS c FROM outreach_feedback WHERE success = 1"),
      failed: count("SELECT COUNT(*) AS c FROM outreach_feedback WHERE success = 0"),
    },
  };
}
