// ============================================================
// tests/tool_contract.test.ts — PRODUCTION CLOSURE §17
// Contract enforcement: timeout, audit, SSRF, permission classes.
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, cleanupTestEnv } from "./setup.js";
import { enforceContract, type ToolContract } from "../src/agent/core/tool_contract.js";
import { getToolAudit } from "../src/agent/storage/agent_infra.js";

function baseContract(overrides?: Partial<ToolContract>): ToolContract {
  return {
    id: "tool.test",
    name: "test_tool",
    purpose: "testing",
    input_schema: {},
    output_schema: {},
    permissions: ["READ"],
    risk: "low",
    side_effects: [],
    timeout_ms: 5_000,
    retry_policy: { max_attempts: 1, backoff: "none" },
    evidence_behavior: "none",
    audit_behavior: "tool_audit",
    ...overrides,
  };
}

test("contract: successful execution is audited with duration", async () => {
  setupTestEnv();
  try {
    const exec = enforceContract(baseContract(), async () => "done");
    const r = await exec({});
    assert.equal(r, "done");
    const audit = getToolAudit(5);
    const entry = audit.find((a) => a.tool_name === "test_tool");
    assert.ok(entry);
    assert.equal(entry.status, "ok");
    assert.ok(entry.duration_ms >= 0);
  } finally {
    cleanupTestEnv();
  }
});

test("contract: hung tool is cut by the hard timeout and returns normalized error", async () => {
  setupTestEnv();
  try {
    const exec = enforceContract(
      baseContract({ name: "slow_tool", timeout_ms: 150 }),
      () => new Promise<string>(() => {}) // never resolves
    );
    const r = await exec({});
    assert.ok(r.includes("TIMEOUT"), `got: ${r}`);
    assert.ok(r.includes("slow_tool"));
    const audit = getToolAudit(5);
    const entry = audit.find((a) => a.tool_name === "slow_tool");
    assert.ok(entry, "slow_tool audit entry missing");
    assert.equal(entry.status, "timeout");
    assert.equal(entry.error_type, "TIMEOUT");
  } finally {
    cleanupTestEnv();
  }
});

test("contract: thrown error is normalized and audited, not propagated", async () => {
  setupTestEnv();
  try {
    const exec = enforceContract(
      baseContract({ name: "boom_tool" }),
      async () => { throw new Error("kaboom: something failed"); }
    );
    const r = await exec({});
    assert.ok(r.includes("Error"), `got: ${r}`);
    const audit = getToolAudit(5);
    const entry = audit.find((a) => a.tool_name === "boom_tool");
    assert.ok(entry);
    assert.equal(entry.status, "failed");
  } finally {
    cleanupTestEnv();
  }
});

test("contract: EXTERNAL tool with url_args runs the SSRF guard before execution", async () => {
  setupTestEnv();
  try {
    let executed = false;
    const exec = enforceContract(
      baseContract({
        name: "external_tool",
        permissions: ["READ", "EXTERNAL"],
        url_args: ["url"],
      }),
      async () => { executed = true; return "fetched"; }
    );
    const r = await exec({ url: "http://10.0.0.42/secret" });
    assert.equal(executed, false, "raw executor must NOT run for blocked URLs");
    assert.ok(r.includes("SSRF guard rejected"));
  } finally {
    cleanupTestEnv();
  }
});
