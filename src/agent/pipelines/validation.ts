// ============================================================
// src/agent/pipelines/validation.ts
// P0.5 — Validation pipeline.
//
// Goal: validate the data found in Research against external sources
// (SMTP check, DNS resolution, HTTP reachability).
//
// IMPORTANT: keep "dato encontrado" separate from "dato validado".
//   - Research FOUND an email
//   - Validation may or may not confirm it
//   - The Lead keeps BOTH: the evidence (FOUND) AND the validation state.
//
// Output: Lead with .validation populated and research_state = "VALIDATED".
// ============================================================

import type { VerificationProvider } from "../providers/types.js";
import type { Lead, ValidationState, ValidationResult } from "../core/lead.js";
import { found } from "../core/evidence.js";
import type { ExecutionRecorder } from "../core/execution.js";

export interface ValidationInput {
  lead: Lead;
  /** Which fields to validate (default: email + website) */
  validate?: Array<"email" | "domain" | "url">;
}

export interface ValidationOutput {
  lead: Lead;
}

const DEFAULT_VALIDATE = ["email", "domain"] as const;

export async function runValidation(
  verificationProvider: VerificationProvider | null,
  input: ValidationInput,
  trace?: ExecutionRecorder
): Promise<ValidationOutput> {
  const lead = input.lead;
  const validate = input.validate ?? Array.from(DEFAULT_VALIDATE);
  const validation: ValidationState = {};

  // ── Cross-source consistency check (system check — runs regardless of provider) ──
  if (lead.email && lead.website) {
    const emailDomain = (lead.email.split("@")[1] ?? "").toLowerCase();
    const websiteDomain = lead.website.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
    const consistent = emailDomain === websiteDomain || websiteDomain.includes(emailDomain) || emailDomain.includes(websiteDomain.split(".")[0]);
    validation.identity = {
      status: consistent ? "valid" : "conflict",
      confidence: "low",
      checked_at: new Date().toISOString(),
      source: "system-consistency",
      notes: `email domain (${emailDomain}) vs website domain (${websiteDomain})`,
    };
  }

  if (!verificationProvider || !(await verificationProvider.isConfigured().catch(() => false))) {
    trace?.skip("validation.none", "verification provider not configured");
    // Mark everything as "unknown" with confidence=none (but identity check above still runs)
    if (lead.email && validate.includes("email")) {
      validation.email = {
        status: "unknown",
        confidence: "none",
        checked_at: new Date().toISOString(),
        source: "none",
        notes: "verification provider not configured",
      };
    }
    if (lead.website && validate.includes("domain")) {
      validation.domain = {
        status: "unknown",
        confidence: "none",
        checked_at: new Date().toISOString(),
        source: "none",
        notes: "verification provider not configured",
      };
    }
    lead.validation = validation;
    lead.research_state = "VALIDATED";
    return { lead };
  }

  // EMAIL validation
  if (lead.email && validate.includes("email")) {
    const end = trace?.start(`validation.email.${verificationProvider.name}`, {
      provider: verificationProvider.name,
      intent: `validate email: ${lead.email}`,
      input: { email: lead.email },
    });
    const result = await verificationProvider.verifyEmail(lead.email);
    if (result.ok && result.data) {
      validation.email = {
        status: result.data.valid ? "valid" : "invalid",
        confidence: result.data.smtp_check ? "high" : "medium",
        checked_at: new Date().toISOString(),
        source: verificationProvider.name,
        notes: result.data.reason,
      };
      end?.({ output: `email ${result.data.valid ? "valid" : "invalid"}` });
      lead.evidence.push(found(
        "email_validation",
        String(result.data.valid),
        verificationProvider.name,
        `Verified via ${verificationProvider.name}: ${result.data.reason ?? "no reason"}`
      ));
    } else if (result.error) {
      validation.email = {
        status: "unknown",
        confidence: "none",
        checked_at: new Date().toISOString(),
        source: verificationProvider.name,
        notes: result.error.message,
      };
      end?.({ error: result.error });
    }
  }

  // DOMAIN validation (only if website is set)
  if (lead.website && validate.includes("domain")) {
    const end = trace?.start(`validation.domain.${verificationProvider.name}`, {
      provider: verificationProvider.name,
      intent: `validate domain: ${lead.website}`,
      input: { website: lead.website },
    });
    const domainResult = await verificationProvider.verifyDomain(lead.website);
    if (domainResult.ok && domainResult.data) {
      validation.domain = {
        status: domainResult.data.resolves ? "valid" : "invalid",
        confidence: "medium",
        checked_at: new Date().toISOString(),
        source: verificationProvider.name,
        notes: `HTTP ${domainResult.data.http_status ?? "?"}, HTTPS: ${domainResult.data.https_enabled}`,
      };
      end?.({ output: `domain ${domainResult.data.resolves ? "valid" : "invalid"}` });
    } else if (domainResult.error) {
      validation.domain = {
        status: "unknown",
        confidence: "none",
        checked_at: new Date().toISOString(),
        source: verificationProvider.name,
        notes: domainResult.error.message,
      };
      end?.({ error: domainResult.error });
    }
  }

  // URL validation
  if (lead.url && validate.includes("url")) {
    const end = trace?.start(`validation.url.${verificationProvider.name}`, {
      provider: verificationProvider.name,
      intent: `validate url: ${lead.url}`,
      input: { url: lead.url },
    });
    const urlResult = await verificationProvider.verifyUrl(lead.url);
    if (urlResult.ok && urlResult.data) {
      validation.url = {
        status: urlResult.data.reachable ? "valid" : "invalid",
        confidence: "medium",
        checked_at: new Date().toISOString(),
        source: verificationProvider.name,
        notes: `HTTP ${urlResult.data.http_status ?? "?"}`,
      };
      end?.({ output: `url ${urlResult.data.reachable ? "valid" : "invalid"}` });
    } else if (urlResult.error) {
      validation.url = {
        status: "unknown",
        confidence: "none",
        checked_at: new Date().toISOString(),
        source: verificationProvider.name,
        notes: urlResult.error.message,
      };
      end?.({ error: urlResult.error });
    }
  }

  lead.validation = validation;
  lead.research_state = "VALIDATED";
  return { lead };
}
