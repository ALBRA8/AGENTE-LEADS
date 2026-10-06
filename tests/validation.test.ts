// ============================================================
// tests/validation.test.ts — P0.5 Validation pipeline
//
// Tests that:
//   - validation keeps "dato encontrado" separate from "dato validado"
//   - validation produces confidence levels (high/medium/low/none)
//   - unverified data is marked "unknown" (not "invalid")
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { runValidation } from "../src/agent/pipelines/validation.js";
import { ExecutionRecorder } from "../src/agent/core/execution.js";
import type { Lead } from "../src/agent/core/lead.js";
import type { VerificationProvider, ProviderResult } from "../src/agent/providers/types.js";
import { notFound, found } from "../src/agent/core/evidence.js";

function makeLead(overrides?: Partial<Lead>): Lead {
  return {
    name: "Vegan Heaven",
    email: "hello@veganheaven.com",
    website: "veganheaven.com.co",
    sources: ["MockDiscovery"],
    discovered_at: new Date().toISOString(),
    evidence: [
      found("email", "hello@veganheaven.com", "GoogleSearch", "found in bio"),
      found("website", "veganheaven.com.co", "GoogleSearch", "found in bio"),
      notFound("phone", "GoogleSearch"),
    ],
    validation: {},
    research_state: "RESEARCHED",
    ...overrides,
  };
}

test("runValidation: marks lead as VALIDATED", async () => {
  const result = await runValidation(null, { lead: makeLead() });
  assert.equal(result.lead.research_state, "VALIDATED");
});

test("runValidation: without verification provider, marks fields as unknown (NOT invalid)", async () => {
  const result = await runValidation(null, { lead: makeLead() });
  assert.equal(result.lead.validation.email!.status, "unknown");
  assert.equal(result.lead.validation.email!.confidence, "none");
  assert.equal(result.lead.validation.email!.notes, "verification provider not configured");
});

test("runValidation: marks email as valid when verifier returns valid=true", async () => {
  const verifier: VerificationProvider = {
    name: "FakeVerifier",
    isConfigured: async () => true,
    async verifyEmail(email): Promise<ProviderResult<any>> {
      return { ok: true, data: { email, valid: true, smtp_check: true, reason: "deliverable" } };
    },
    async verifyDomain(): Promise<ProviderResult<any>> {
      return { ok: true, data: { domain: "test", resolves: true, http_status: 200, https_enabled: true } };
    },
    async verifyUrl(): Promise<ProviderResult<any>> {
      return { ok: true, data: { url: "test", reachable: true, http_status: 200 } };
    },
  };
  const result = await runValidation(verifier, { lead: makeLead() });
  assert.equal(result.lead.validation.email!.status, "valid");
  assert.equal(result.lead.validation.email!.confidence, "high");
});

test("runValidation: marks email as invalid when verifier returns valid=false", async () => {
  const verifier: VerificationProvider = {
    name: "FakeVerifier",
    isConfigured: async () => true,
    async verifyEmail(email): Promise<ProviderResult<any>> {
      return { ok: true, data: { email, valid: false, reason: "mailbox full" } };
    },
    async verifyDomain(): Promise<ProviderResult<any>> {
      return { ok: true, data: { domain: "test", resolves: false } };
    },
    async verifyUrl(): Promise<ProviderResult<any>> {
      return { ok: true, data: { url: "test", reachable: false } };
    },
  };
  const result = await runValidation(verifier, { lead: makeLead() });
  assert.equal(result.lead.validation.email!.status, "invalid");
});

test("runValidation: marks email as unknown when verifier returns error", async () => {
  const verifier: VerificationProvider = {
    name: "FakeVerifier",
    isConfigured: async () => true,
    async verifyEmail(): Promise<ProviderResult<any>> {
      return { ok: false, error: { type: "TIMEOUT", message: "timed out", retryable: true } };
    },
    async verifyDomain(): Promise<ProviderResult<any>> {
      return { ok: false, error: { type: "TIMEOUT", message: "timed out", retryable: true } };
    },
    async verifyUrl(): Promise<ProviderResult<any>> {
      return { ok: false, error: { type: "TIMEOUT", message: "timed out", retryable: true } };
    },
  };
  const result = await runValidation(verifier, { lead: makeLead() });
  assert.equal(result.lead.validation.email!.status, "unknown");
  assert.equal(result.lead.validation.email!.confidence, "none");
  assert.ok(result.lead.validation.email!.notes!.includes("timed out"));
});

test("runValidation: cross-source consistency check identifies email/website domain mismatch", async () => {
  const lead = makeLead({
    email: "contact@gmail.com",       // gmail.com
    website: "veganheaven.com.co",    // different domain
    evidence: [
      found("email", "contact@gmail.com", "Google", "found"),
      found("website", "veganheaven.com.co", "Google", "found"),
    ],
  });
  const result = await runValidation(null, { lead });
  assert.ok(result.lead.validation.identity);
  // Mismatched domains → conflict
  assert.equal(result.lead.validation.identity!.status, "conflict");
});

test("runValidation: skips email validation if lead has no email", async () => {
  const verifier: VerificationProvider = {
    name: "FakeVerifier",
    isConfigured: async () => true,
    async verifyEmail(): Promise<ProviderResult<any>> {
      return { ok: true, data: { email: "x", valid: true } };
    },
    async verifyDomain(): Promise<ProviderResult<any>> {
      return { ok: true, data: { domain: "x", resolves: true } };
    },
    async verifyUrl(): Promise<ProviderResult<any>> {
      return { ok: true, data: { url: "x", reachable: true } };
    },
  };
  const result = await runValidation(verifier, { lead: makeLead({ email: undefined, website: undefined, evidence: [] }) });
  assert.equal(result.lead.validation.email, undefined);
  assert.equal(result.lead.validation.domain, undefined);
});

test("runValidation: adds evidence record for the validation step itself", async () => {
  const verifier: VerificationProvider = {
    name: "FakeVerifier",
    isConfigured: async () => true,
    async verifyEmail(email): Promise<ProviderResult<any>> {
      return { ok: true, data: { email, valid: true, smtp_check: true, reason: "ok" } };
    },
    async verifyDomain(): Promise<ProviderResult<any>> {
      return { ok: true, data: { domain: "x", resolves: true } };
    },
    async verifyUrl(): Promise<ProviderResult<any>> {
      return { ok: true, data: { url: "x", reachable: true } };
    },
  };
  const result = await runValidation(verifier, { lead: makeLead() });
  const validationEvidence = result.lead.evidence.find((e) => e.field === "email_validation");
  assert.ok(validationEvidence);
  assert.equal(validationEvidence!.status, "FOUND");
  assert.equal(validationEvidence!.value, "true");
});
