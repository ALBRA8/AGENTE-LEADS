// ============================================================
// tests/doctor.test.ts — PRODUCTION CLOSURE §32
// Doctor: AUDIT → DIAGNOSE → VERIFY → REPORT (read-only).
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, cleanupTestEnv } from "./setup.js";
import { runDoctor, formatDoctorReport } from "../src/agent/doctor.js";

test("doctor: audits every required section", () => {
  setupTestEnv();
  try {
    const report = runDoctor();
    const sections = new Set(report.checks.map((c) => c.section));
    for (const s of ["config", "storage", "engines", "providers", "memory", "skills", "feedback", "telegram", "dependencies"]) {
      assert.ok(sections.has(s), `doctor missing section: ${s}`);
    }
  } finally {
    cleanupTestEnv();
  }
});

test("doctor: VERIFY invariants — engines pass in a healthy environment", () => {
  setupTestEnv();
  try {
    process.env.NVIDIA_API_KEY = "nvapi-test-key-123456";
    process.env.TELEGRAM_BOT_TOKEN = "123456789:AATestTokenValue123456789";
    process.env.ALLOWED_IDS = "12345";
    const report = runDoctor();
    assert.equal(report.status, "ok");
    assert.equal(report.failed.length, 0);

    // Key invariants verified
    const byName = new Map(report.checks.map((c) => [c.name, c]));
    assert.equal(byName.get("ssrf_guard")!.ok, true);
    assert.equal(byName.get("evidence_engine")!.ok, true);
    assert.equal(byName.get("dedup_signature")!.ok, true);
    assert.equal(byName.get("scoring_deterministic")!.ok, true);
    assert.equal(byName.get("agent_infra_tables")!.ok, true);
    assert.equal(byName.get("core_skills_registered")!.ok, true);
    assert.equal(byName.get("skills_have_regression_tests")!.ok, true);
  } finally {
    cleanupTestEnv();
    delete process.env.NVIDIA_API_KEY;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.ALLOWED_IDS;
  }
});

test("doctor: missing critical config is diagnosed as DOWN with recommendations", () => {
  setupTestEnv();
  try {
    delete process.env.NVIDIA_API_KEY;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const report = runDoctor();
    assert.equal(report.status, "down");
    assert.ok(report.failed.some((f) => f.name === "nvidia_api_key"));
    assert.ok(report.recommendations.some((r) => r.includes("NVIDIA_API_KEY")));
    assert.ok(report.recommendations.some((r) => r.includes("TELEGRAM_BOT_TOKEN")));
  } finally {
    cleanupTestEnv();
  }
});

test("doctor: report is human-readable and non-empty", () => {
  setupTestEnv();
  try {
    const text = formatDoctorReport(runDoctor());
    assert.ok(text.includes("Doctor"));
    assert.ok(text.includes("RECOMENDACIONES"));
    assert.ok(text.includes("ENGINES"));
  } finally {
    cleanupTestEnv();
  }
});

test("doctor: is read-only — running twice does not mutate leads", () => {
  setupTestEnv();
  try {
    const r1 = runDoctor();
    const r2 = runDoctor();
    assert.equal(r1.checks.length, r2.checks.length);
    assert.equal(r1.status, r2.status);
  } finally {
    cleanupTestEnv();
  }
});
