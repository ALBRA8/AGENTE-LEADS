// ============================================================
// src/agent/tools/run_outreach.ts
// P2.4 — Tool that runs the outreach pipeline for stored leads
//
// The LLM calls this when the user wants to actually send proposals
// (after run_lead_pipeline produced TOP LEADS).
//
// By default, runs in DRY RUN mode (generates proposals but doesn't
// actually send). User must explicitly set dry_run=false to actually
// send emails/WhatsApp messages — safety default.
// ============================================================

import type { Tool } from "../types.js";
import { runOutreach } from "../pipelines/outreach.js";
import { SendGridEmailProvider, WhatsAppCloudProvider, MockOutreachProvider } from "../providers/outreach.js";
import { CRMAlbraHooks } from "../pipelines/crm_albra_hooks.js";
import { getAllLeads } from "../storage/lead_intelligence.js";

export const runOutreachTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "run_outreach",
      description:
        "Genera propuestas comerciales personalizadas con IA (GLM 5.3 Flash) " +
        "para los leads almacenados con Lead Score >= min_score (default 50). " +
        "Por defecto se ejecuta en DRY RUN (genera propuestas pero NO las envía). " +
        "Para enviar realmente, el usuario debe pasar dry_run=false explícitamente. " +
        "Canal de outreach: email si hay email validado, WhatsApp si hay teléfono. " +
        "Usa APIs oficiales (SendGrid para email, WhatsApp Cloud API para WhatsApp). " +
        "Fire CRM-ALBRA webhook si está configurado.",
      parameters: {
        type: "object",
        properties: {
          min_score: {
            type: "number",
            description: "Lead Score mínimo para calificar outreach (default 50). 0-100.",
            default: 50,
          },
          offer_description: {
            type: "string",
            description: "Descripción de la oferta del vendedor — alimenta el LLM para personalizar la propuesta",
          },
          dry_run: {
            type: "boolean",
            description: "Si true (default), genera propuestas pero no las envía. Si false, envía realmente.",
            default: true,
          },
          style: {
            type: "string",
            enum: ["professional", "friendly", "direct", "persuasive"],
            description: "Estilo de la propuesta (default: professional)",
            default: "professional",
          },
          limit: {
            type: "number",
            description: "Máximo número de leads a procesar (default 10)",
            default: 10,
          },
        },
        required: ["offer_description"],
      },
    }
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const offerDescription = String(args.offer_description ?? "");
    const minScore = typeof args.min_score === "number" ? args.min_score : 50;
    const dryRun = args.dry_run !== false; // default true
    const style = (args.style as any) ?? "professional";
    const limit = typeof args.limit === "number" ? args.limit : 10;

    if (!offerDescription) {
      return "Error: offer_description is required";
    }

    // Load stored leads (most recent first)
    const leads = getAllLeads(limit);

    // Wire up providers
    const emailProvider = new SendGridEmailProvider();
    const whatsappProvider = new WhatsAppCloudProvider();

    // Use mock providers if real ones aren't configured (so dry_run still works)
    const emailConfigured = await emailProvider.isConfigured();
    const whatsappConfigured = await whatsappProvider.isConfigured();
    const finalEmailProvider = emailConfigured ? emailProvider : new MockOutreachProvider();
    const finalWhatsappProvider = whatsappConfigured ? whatsappProvider : new MockOutreachProvider();

    // CRM hooks
    const crmHooks = new CRMAlbraHooks({
      webhook_url: process.env.CRM_ALBRA_WEBHOOK_URL || undefined,
      secret: process.env.CRM_ALBRA_SECRET || undefined,
      enabled: Boolean(process.env.CRM_ALBRA_WEBHOOK_URL),
    });

    try {
      const result = await runOutreach({
        leads,
        min_score: minScore,
        offer_description: offerDescription,
        email_provider: finalEmailProvider,
        whatsapp_provider: finalWhatsappProvider,
        crm_hooks: crmHooks,
        dry_run: dryRun,
        style,
      });

      // Format a human-readable summary
      const lines: string[] = [];
      lines.push(`# Outreach ${dryRun ? "(DRY RUN)" : "(REAL SEND)"}`);
      lines.push(``);
      lines.push(`- Total leads analizados: ${result.total_leads}`);
      lines.push(`- Leads cualificados (score >= ${minScore}): ${result.qualified_leads}`);
      lines.push(`- Enviados: ${result.sent}`);
      lines.push(`- Fallidos: ${result.failed}`);
      lines.push(`- Skipped: ${result.skipped}`);
      if (result.skip_reasons.length > 0) {
        lines.push(``);
        lines.push(`**Razones de skip:**`);
        for (const sr of result.skip_reasons) {
          lines.push(`- ${sr.reason}: ${sr.count}`);
        }
      }
      lines.push(``);
      lines.push(`**Detalle por lead:**`);
      for (const r of result.results) {
        lines.push(``);
        const score = r.lead.lead_score ?? "n/a";
        lines.push(`### ${r.lead.name} (score ${score}/100) — ${r.status.toUpperCase()}`);
        if (r.channel) lines.push(`- Canal: ${r.channel}`);
        if (r.message_id) lines.push(`- Message ID: ${r.message_id}`);
        if (r.skip_reason) lines.push(`- Skip: ${r.skip_reason}`);
        if (r.error) lines.push(`- Error: ${r.error}`);
        if (r.proposal && dryRun) {
          lines.push(``);
          lines.push(`**Propuesta generada (preview):**`);
          lines.push("```");
          lines.push(r.proposal);
          lines.push("```");
        }
      }

      lines.push(``);
      lines.push(`---`);
      lines.push(`CRM-ALBRA hooks: ${crmHooks.getStats().sent} sent, ${crmHooks.getStats().failed} failed`);
      lines.push(`Email provider: ${emailConfigured ? "SendGrid (configured)" : "Mock (SENDGRID_API_KEY not set)"}`);
      lines.push(`WhatsApp provider: ${whatsappConfigured ? "WhatsApp Cloud (configured)" : "Mock (WHATSAPP_TOKEN not set)"}`);

      return lines.join("\n");
    } catch (e: any) {
      return `Error ejecutando outreach: ${e.message}`;
    }
  },
};
