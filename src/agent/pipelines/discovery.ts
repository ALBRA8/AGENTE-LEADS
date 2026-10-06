// ============================================================
// src/agent/pipelines/discovery.ts
// P0.3 — Discovery pipeline.
//
// Goal: find candidates that might be relevant, with provenance.
//
// Input:  a parsed request (query, location, niche, platform, min_followers)
// Output: CandidateLead[] (normalized, with source attribution)
//
// The pipeline tries the configured DiscoveryProvider(s) in order of preference.
// If the primary provider returns AUTH_FAILURE / PROVIDER_UNAVAILABLE,
// it falls back to the next available provider.
// It NEVER passes raw provider responses to the LLM.
// ============================================================

import type { DiscoveryProvider } from "../providers/types.js";
import type { CandidateLead } from "../core/lead.js";
import type { ProviderError } from "../core/errors.js";
import { makeError, shouldRetry, backoffDelayMs } from "../core/errors.js";
import type { ExecutionRecorder } from "../core/execution.js";

export interface DiscoveryInput {
  query: string;
  location?: string;
  niche?: string;
  platform?: string;
  min_followers?: number;
}

export interface DiscoveryOutput {
  candidates: CandidateLead[];
  /** The provider that actually produced the results */
  used_provider: string;
  /** Providers that failed and why (for the trace) */
  failed_providers: { name: string; error: ProviderError }[];
}

const MAX_ATTEMPTS = 2;

/**
 * Run discovery with provider fallback.
 *
 * Behavior per P0.10:
 *   AUTH_FAILURE → skip this provider, try next
 *   PROVIDER_UNAVAILABLE → skip, try next
 *   RATE_LIMIT → backoff and retry (max 2 attempts)
 *   TEMPORARY_FAILURE / TIMEOUT → retry (max 2 attempts)
 *   EMPTY_RESULT → no retry, no fallback (legitimate empty)
 *   INVALID_INPUT → no retry, no fallback
 */
export async function runDiscovery(
  providers: DiscoveryProvider[],
  input: DiscoveryInput,
  trace?: ExecutionRecorder
): Promise<DiscoveryOutput> {
  const failed: { name: string; error: ProviderError }[] = [];

  for (const provider of providers) {
    const configured = await provider.isConfigured().catch(() => false);
    if (!configured) {
      trace?.skip(`discovery.${provider.name}`, "provider not configured", { provider: provider.name });
      // FIX (QUAL-C2): use makeError for consistent error shape (retryable flag from taxonomy)
      failed.push({
        name: provider.name,
        error: makeError("PROVIDER_UNAVAILABLE", "not configured", { provider: provider.name }),
      });
      continue;
    }

    let attempt = 0;
    let lastError: ProviderError | undefined;
    while (attempt < MAX_ATTEMPTS) {
      attempt++;
      const end = trace?.start(`discovery.${provider.name}`, {
        provider: provider.name,
        intent: `discover "${input.query}" in ${input.location ?? "any"}`,
        input: { query: input.query, attempt },
      });

      const result = await provider.discover(input).catch((e: unknown) => ({
        ok: false as const,
        error: e as any,
      }));

      if (result.ok && result.data) {
        end?.({ output: `${result.data.length} candidates` });
        return {
          candidates: result.data,
          used_provider: provider.name,
          failed_providers: failed,
        };
      }

      const err = result.error ?? (result as any).error;
      if (!err) {
        end?.({ error: new Error("provider returned no data and no error") });
        lastError = { type: "TEMPORARY_FAILURE", message: "no data, no error", retryable: true };
        continue;
      }

      end?.({ error: err });
      lastError = err;

      if (!shouldRetry(err, attempt, MAX_ATTEMPTS)) {
        failed.push({ name: provider.name, error: err });
        break; // try next provider
      }

      // Rate-limit / temp failure → backoff and retry
      if (err.type === "RATE_LIMIT" || err.type === "TEMPORARY_FAILURE" || err.type === "TIMEOUT") {
        await new Promise((r) => setTimeout(r, backoffDelayMs(attempt)));
        continue;
      }

      failed.push({ name: provider.name, error: err });
      break; // try next provider
    }

    if (lastError && !failed.some((f) => f.name === provider.name)) {
      failed.push({ name: provider.name, error: lastError });
    }
  }

  // All providers failed — return empty result, NOT an error
  // (the caller decides if empty is acceptable or needs alternative strategy)
  return {
    candidates: [],
    used_provider: "none",
    failed_providers: failed,
  };
}
