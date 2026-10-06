// ============================================================
// src/agent/pipelines/outreach.ts
// P2.4 — Outreach pipeline
//
// Generates proposals for high-tier leads and sends them via the
// configured outreach provider (SendGrid for email, WhatsApp Cloud
// for phone).
//
// Pipeline:
//   1. Filter leads by minimum score (default >= 50 = Tier A/B)
//   2. For each lead, generate a personalized proposal via LLM (GLM 5.3 Flash)
//   3. For each lead, determine outreach channel:
//        - has validated email → email
//        - has phone (no email) → whatsapp
//        - has neither → skip (mark as "no_contact_channel")
//   4. Send the proposal via the chosen provider
//   5. Fire CRM-ALBRA webhook for each sent outreach
//
// The user EXPLICITLY asked for outreach via OFFICIAL APIs only:
//   "Cuando una fuente requiera una API oficial, utilizar su API correspondiente."
//   "La arquitectura debe estar preparada para añadir posteriormente integraciones
//    con email, WhatsApp, CRM y otras herramientas de ventas,
//    siempre utilizando métodos autorizados."
//
// P2.4 honors this: no DM bots, no CAPTCHA bypass, no fake accounts.
// ============================================================

import { nvidiaNIMClient, NVIDIA_CONFIG, withRetry } from "../../config/nvidia.js";
import type { Lead } from "../core/lead.js";
import { inferred, type EvidenceRecord } from "../core/evidence.js";
import type { ExecutionRecorder } from "../core/execution.js";
import type { EmailOutreachProvider, WhatsAppOutreachProvider, OutreachInput, OutreachResult } from "../providers/outreach.js";
import { CRMAlbraHooks } from "./crm_albra_hooks.js";

export interface OutreachInput_Pipeline {
  leads: Lead[];
  /** Minimum Lead Score to qualify for outreach (default 50) */
  min_score?: number;
  /** The seller's offer description — feeds the LLM proposal generator */
  offer_description: string;
  /** Optional: caller-provided email provider (defaults to SendGrid) */
  email_provider?: EmailOutreachProvider | null;
  /** Optional: caller-provided whatsapp provider (defaults to WhatsAppCloud) */
  whatsapp_provider?: WhatsAppOutreachProvider | null;
  /** CRM-ALBRA webhook hooks (optional) */
  crm_hooks?: CRMAlbraHooks | null;
  /** Default: don't actually send, just generate the proposal (safety default) */
  dry_run?: boolean;
  /** Proposal style: professional | friendly | direct | persuasive */
  style?: "professional" | "friendly" | "direct" | "persuasive";
  /**
   * P2.4 testability: inject a custom proposal generator.
   * Defaults to the LLM (GLM 5.3 Flash) proposal generator.
   * Tests pass a fake to avoid real LLM calls.
   */
  proposal_generator?: (lead: Lead, offer: string, style: string) => Promise<string>;
}

export interface OutreachOutput {
  total_leads: number;
  qualified_leads: number;
  sent: number;
  failed: number;
  skipped: number;
  skip_reasons: { reason: string; count: number }[];
  results: {
    lead: Lead;
    channel?: "email" | "whatsapp";
    proposal?: string;
    status: "sent" | "failed" | "skipped" | "dry_run";
    skip_reason?: string;
    message_id?: string;
    error?: string;
  }[];
}

const SYSTEM_PROMPT = `You are AGENTE LEADS' outreach proposal generator. Generate a personalized commercial proposal for a lead based on their public information.

Output ONLY the proposal text (no markdown, no JSON, no preamble).

Rules:
1. Mention the lead's name in the first paragraph.
2. Reference a SPECIFIC pain point or opportunity based on the evidence (use the validation state + evidence records provided).
3. Explain concretely how the seller's offer solves that pain.
4. End with a single clear call-to-action.
5. Tone: {STYLE} — adapt vocabulary accordingly.
6. Length: 150-250 words.
7. NEVER invent facts. If you don't know something, don't mention it.
8. NEVER say "we scraped your site" or mention data collection.`;

export async function runOutreach(
  input: OutreachInput_Pipeline,
  trace?: ExecutionRecorder
): Promise<OutreachOutput> {
  const minScore = input.min_score ?? 50;
  const dryRun = input.dry_run !== false;  // safety default: dry run unless explicitly false
  const style = input.style ?? "professional";

  const end = trace?.start("outreach", {
    intent: `outreach to ${input.leads.length} leads (min score ${minScore}, dry_run=${dryRun})`,
  });

  const results: OutreachOutput["results"] = [];
  const skipReasons = new Map<string, number>();
  let sent = 0, failed = 0, skipped = 0;

  for (const lead of input.leads) {
    const score = lead.lead_score as number | undefined;

    // 1. Filter by score — skip if below threshold (no LLM call wasted)
    if (score === undefined || score < minScore) {
      results.push({ lead, status: "skipped", skip_reason: `score ${score ?? "unknown"} < ${minScore}` });
      skipped++;
      skipReasons.set("below_score_threshold", (skipReasons.get("below_score_threshold") ?? 0) + 1);
      continue;
    }

    // 2. Determine outreach channel FIRST (before LLM call) — saves tokens
    let channel: "email" | "whatsapp" | undefined;
    if (lead.email && lead.validation?.email?.status === "valid") {
      channel = "email";
    } else if (lead.phone) {
      channel = "whatsapp";
    } else {
      results.push({ lead, status: "skipped", skip_reason: "no_contact_channel (no validated email, no phone)" });
      skipped++;
      skipReasons.set("no_contact_channel", (skipReasons.get("no_contact_channel") ?? 0) + 1);
      continue;
    }

    // 3. Check that the channel provider is configured (before LLM call)
    const providerForChannel = channel === "email" ? input.email_provider : input.whatsapp_provider;
    if (!dryRun && !providerForChannel) {
      results.push({
        lead, channel,
        status: "skipped",
        skip_reason: `${channel}_provider not configured`,
      });
      skipped++;
      skipReasons.set(`${channel}_provider_not_configured`, (skipReasons.get(`${channel}_provider_not_configured`) ?? 0) + 1);
      continue;
    }

    // 4. Generate proposal via LLM or custom generator
    //    In dry_run mode, proposal failure is non-fatal — we just report it
    let proposal: string | undefined;
    let proposalError: string | undefined;
    try {
      const gen = input.proposal_generator ?? ((lead, offer, style) => generateProposal(lead, offer, style, trace));
      proposal = await gen(lead, input.offer_description, style);
    } catch (e: any) {
      if (!dryRun) {
        results.push({ lead, channel, status: "failed", error: `proposal generation failed: ${e.message}` });
        failed++;
        continue;
      }
      proposalError = `proposal generation failed: ${e.message}`;
    }

    // 5. Dry run — generate proposal but don't send
    if (dryRun) {
      results.push({
        lead, channel, proposal,
        status: "dry_run",
        skip_reason: proposalError ?? "dry_run=true (set dry_run=false to actually send)",
        error: proposalError,
      });
      continue;
    }

    // 6. Actually send via the configured provider
    const outreachInput: OutreachInput = {
      to: channel === "email" ? lead.email! : lead.phone!,
      subject: `Propuesta para ${lead.name}`,
      body: proposal!,
      lead_name: lead.name,
    };

    const sendResult = await providerForChannel!.send(outreachInput);

    if (sendResult.ok && sendResult.data) {
      sent++;
      // Attach evidence record
      const ev: EvidenceRecord = inferred(
        "outreach_sent",
        `${channel}:${sendResult.data.message_id ?? "no_id"}`,
        `Outreach sent via ${channel} at ${sendResult.data.accepted_at}`,
        [`lead:${lead.id ?? lead.name}`, `channel:${channel}`]
      );
      lead.evidence.push(ev);

      // Fire CRM hook
      if (input.crm_hooks) {
        await input.crm_hooks.fireLeadOutreachSent(lead, channel, sendResult.data.message_id);
      }

      results.push({
        lead, channel, proposal,
        status: "sent",
        message_id: sendResult.data.message_id,
      });
    } else {
      failed++;
      results.push({
        lead, channel, proposal,
        status: "failed",
        error: sendResult.error?.message ?? "unknown send failure",
      });
    }
  }

  end?.({ output: `sent=${sent} failed=${failed} skipped=${skipped}` });

  return {
    total_leads: input.leads.length,
    qualified_leads: input.leads.filter((l) => (l.lead_score ?? 0) >= minScore).length,
    sent, failed, skipped,
    skip_reasons: Array.from(skipReasons.entries()).map(([reason, count]) => ({ reason, count })),
    results,
  };
}

async function generateProposal(
  lead: Lead,
  offerDescription: string,
  style: string,
  trace?: ExecutionRecorder
): Promise<string> {
  const end = trace?.start("outreach.proposal.glm_5_3_flash", {
    provider: "NVIDIA NIM GLM 5.3 Flash",
    intent: `generate proposal for ${lead.name}`,
  });

  const userMsg = buildProposalPrompt(lead, offerDescription, style);

  try {
    const response = await withRetry(
      () => nvidiaNIMClient.chat.completions.create({
        model: NVIDIA_CONFIG.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT.replace("{STYLE}", style) },
          { role: "user", content: userMsg },
        ],
        temperature: 0.5,
        max_tokens: NVIDIA_CONFIG.maxTokens,
      }),
      "proposal generation"
    );

    const content = response?.choices?.[0]?.message?.content;
    if (!content) {
      end?.({ error: { type: "EMPTY_RESULT", message: "LLM returned no proposal", retryable: false } });
      return "(No se pudo generar la propuesta — LLM returned empty.)";
    }
    end?.({ output: `proposal generated (${content.length} chars)` });
    return content.trim();
  } catch (e: any) {
    end?.({ error: e });
    throw e;
  }
}

function buildProposalPrompt(lead: Lead, offerDescription: string, style: string): string {
  const lines: string[] = [];
  lines.push(`SELLER'S OFFER:`);
  lines.push(offerDescription);
  lines.push("");
  lines.push(`LEAD:`);
  lines.push(`- Name: ${lead.name}`);
  lines.push(`- Username: ${lead.username ?? "n/a"}`);
  lines.push(`- Website: ${lead.website ?? "no encontrado"}`);
  lines.push(`- Email (validated): ${lead.email && lead.validation?.email?.status === "valid" ? lead.email : "no validado"}`);
  lines.push(`- Phone: ${lead.phone ?? "no encontrado"}`);
  lines.push(`- Location: ${lead.location ?? "n/a"}`);
  lines.push(`- Niche: ${lead.niche ?? "n/a"}`);
  lines.push(`- Lead Score: ${lead.lead_score ?? "n/a"}/100`);
  lines.push("");
  lines.push(`EVIDENCE (use these for personalization):`);
  for (const e of lead.evidence) {
    lines.push(`- ${e.field}: ${e.status} — ${e.value ?? "(no value)"} — ${e.evidence}`);
  }
  lines.push("");
  lines.push(`VALIDATION STATE:`);
  if (lead.validation) {
    for (const [field, v] of Object.entries(lead.validation)) {
      lines.push(`- ${field}: ${v.status} (notes: ${v.notes ?? "n/a"})`);
    }
  }
  lines.push("");
  lines.push(`Generate a ${style} proposal in Spanish, 150-250 words, that:`);
  lines.push(`1. Mentions ${lead.name} by name`);
  lines.push(`2. References a SPECIFIC pain/opportunity from the evidence`);
  lines.push(`3. Explains how the seller's offer helps`);
  lines.push(`4. Ends with ONE clear call to action`);
  return lines.join("\n");
}
