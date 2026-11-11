// ============================================================
// src/agent/pipelines/crm_albra_hooks.ts
// P2.3 + PRODUCTION CLOSURE §26 — CRM-ALBRA contractual envelope
//
// Event envelope (§26):
//   event_id        — unique ID per event (starts with "evt_")
//   event_type      — "lead.created" | "lead.scored" | ...
//   source_agent    — process.env.AGENT_NAME ?? "AGENTE-LEADS"
//   target_agent    — always "CRM-ALBRA"
//   timestamp       — ISO 8601
//   lead_id         — the lead this event refers to
//   payload         — the event-specific data
//   evidence        — evidence refs (field, status, source, value)
//   execution_id    — the pipeline execution that produced this event
//   correlation_id  — defaults to execution_id
//   fired_at        — ISO 8601
// ============================================================

import { makeError, normalizeError } from "../core/errors.js";
import type { ProviderResult } from "../providers/types.js";
import type { Lead } from "../core/lead.js";
import type { EvidenceRecord } from "../core/evidence.js";
import type { ExecutionTrace } from "../core/execution.js";
import { randomBytes } from "crypto";

export interface CRMHookOptions {
  execution_id?: string;
  evidence?: Array<{ field: string; status: string; source: string; value: string | null }>;
  correlation_id?: string;
}

export interface CRMContractEvent<T = any> {
  event_id: string;
  event_type: string;
  source_agent: string;
  target_agent: string;
  timestamp: string;
  lead_id?: string;
  payload: T;
  evidence?: Array<{ field: string; status: string; source: string; value: string | null }>;
  execution_id?: string;
  correlation_id?: string;
  fired_at: string;
}

// Keep the old interface for backward compat
export interface CRMHookEvent<T = any> {
  type: string;
  lead_id?: string;
  payload: T;
  fired_at: string;
}

export interface CRMHookConfig {
  webhook_url?: string;
  secret?: string;
  enabled?: boolean;
}

function generateEventId(): string {
  return `evt_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function leadEvidenceRefs(lead: Lead): Array<{ field: string; status: string; source: string; value: string | null }> {
  return (lead.evidence || []).map((e) => ({
    field: e.field,
    status: e.status,
    source: e.source ?? "",
    value: e.value != null ? String(e.value) : null,
  }));
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
   * §26: Build a contractual event envelope.
   * This is the canonical shape that CRM-ALBRA expects.
   */
  buildEvent<T>(
    eventType: string,
    payload: T,
    options: {
      lead_id?: string;
      evidence?: Array<{ field: string; status: string; source: string; value: string | null }>;
      execution_id?: string;
      correlation_id?: string;
    } = {}
  ): CRMContractEvent<T> {
    const execution_id = options.execution_id;
    return {
      event_id: generateEventId(),
      event_type: eventType,
      source_agent: process.env.AGENT_NAME ?? "AGENTE-LEADS",
      target_agent: "CRM-ALBRA",
      timestamp: new Date().toISOString(),
      lead_id: options.lead_id,
      payload,
      evidence: options.evidence,
      execution_id,
      correlation_id: options.correlation_id ?? execution_id,
      fired_at: new Date().toISOString(),
    };
  }

  /**
   * Fire a contractual event. If webhook_url is not configured,
   * the event is silently swallowed (no error).
   */
  async fire<T>(event: CRMContractEvent<T>): Promise<ProviderResult<{ delivered: boolean }>>;
  async fire<T>(event: CRMHookEvent<T>): Promise<ProviderResult<{ delivered: boolean }>>;
  async fire<T>(event: any): Promise<ProviderResult<{ delivered: boolean }>> {
    if (!this.isConfigured()) {
      return { ok: true, data: { delivered: false } };
    }

    try {
      const eventType = event.event_type ?? event.type;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-AGENTE-LEADS-Event": eventType,
      };
      if (this.config.secret) {
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

  /** Convenience: fire a lead.created event (§26 contractual) */
  async fireLeadCreated(lead: Lead, options?: CRMHookOptions): Promise<void> {
    const event = this.buildEvent(
      "lead.created",
      {
        name: lead.name,
        email: lead.email,
        website: lead.website,
        location: lead.location,
        niche: lead.niche,
        sources: lead.sources,
        discovered_at: lead.discovered_at,
      },
      {
        lead_id: lead.id,
        evidence: options?.evidence ?? leadEvidenceRefs(lead),
        execution_id: options?.execution_id,
      }
    );
    await this.fire(event);
  }

  /** Convenience: fire a lead.scored event (§26 contractual) */
  async fireLeadScored(lead: Lead, score: number, options?: CRMHookOptions): Promise<void> {
    const event = this.buildEvent(
      "lead.scored",
      { score, name: lead.name, email: lead.email, website: lead.website },
      {
        lead_id: lead.id,
        evidence: options?.evidence ?? leadEvidenceRefs(lead),
        execution_id: options?.execution_id,
      }
    );
    await this.fire(event);
  }

  /** Convenience: fire a lead.intelligenced event */
  async fireLeadIntelligenced(lead: Lead, intelligence: any, options?: CRMHookOptions): Promise<void> {
    const event = this.buildEvent(
      "lead.intelligenced",
      { name: lead.name, intelligence },
      {
        lead_id: lead.id,
        evidence: options?.evidence ?? leadEvidenceRefs(lead),
        execution_id: options?.execution_id,
      }
    );
    await this.fire(event);
  }

  /** Convenience: fire a lead.outreach_sent event */
  async fireLeadOutreachSent(lead: Lead, channel: string, messageId?: string, options?: CRMHookOptions): Promise<void> {
    const event = this.buildEvent(
      "lead.outreach_sent",
      { name: lead.name, channel, message_id: messageId, sent_at: new Date().toISOString() },
      {
        lead_id: lead.id,
        execution_id: options?.execution_id,
      }
    );
    await this.fire(event);
  }

  /** Convenience: fire an execution.completed event */
  async fireExecutionCompleted(trace: ExecutionTrace): Promise<void> {
    const event = this.buildEvent(
      "execution.completed",
      {
        execution_id: trace.id,
        user_request: trace.user_request,
        outcome: trace.outcome,
        summary: trace.summary,
        duration_ms: trace.total_duration_ms,
        steps_count: trace.steps.length,
      },
      {
        execution_id: trace.id,
      }
    );
    await this.fire(event);
  }

  getStats(): { sent: number; failed: number } {
    return { sent: this.sentCount, failed: this.failedCount };
  }
}
