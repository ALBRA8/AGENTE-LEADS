// ============================================================
// src/agent/core/errors.ts
// P0.10 — Normalized error taxonomy for providers and pipelines.
// All provider failures are normalized to ProviderError so the
// orchestrator never sees provider-specific exceptions.
// ============================================================

export type ErrorType =
  | "OK"
  | "TEMPORARY_FAILURE"
  | "AUTH_FAILURE"
  | "RATE_LIMIT"
  | "EMPTY_RESULT"
  | "INVALID_INPUT"
  | "TIMEOUT"
  | "PROVIDER_UNAVAILABLE";

export interface ProviderError {
  type: ErrorType;
  message: string;
  provider?: string;
  retryable: boolean;
  cause?: unknown;
}

const RETRYABLE_TYPES: ReadonlySet<ErrorType> = new Set([
  "TEMPORARY_FAILURE",
  "TIMEOUT",
  "RATE_LIMIT",
  "PROVIDER_UNAVAILABLE",
]);

export function makeError(
  type: ErrorType,
  message: string,
  opts: { provider?: string; cause?: unknown } = {}
): ProviderError {
  return {
    type,
    message,
    provider: opts.provider,
    retryable: RETRYABLE_TYPES.has(type),
    cause: opts.cause,
  };
}

/**
 * Normalize any thrown value into a ProviderError.
 * - HTTP 401/403 -> AUTH_FAILURE
 * - HTTP 429      -> RATE_LIMIT
 * - HTTP 408/504/network timeout -> TIMEOUT
 * - HTTP 5xx      -> TEMPORARY_FAILURE (retryable) or PROVIDER_UNAVAILABLE
 * - HTTP 400/422  -> INVALID_INPUT
 * - empty array result -> EMPTY_RESULT
 * - missing credentials -> AUTH_FAILURE
 * - unknown python binary / missing dependency -> PROVIDER_UNAVAILABLE
 * - everything else -> TEMPORARY_FAILURE (default safe fallback)
 */
export function normalizeError(
  err: unknown,
  providerName?: string
): ProviderError {
  // Already a ProviderError
  if (typeof err === "object" && err !== null && "type" in err && "retryable" in err) {
    const pe = err as ProviderError;
    return { ...pe, provider: pe.provider ?? providerName };
  }

  // Fetch Response object
  if (typeof err === "object" && err !== null && "status" in err && typeof (err as any).status === "number") {
    const status = (err as any).status as number;
    const text = (err as any).statusText ?? `HTTP ${status}`;
    if (status === 401 || status === 403) {
      return makeError("AUTH_FAILURE", `Authentication failed: ${status} ${text}`, { provider: providerName, cause: err });
    }
    if (status === 429) {
      return makeError("RATE_LIMIT", `Rate limited by provider: ${status}`, { provider: providerName, cause: err });
    }
    if (status === 408 || status === 504) {
      return makeError("TIMEOUT", `Request timed out: ${status}`, { provider: providerName, cause: err });
    }
    if (status >= 500) {
      return makeError("PROVIDER_UNAVAILABLE", `Provider unavailable: ${status} ${text}`, { provider: providerName, cause: err });
    }
    if (status >= 400 && status < 500) {
      return makeError("INVALID_INPUT", `Invalid request to provider: ${status} ${text}`, { provider: providerName, cause: err });
    }
    return makeError("TEMPORARY_FAILURE", `HTTP ${status} ${text}`, { provider: providerName, cause: err });
  }

  // Native Error or string
  const msg = err instanceof Error ? err.message : String(err);

  // Heuristics on message
  const lower = msg.toLowerCase();
  if (lower.includes("timeout") || lower.includes("etimedout") || lower.includes("aborted")) {
    return makeError("TIMEOUT", msg, { provider: providerName, cause: err });
  }
  if (lower.includes("econnreset") || lower.includes("econnrefused") || lower.includes("enotfound")) {
    return makeError("PROVIDER_UNAVAILABLE", msg, { provider: providerName, cause: err });
  }
  if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("429")) {
    return makeError("RATE_LIMIT", msg, { provider: providerName, cause: err });
  }
  if (lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("api key") || lower.includes("token")) {
    return makeError("AUTH_FAILURE", msg, { provider: providerName, cause: err });
  }
  if (lower.includes("not found") && lower.includes("python")) {
    return makeError("PROVIDER_UNAVAILABLE", msg, { provider: providerName, cause: err });
  }
  if (lower.includes("empty") || lower.includes("no results") || lower.includes("no leads")) {
    return makeError("EMPTY_RESULT", msg, { provider: providerName, cause: err });
  }

  return makeError("TEMPORARY_FAILURE", msg, { provider: providerName, cause: err });
}

/**
 * Retry policy per ErrorType — referenced by orchestrator / pipelines.
 * P0.10: TEMPORARY_FAILURE -> retry; TIMEOUT -> retry limited; RATE_LIMIT -> backoff;
 *        AUTH_FAILURE -> stop provider; INVALID_INPUT -> no retry;
 *        EMPTY_RESULT -> alternative strategy; PROVIDER_UNAVAILABLE -> fallback.
 */
export function shouldRetry(err: ProviderError, attempt: number, maxAttempts: number): boolean {
  if (!err.retryable) return false;
  if (attempt >= maxAttempts) return false;
  return true;
}

export function backoffDelayMs(attempt: number, baseMs = 1000, factor = 2): number {
  return Math.min(baseMs * Math.pow(factor, attempt - 1), 30_000);
}
