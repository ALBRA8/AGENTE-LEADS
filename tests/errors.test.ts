// ============================================================
// tests/errors.test.ts — P0.10 Error taxonomy
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeError,
  normalizeError,
  shouldRetry,
  backoffDelayMs,
  type ErrorType,
  type ProviderError,
} from "../src/agent/core/errors.js";

test("makeError: creates ProviderError with retryable flag", () => {
  const e = makeError("AUTH_FAILURE", "no token", { provider: "Apify" });
  assert.equal(e.type, "AUTH_FAILURE");
  assert.equal(e.message, "no token");
  assert.equal(e.provider, "Apify");
  assert.equal(e.retryable, false); // AUTH_FAILURE not retryable
});

test("makeError: RATE_LIMIT is retryable", () => {
  const e = makeError("RATE_LIMIT", "too many requests", { provider: "Apify" });
  assert.equal(e.retryable, true);
});

test("makeError: TEMPORARY_FAILURE is retryable", () => {
  const e = makeError("TEMPORARY_FAILURE", "network glitch");
  assert.equal(e.retryable, true);
});

test("makeError: EMPTY_RESULT is NOT retryable", () => {
  const e = makeError("EMPTY_RESULT", "no results found");
  assert.equal(e.retryable, false);
});

test("makeError: INVALID_INPUT is NOT retryable", () => {
  const e = makeError("INVALID_INPUT", "bad query");
  assert.equal(e.retryable, false);
});

test("makeError: TIMEOUT is retryable", () => {
  const e = makeError("TIMEOUT", "request timed out");
  assert.equal(e.retryable, true);
});

test("makeError: PROVIDER_UNAVAILABLE is retryable", () => {
  const e = makeError("PROVIDER_UNAVAILABLE", "venv missing");
  assert.equal(e.retryable, true);
});

test("normalizeError: HTTP 401 -> AUTH_FAILURE", () => {
  const err = normalizeError({ status: 401, statusText: "Unauthorized" }, "Apify");
  assert.equal(err.type, "AUTH_FAILURE");
  assert.equal(err.provider, "Apify");
  assert.equal(err.retryable, false);
});

test("normalizeError: HTTP 429 -> RATE_LIMIT", () => {
  const err = normalizeError({ status: 429, statusText: "Too Many Requests" });
  assert.equal(err.type, "RATE_LIMIT");
  assert.equal(err.retryable, true);
});

test("normalizeError: HTTP 5xx -> PROVIDER_UNAVAILABLE", () => {
  const err = normalizeError({ status: 503, statusText: "Service Unavailable" });
  assert.equal(err.type, "PROVIDER_UNAVAILABLE");
  assert.equal(err.retryable, true);
});

test("normalizeError: HTTP 4xx (not 401/429) -> INVALID_INPUT", () => {
  const err = normalizeError({ status: 422, statusText: "Unprocessable" });
  assert.equal(err.type, "INVALID_INPUT");
  assert.equal(err.retryable, false);
});

test("normalizeError: timeout keyword in message -> TIMEOUT", () => {
  const err = normalizeError(new Error("request timeout"));
  assert.equal(err.type, "TIMEOUT");
  assert.equal(err.retryable, true);
});

test("normalizeError: rate limit keyword -> RATE_LIMIT", () => {
  const err = normalizeError(new Error("rate limit exceeded"));
  assert.equal(err.type, "RATE_LIMIT");
});

test("normalizeError: 'api key' in message -> AUTH_FAILURE", () => {
  const err = normalizeError(new Error("invalid api key"));
  assert.equal(err.type, "AUTH_FAILURE");
});

test("normalizeError: passes through existing ProviderError", () => {
  const original = makeError("TIMEOUT", "timed out", { provider: "Apify" });
  const normalized = normalizeError(original, "OtherProvider");
  assert.equal(normalized.type, "TIMEOUT");
  // Provider name should stay original since original already had provider set
  assert.equal(normalized.provider, "Apify");
});

test("shouldRetry: respects retryable flag + attempt count", () => {
  const err = makeError("TIMEOUT", "timed out");
  assert.equal(shouldRetry(err, 1, 3), true);
  assert.equal(shouldRetry(err, 3, 3), false); // exceeded max
  const noRetry = makeError("INVALID_INPUT", "bad input");
  assert.equal(shouldRetry(noRetry, 1, 3), false);
});

test("backoffDelayMs: exponential backoff capped at 30s", () => {
  assert.equal(backoffDelayMs(1, 1000, 2), 1000);
  assert.equal(backoffDelayMs(2, 1000, 2), 2000);
  assert.equal(backoffDelayMs(3, 1000, 2), 4000);
  assert.equal(backoffDelayMs(10, 1000, 2), 30000); // capped
});
