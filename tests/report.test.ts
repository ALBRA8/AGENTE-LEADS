// ============================================================
// tests/report.test.ts — P0.12 Report engine
//
// Verifies:
//   - report is NOT raw JSON — it's human-readable Markdown
//   - each field shows whether it was observado/validado/inferido/no encontrado
//   - "no encontrado" is NEVER presented as "no tiene"
//   - top leads are sorted by quality (research_state + FOUND evidence + validated)
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateReport } from "../src/agent/pipelines/report.js";
import { found, notFound, inferred, confirmedAbsent } from "../src/agent/core/evidence.js";
import type { Lead } from "../src/agent/core/lead.js";

function makeLead(overrides?: Partial<Lead>): Lead {
  return {
    name: "Vegan Heaven",
    username: "veganheavenmed",
    platform: "instagram",
    url: "https://instagram.com/veganheavenmed",
    website: "https://veganheaven.com.co",
    email: "hello@veganheaven.com",
    phone: "+57 311 567 8901",
    location: "Medellín",
    category: "restaurant",
    niche: "vegano",
    sources: ["MockDiscovery", "GoogleSearch"],
    discovered_at: new Date().toISOString(),
    evidence: [
      found("instagram", "veganheavenmed", "MockDiscovery", "discovered"),
      found("website", "https://veganheaven.com.co", "GoogleSearch", "found in bio"),
      found("email", "hello@veganheaven.com", "GoogleSearch", "found in bio"),
      found("phone", "+57 311 567 8901", "Scraping", "found on contact page"),
      notFound("linkedin", "GoogleSearch"),
      found("location", "Medellín", "MockDiscovery", "from candidate"),
    ],
    validation: {
      email: { status: "valid", confidence: "high", checked_at: new Date().toISOString(), source: "RapidEmailVerifier", notes: "deliverable" },
    },
    research_state: "VALIDATED",
    ...overrides,
  };
}

test("report: produces Markdown text with TOP LEADS header", () => {
  const r = generateReport({ leads: [makeLead()], user_request: "vegano Medellín" });
  assert.ok(r.text.includes("TOP LEADS"));
  assert.ok(r.text.includes("AGENTE LEADS"));
});

test("report: text is NOT raw JSON — it's human-readable", () => {
  const r = generateReport({ leads: [makeLead()], user_request: "test" });
  // Should contain Markdown formatting (tables, headers)
  assert.ok(r.text.includes("| Campo | Valor |"));
  assert.ok(r.text.includes("## 1. Vegan Heaven"));
});

test("report: also produces JSON for programmatic consumption", () => {
  const r = generateReport({ leads: [makeLead()], user_request: "test" });
  const parsed = JSON.parse(r.json);
  assert.equal(parsed.user_request, "test");
  assert.ok(parsed.top.length > 0);
  assert.equal(parsed.top[0].name, "Vegan Heaven");
});

test("report: each field shows observado/validado/inferido/no encontrado status", () => {
  const r = generateReport({ leads: [makeLead()], user_request: "test" });
  // Email was FOUND → "encontrado"
  assert.ok(r.text.includes("encontrado"));
  // LinkedIn was NOT_FOUND → "no encontrado"
  assert.ok(r.text.includes("no encontrado"));
});

test("report: CRITICAL — does NOT say 'no tiene' for NOT_FOUND fields", () => {
  // This is the P0.6 rule reinforced in the report (P0.12)
  const r = generateReport({ leads: [makeLead()], user_request: "test" });
  assert.ok(!r.text.toLowerCase().includes("no tiene website"));
  assert.ok(!r.text.toLowerCase().includes("no tiene linkedin"));
  assert.ok(!r.text.toLowerCase().includes("no tiene email"));
});

test("report: includes validation section when validation state exists", () => {
  const r = generateReport({ leads: [makeLead()], user_request: "test" });
  assert.ok(r.text.includes("Validación"));
  assert.ok(r.text.includes("Email"));
  assert.ok(r.text.includes("valid"));
});

test("report: includes provenance (sources + discovered_at + research_state)", () => {
  const r = generateReport({ leads: [makeLead()], user_request: "test" });
  assert.ok(r.text.includes("Fuentes:"));
  assert.ok(r.text.includes("MockDiscovery"));
  assert.ok(r.text.includes("Descubierto:"));
  assert.ok(r.text.includes("VALIDATED"));
});

test("report: includes legend explaining the status labels", () => {
  const r = generateReport({ leads: [makeLead()], user_request: "test" });
  assert.ok(r.text.includes("Leyenda de estados"));
  assert.ok(r.text.includes("encontrado"));
  assert.ok(r.text.includes("validado"));
  assert.ok(r.text.includes("no encontrado"));
  assert.ok(r.text.includes("ausente confirmado"));
  assert.ok(r.text.includes("inferido"));
});

test("report: empty leads produces a helpful message", () => {
  const r = generateReport({ leads: [], user_request: "test" });
  assert.ok(r.text.includes("No se encontraron leads"));
  assert.ok(r.text.includes("Sugerencia"));
});

test("report: respects top_n limit", () => {
  const leads = Array.from({ length: 15 }, (_, i) => makeLead({ name: `Lead ${i}`, email: `lead${i}@test.com` }));
  const r = generateReport({ leads, user_request: "test", top_n: 5 });
  // Count "## N." headers
  const matches = r.text.match(/^## \d+\./gm);
  assert.equal(matches!.length, 5);
});

test("report: sorts leads by quality (VALIDATED > RESEARCHED > DISCOVERED)", () => {
  const leads = [
    makeLead({ name: "Discovered", research_state: "DISCOVERED" }),
    makeLead({ name: "Validated", research_state: "VALIDATED", email: "v@x.com" }),
    makeLead({ name: "Researched", research_state: "RESEARCHED", email: "r@x.com" }),
  ];
  const r = generateReport({ leads, user_request: "test" });
  // First should be Validated
  assert.ok(r.text.includes("## 1. Validated"));
  assert.ok(r.text.includes("## 2. Researched"));
  assert.ok(r.text.includes("## 3. Discovered"));
});

test("report: shows CONFIRMED_ABSENT distinctly from NOT_FOUND", () => {
  const lead = makeLead({
    evidence: [
      confirmedAbsent("phone", "TwoSources", "Multiple sources confirm no phone"),
    ],
  });
  const r = generateReport({ leads: [lead], user_request: "test" });
  assert.ok(r.text.includes("ausente confirmado"));
});

test("report: shows INFERRED distinctly from FOUND", () => {
  const lead = makeLead({
    evidence: [
      inferred("niche", "vegano", "12 posts mention 'vegano'", ["GoogleSearch"]),
    ],
  });
  const r = generateReport({ leads: [lead], user_request: "test" });
  assert.ok(r.text.includes("inferido"));
});
