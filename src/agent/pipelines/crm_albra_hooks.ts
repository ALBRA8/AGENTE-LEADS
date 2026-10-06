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
// ============================================================

import { makeError, normalizeError } from "../core/errors.js";
import type { ProviderResult } from "../providers/types.js";
import type { Lead } from "../core/lead.js";
import type { ExecutionTrace } from "../core/execution.js";

export interface CRMHookEvent<T = any> {
  type: "lead.created" | "lead.scored" | "lead.intelligenced" | "lead.outreach_sent" | "execution.completed";
  lead_id?: string;
  payload: T;
  fired_at: string;
}

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
        "X-AGENTE-LEADS-Event": event.type,
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

  /** Convenience: fire a lead.created event */
  async fireLeadCreated(lead: Lead): Promise<void> {
    await this.fire({
      type: "lead.created",
      lead_id: lead.id,
      payload: {
        name: lead.name,
        email: lead.email,
        website: lead.website,
        location: lead.location,
        niche: lead.niche,
        sources: lead.sources,
        discovered_at: lead.discovered_at,
      },
      fired_at: new Date().toISOString(),
    });
  }

  /** Convenience: fire a lead.scored event */
  async fireLeadScored(lead: Lead, score: number): Promise<void> {
    await this.fire({
      type: "lead.scored",
      lead_id: lead.id,
      payload: { score, name: lead.name, email: lead.email, website: lead.website },
      fired_at: new Date().toISOString(),
    });
  }

  /** Convenience: fire a lead.intelligenced event */
  async fireLeadIntelligenced(lead: Lead, intelligence: any): Promise<void> {
    await this.fire({
      type: "lead.intelligenced",
      lead_id: lead.id,
      payload: { name: lead.name, intelligence },
      fired_at: new Date().toISOString(),
    });
  }

  /** Convenience: fire a lead.outreach_sent event */
  async fireLeadOutreachSent(lead: Lead, channel: string, messageId?: string): Promise<void> {
    await this.fire({
      type: "lead.outreach_sent",
      lead_id: lead.id,
      payload: { name: lead.name, channel, message_id: messageId, sent_at: new Date().toISOString() },
      fired_at: new Date().toISOString(),
    });
  }

  /** Convenience: fire an execution.completed event */
  async fireExecutionCompleted(trace: ExecutionTrace): Promise<void> {
    await this.fire({
      type: "execution.completed",
      payload: {
        execution_id: trace.id,
        user_request: trace.user_request,
        outcome: trace.outcome,
        summary: trace.summary,
        duration_ms: trace.total_duration_ms,
        steps_count: trace.steps.length,
      },
      fired_at: new Date().toISOString(),
    });
  }

  getStats(): { sent: number; failed: number } {
    return { sent: this.sentCount, failed: this.failedCount };
  }
}
