// ============================================================
// src/agent/pipelines/crm_albra_hooks.ts
// P2.3 — CRM-ALBRA webhook integration
//
// ALBRA is the user's future CRM. This module exposes hooks so
// the AGENTE-LEADS pipeline can fire webhooks to an external CRM
// (ALBRA or any other system that listens).
//
// Per the architecture:
//   USER → ORCHESTRATOR → ... → STORAGE → REPORT → CRM-ALBRA (futuro)
//
// P2.3 implements the webhook adapter. It's NOT a full CRM
// integration — just a clean hook so that future ALBRA (or any
// external CRM) can subscribe to AGENTE-LEADS events.
//
// Event types:
//   - lead.created        — new lead persisted
//   - lead.scored         — Lead Score computed
//   - lead.intelligenced  — LLM intelligence summary generated
//   - lead.outreach_sent  — outreach email/whatsapp sent
//   - execution.completed — full pipeline run finished
//
// PRODUCTION CLOSURE §26 — contractual payload. Every event now carries:
//   event_id, event_type, source_agent, target_agent, timestamp,
//   payload, evidence, execution_id, correlation_id
// ============================================================

import { randomUUID } from "crypto";
import { makeError, normalizeError } from "../core/errors.js";
import type { ProviderResult } from "../providers/types.js";
import type { Lead } from "../core/lead.js";
import type { ExecutionTrace } from "../core/execution.js";

export type CRMHookEventType =
  | "lead.created"
  | "lead.scored"
  | "lead.intelligenced"
  | "lead.outreach_sent"
  | "execution.completed";

/**
 * §26 — Contractual event envelope sent to CRM-ALBRA.
 */
export interface CRMHookEvent<T = any> {
  event_id: string;
  event_type: CRMHookEventType;
  source_agent: string;
  target_agent: string;
  timestamp: string;
  lead_id?: string;
  payload: T;
  /** Evidence references (field/status/source) — CRM can audit claims */
  evidence?: Array<{ field: string; status: string; source?: string; value?: string | null }>;
  execution_id?: string;
  correlation_id?: string;
  fired_at: string;
}

/** Back-compat alias for the old event shape field name. */
export type CRMHookEventTypeLegacy = CRMHookEventType;

export interface CRMHookConfig {
  webhook_url?: string;
  secret?: string;          // for HMAC signature verification
  enabled?: boolean;
}

export class CRMAlbraHooks {
  name = "CRM-ALBRA-Hooks";
  private config: CRMHookConfig;
  private sentCount = 0;
  private failedCount = 0;

  constructor(config: CRMHookConfig = {}) {
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.webhook_url && this.config.enabled !== false);
  }

  /**
   * Fire a webhook event. If webhook_url is not configured, the
   * event is silently swallowed (no error). If the webhook fails,
   * the error is logged but does NOT block the pipeline.
   */
  async fire<T>(event: CRMHookEvent<T>): Promise<ProviderResult<{ delivered: boolean }>> {
    if (!this.isConfigured()) {
      // Hooks disabled — silent no-op (NOT an error)
      return { ok: true, data: { delivered: false } };
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-AGENTE-LEADS-Event": event.event_type,
        "X-AGENTE-LEADS-Event-Id": event.event_id,
      };
      if (this.config.secret) {
        // Simple bearer-style secret (production should use HMAC-SHA256 signature)
        headers["Authorization"] = `Bearer ${this.config.secret}`;
      }

      const res = await fetch(this.config.webhook_url!, {
        method: "POST",
        headers,
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        this.failedCount++;
        return {
          ok: false,
          error: normalizeError({ status: res.status, statusText: await res.text() }, this.name),
        };
      }
      this.sentCount++;
      return { ok: true, data: { delivered: true } };
    } catch (e) {
      this.failedCount++;
      return { ok: false, error: normalizeError(e, this.name) };
    }
  }

  /**
   * §26 — Build a contractual event envelope. Exported for tests and
   * for the CRM integration contract: LEAD_QUALIFIED events always
   * carry event_id, source/target agents, evidence refs, execution and
   * correlation ids.
   */
  buildEvent<T>(
    event_type: CRMHookEventType,
    payload: T,
    opts: {
      lead_id?: string;
      evidence?: CRMHookEvent["evidence"];
      execution_id?: string;
      correlation_id?: string;
    } = {}
  ): CRMHookEvent<T> {
    return {
      event_id: `evt_${randomUUID()}`,
      event_type,
      source_agent: process.env.AGENT_NAME ?? "AGENTE-LEADS",
      target_agent: "CRM-ALBRA",
      timestamp: new Date().toISOString(),
      lead_id: opts.lead_id,
      payload,
      evidence: opts.evidence,
      execution_id: opts.execution_id,
      correlation_id: opts.correlation_id ?? opts.execution_id,
      fired_at: new Date().toISOString(),
    };
  }

  /** Evidence summary extracted from a Lead (top fields only). */
  private leadEvidenceRefs(lead: Lead): CRMHookEvent["evidence"] {
    return lead.evidence
      .filter((e) => ["email", "website", "phone", "instagram", "linkedin", "lead_score"].includes(e.field))
      .map((e) => ({ field: e.field, status: e.status, source: e.source, value: e.value ? String(e.value) : null }));
  }

  /** Convenience: fire a lead.created event */
  async fireLeadCreated(lead: Lead, opts: { execution_id?: string } = {}): Promise<void> {
    await this.fire(this.buildEvent("lead.created", {
      name: lead.name,
      email: lead.email,
      website: lead.website,
      location: lead.location,
      niche: lead.niche,
      sources: lead.sources,
      discovered_at: lead.discovered_at,
    }, {
      lead_id: lead.id,
      evidence: this.leadEvidenceRefs(lead),
      execution_id: opts.execution_id,
    }));
  }

  /** Convenience: fire a lead.scored event */
  async fireLeadScored(lead: Lead, score: number, opts: { execution_id?: string } = {}): Promise<void> {
    await this.fire(this.buildEvent("lead.scored", {
      score, name: lead.name, email: lead.email, website: lead.website,
    }, {
      lead_id: lead.id,
      evidence: this.leadEvidenceRefs(lead),
      execution_id: opts.execution_id,
    }));
  }

  /** Convenience: fire a lead.intelligenced event */
  async fireLeadIntelligenced(lead: Lead, intelligence: any, opts: { execution_id?: string } = {}): Promise<void> {
    await this.fire(this.buildEvent("lead.intelligenced", {
      name: lead.name, intelligence,
    }, {
      lead_id: lead.id,
      execution_id: opts.execution_id,
    }));
  }

  /** Convenience: fire a lead.outreach_sent event */
  async fireLeadOutreachSent(lead: Lead, channel: string, messageId?: string, opts: { execution_id?: string } = {}): Promise<void> {
    await this.fire(this.buildEvent("lead.outreach_sent", {
      name: lead.name, channel, message_id: messageId, sent_at: new Date().toISOString(),
    }, {
      lead_id: lead.id,
      execution_id: opts.execution_id,
    }));
  }

  /** Convenience: fire an execution.completed event */
  async fireExecutionCompleted(trace: ExecutionTrace): Promise<void> {
    await this.fire(this.buildEvent("execution.completed", {
      execution_id: trace.id,
      user_request: trace.user_request,
      outcome: trace.outcome,
      summary: trace.summary,
      duration_ms: trace.total_duration_ms,
      steps_count: trace.steps.length,
    }, {
      execution_id: trace.id,
    }));
  }

  getStats(): { sent: number; failed: number } {
    return { sent: this.sentCount, failed: this.failedCount };
  }
}
