// ============================================================
// src/agent/providers/email_verifier_provider.ts
// P0.2 — VerificationProvider backed by rapid-email-verifier.fly.dev.
//
// Refactor of `src/agent/tools/verify_email.ts`:
//   - Same HTTP target (`/api/validate?email=…`)
//   - Returns normalized `EmailVerificationResult`
//   - Additionally exposes `verifyDomain` and `verifyUrl` (lightweight
//     HEAD-based checks) so the validation layer doesn't need a second
//     provider for domain/URL reachability.
//
// All errors flow through `normalizeError()` / `makeError()` — this
// provider never throws to the caller.
// ============================================================

import type {
  VerificationProvider,
  EmailVerificationResult,
  DomainVerificationResult,
  UrlVerificationResult,
  ProviderResult,
} from "./types.js";
import { normalizeError } from "../core/errors.js";

const VERIFIER_BASE = "https://rapid-email-verifier.fly.dev/api/validate";

export class RapidEmailVerificationProvider implements VerificationProvider {
  name = "RapidEmailVerifier";

  async isConfigured(): Promise<boolean> {
    // Fly.io public service — always reachable from a sandbox with egress.
    return true;
  }

  async verifyEmail(
    email: string
  ): Promise<ProviderResult<EmailVerificationResult>> {
    try {
      const res = await fetch(
        `${VERIFIER_BASE}?email=${encodeURIComponent(email)}`,
        { headers: { accept: "application/json" } }
      );
      if (!res.ok) {
        return {
          ok: false,
          error: normalizeError(
            { status: res.status, statusText: res.statusText },
            this.name
          ),
        };
      }
      const data = (await res.json()) as {
        valid?: boolean;
        is_valid?: boolean;
        deliverable?: boolean;
        reason?: string;
        status?: string;
        mx_record?: boolean;
        smtp_check?: boolean;
      };
      return {
        ok: true,
        data: {
          email,
          valid: Boolean(data.valid ?? data.is_valid ?? data.deliverable),
          reason: data.reason ?? data.status ?? undefined,
          mx_record: data.mx_record,
          smtp_check: data.smtp_check,
        },
      };
    } catch (err) {
      return { ok: false, error: normalizeError(err, this.name) };
    }
  }

  async verifyDomain(
    domain: string
  ): Promise<ProviderResult<DomainVerificationResult>> {
    // Lightweight domain verification: HEAD request over HTTPS.
    // If the host doesn't resolve or refuses the connection, `fetch`
    // throws and we normalize to PROVIDER_UNAVAILABLE / TEMPORARY_FAILURE.
    try {
      const res = await fetch(`https://${domain}`, {
        method: "HEAD",
        redirect: "follow",
      });
      return {
        ok: true,
        data: {
          domain,
          resolves: res.ok,
          http_status: res.status,
          https_enabled: true,
        },
      };
    } catch (err) {
      return { ok: false, error: normalizeError(err, this.name) };
    }
  }

  async verifyUrl(
    url: string
  ): Promise<ProviderResult<UrlVerificationResult>> {
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "follow" });
      return {
        ok: true,
        data: {
          url,
          reachable: res.ok,
          http_status: res.status,
          final_url: res.url,
        },
      };
    } catch (err) {
      return { ok: false, error: normalizeError(err, this.name) };
    }
  }
}
