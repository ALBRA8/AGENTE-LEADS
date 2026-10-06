// ============================================================
// tests/security.test.ts — PRODUCTION CLOSURE §28 + §17 enforcement
// Security: SSRF vectors, unauthorized tools, invalid inputs.
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, cleanupTestEnv } from "./setup.js";
import { assertPublicUrl } from "../src/agent/core/ssrf_guard.js";
import { executeToolByName, getAllTools, getToolContract } from "../src/agent/registry.js";
import { recordToolAudit, getToolAudit } from "../src/agent/storage/agent_infra.js";

// ── §28 SSRF ────────────────────────────────────────────────

test("security/SSRF: localhost, loopback and metadata endpoints are rejected", () => {
  const vectors = [
    "http://localhost:3000/admin",
    "http://127.0.0.1/",
    "http://127.0.0.1:5432/db",
    "http://169.254.169.254/latest/meta-data/",   // AWS/GCP metadata
    "http://10.0.0.1/internal",
    "http://10.1.2.3/",
    "http://172.16.0.5/",
    "http://172.31.255.255/",
    "http://192.168.1.1/router",
    "http://192.168.0.100/",
    "http://0.0.0.0/",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "gopher://evil",
  ];
  for (const v of vectors) {
    const r = assertPublicUrl(v);
    assert.equal(r.ok, false, `SSRF vector must be rejected: ${v}`);
  }
});

test("security/SSRF: IPv6 loopback, ULA and link-local are rejected", () => {
  const vectors = ["http://[::1]/", "http://[fc00::1]/", "http://[fd12::1]/", "http://[fe80::1]/"];
  for (const v of vectors) {
    assert.equal(assertPublicUrl(v).ok, false, `must reject ${v}`);
  }
});

test("security/SSRF: legitimate public URLs pass", () => {
  const okUrls = [
    "https://veganheaven.com.co/menu",
    "http://public-api.example.com/data",
    "https://8.8.8.8/", // public IP (not in any private range)
  ];
  for (const u of okUrls) {
    assert.equal(assertPublicUrl(u).ok, true, `must allow ${u}`);
  }
});

// ── §17 unauthorized / unknown tools ───────────────────────

test("security: unknown tool is rejected with explicit message (no silent failure)", async () => {
  setupTestEnv();
  try {
    const r = await executeToolByName("delete_all_leads", {});
    assert.ok(r.includes("Herramienta desconocida"));
    assert.ok(r.includes("run_lead_pipeline")); // lists available tools
  } finally {
    cleanupTestEnv();
  }
});

test("security: every registered tool has a §17 contract with permissions", () => {
  const tools = getAllTools();
  assert.ok(tools.length >= 8);
  for (const t of tools) {
    const name = t.definition.function.name;
    const c = getToolContract(name);
    assert.ok(c, `tool ${name} lacks a contract`);
    assert.ok(c!.permissions.length > 0, `tool ${name} lacks permissions`);
    assert.ok(c!.timeout_ms > 0, `tool ${name} lacks timeout`);
    assert.ok(["low", "medium", "high"].includes(c!.risk));
  }
  // SENSITIVE classification: only outreach
  const sensitive = tools.filter((t) => getToolContract(t.definition.function.name)!.permissions.includes("SENSITIVE"));
  assert.equal(sensitive.length, 1);
  assert.equal(sensitive[0].definition.function.name, "run_outreach");
});

test("security: SSRF guard blocks EXTERNAL tool with private URL arg (scrape_stealth)", async () => {
  setupTestEnv();
  try {
    const result = await executeToolByName("scrape_stealth", { url: "http://169.254.169.254/latest/meta-data/" });
    assert.ok(result.includes("SSRF guard rejected"), `got: ${result}`);
    // and it was audited
    const audit = getToolAudit(10);
    const entry = audit.find((a) => a.tool_name === "scrape_stealth");
    assert.ok(entry, "SSRF rejection must be audited");
  } finally {
    cleanupTestEnv();
  }
});

test("security: invalid input to run_outreach (missing offer) returns explicit error", async () => {
  setupTestEnv();
  try {
    const r = await executeToolByName("run_outreach", {});
    assert.ok(r.includes("offer_description"), `got: ${r}`);
  } finally {
    cleanupTestEnv();
  }
});

test("security: tool audit trail records invocations with duration", async () => {
  setupTestEnv();
  try {
    recordToolAudit({ tool_name: "unit_test_tool", status: "ok", duration_ms: 12 });
    const audit = getToolAudit(5);
    const entry = audit.find((a) => a.tool_name === "unit_test_tool");
    assert.ok(entry);
    assert.equal(entry.status, "ok");
  } finally {
    cleanupTestEnv();
  }
});
