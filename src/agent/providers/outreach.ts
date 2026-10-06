// ============================================================
// src/agent/providers/outreach.ts
// P2.1 + P2.2 — Outreach providers (Email + WhatsApp)
//
// Uses OFFICIAL APIs only:
//   - Email: SendGrid v3 API
//   - WhatsApp: WhatsApp Cloud API (Meta Graph)
//
// Per the user's explicit constraint:
//   "Cuando una fuente requiera una API oficial, utilizar su API correspondiente."
//
// Both providers return ProviderResult<OutreachResult> and use the
// normalized error taxonomy from P0.10.
// ============================================================

import { makeError, normalizeError, type ProviderError } from "../core/errors.js";
import type { ProviderResult } from "./types.js";

export interface OutreachInput {
  to: string;             // email or phone (whatsapp)
  subject?: string;       // email only
  body: string;           // email body or whatsapp message text
  from?: string;          // email only (override default)
  lead_name?: string;     // for personalization
  reply_to?: string;      // email only
}

export interface OutreachResult {
  channel: "email" | "whatsapp";
  to: string;
  message_id?: string;    // provider's message ID
  status: "sent" | "queued" | "delivered" | "failed";
  accepted_at: string;    // ISO 8601
  raw_response?: any;     // raw provider response for debugging
}

// ── Email provider (SendGrid) ─────────────────────────────

export interface EmailOutreachProvider {
  name: string;
  isConfigured(): Promise<boolean>;
  send(input: OutreachInput): Promise<ProviderResult<OutreachResult>>;
}

export class SendGridEmailProvider implements EmailOutreachProvider {
  name = "SendGrid";

  async isConfigured(): Promise<boolean> {
    return Boolean(process.env.SENDGRID_API_KEY && !process.env.SENDGRID_API_KEY.includes("your")) &&
           Boolean(process.env.SENDGRID_FROM_EMAIL);
  }

  async send(input: OutreachInput): Promise<ProviderResult<OutreachResult>> {
    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL ?? input.from;
    if (!apiKey) {
      return { ok: false, error: makeError("AUTH_FAILURE", "SENDGRID_API_KEY not set", { provider: this.name }) };
    }
    if (!fromEmail) {
      return { ok: false, error: makeError("INVALID_INPUT", "from email required (set SENDGRID_FROM_EMAIL)", { provider: this.name }) };
    }
    if (!input.to || !input.to.includes("@")) {
      return { ok: false, error: makeError("INVALID_INPUT", `invalid recipient email: ${input.to}`, { provider: this.name }) };
    }

    try {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{
            to: [{ email: input.to }],
            subject: input.subject ?? `Propuesta para ${input.lead_name ?? "su negocio"}`,
            ...(input.reply_to ? { reply_to: { email: input.reply_to } } : {}),
          }],
          from: { email: fromEmail },
          content: [{ type: "text/plain", value: input.body }],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return { ok: false, error: normalizeError({ status: res.status, statusText: errText }, this.name) };
      }

      const messageId = res.headers.get("x-message-id") ?? undefined;
      return {
        ok: true,
        data: {
          channel: "email",
          to: input.to,
          message_id: messageId ?? undefined,
          status: "queued",
          accepted_at: new Date().toISOString(),
        },
      };
    } catch (e) {
      return { ok: false, error: normalizeError(e, this.name) };
    }
  }
}

// ── WhatsApp Cloud API provider (Meta Graph) ─────────────

export interface WhatsAppOutreachProvider {
  name: string;
  isConfigured(): Promise<boolean>;
  send(input: OutreachInput): Promise<ProviderResult<OutreachResult>>;
}

export class WhatsAppCloudProvider implements WhatsAppOutreachProvider {
  name = "WhatsAppCloud";

  async isConfigured(): Promise<boolean> {
    return Boolean(process.env.WHATSAPP_TOKEN && !process.env.WHATSAPP_TOKEN.includes("your")) &&
           Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID);
  }

  async send(input: OutreachInput): Promise<ProviderResult<OutreachResult>> {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token) {
      return { ok: false, error: makeError("AUTH_FAILURE", "WHATSAPP_TOKEN not set", { provider: this.name }) };
    }
    if (!phoneNumberId) {
      return { ok: false, error: makeError("INVALID_INPUT", "WHATSAPP_PHONE_NUMBER_ID not set", { provider: this.name }) };
    }
    if (!input.to || !/^\+?\d{8,15}$/.test(input.to.replace(/[\s()-]/g, ""))) {
      return { ok: false, error: makeError("INVALID_INPUT", `invalid phone number: ${input.to}`, { provider: this.name }) };
    }

    try {
      const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.to.replace(/[\s()+-]/g, ""),
          type: "text",
          text: {
            body: input.body,
            preview_url: false,
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return { ok: false, error: normalizeError({ status: res.status, statusText: errText }, this.name) };
      }

      const data = await res.json() as any;
      const messageId = data?.messages?.[0]?.id;
      return {
        ok: true,
        data: {
          channel: "whatsapp",
          to: input.to,
          message_id: messageId,
          status: "queued",
          accepted_at: new Date().toISOString(),
          raw_response: data,
        },
      };
    } catch (e) {
      return { ok: false, error: normalizeError(e, this.name) };
    }
  }
}

// ── Mock outreach provider (for tests / dry runs) ────────

export class MockOutreachProvider implements EmailOutreachProvider, WhatsAppOutreachProvider {
  name = "MockOutreach";

  async isConfigured(): Promise<boolean> { return true; }

  async send(input: OutreachInput): Promise<ProviderResult<OutreachResult>> {
    return {
      ok: true,
      data: {
        channel: input.to.includes("@") ? "email" : "whatsapp",
        to: input.to,
        message_id: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        status: "queued",
        accepted_at: new Date().toISOString(),
      },
    };
  }
}
