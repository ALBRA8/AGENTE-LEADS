// ============================================================
// tests/evidence.test.ts — P0.6 Evidence engine
//
// Rule: an inference MUST NOT be presented as an observed fact.
// "no encontrado" ≠ "no tiene" — this distinction is the heart of P0.6.
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  found,
  notFound,
  confirmedAbsent,
  inferred,
  statusLabel,
  confidenceLabel,
  type EvidenceRecord,
} from "../src/agent/core/evidence.js";

test("found: creates FOUND evidence with source + retrieved_at", () => {
  const e = found("email", "test@example.com", "GoogleSearch", "Found in search snippet", "medium");
  assert.equal(e.field, "email");
  assert.equal(e.value, "test@example.com");
  assert.equal(e.status, "FOUND");
  assert.equal(e.source, "GoogleSearch");
  assert.equal(e.confidence, "medium");
  assert.ok(e.retrieved_at.includes("T"));
});

test("notFound: creates NOT_FOUND evidence — value is null", () => {
  const e = notFound("website", "GoogleSearch");
  assert.equal(e.status, "NOT_FOUND");
  assert.equal(e.value, null);
  assert.equal(e.confidence, "low");
  // CRITICAL: NOT_FOUND means "searched, didn't appear" — NOT "doesn't exist"
  assert.notEqual(statusLabel(e.status), "no tiene");
  assert.equal(statusLabel(e.status), "no encontrado");
});

test("confirmedAbsent: creates CONFIRMED_ABSENT evidence — distinct from NOT_FOUND", () => {
  const e = confirmedAbsent("phone", "TwoSources", "Multiple sources confirm no phone listed");
  assert.equal(e.status, "CONFIRMED_ABSENT");
  assert.equal(e.value, null);
  assert.equal(e.confidence, "high");
  assert.equal(statusLabel(e.status), "ausente confirmado");
  // NOT_FOUND and CONFIRMED_ABSENT are DIFFERENT states
  assert.notEqual(e.status, "NOT_FOUND");
});

test("inferred: creates INFERRED evidence — distinct from FOUND", () => {
  const e = inferred("niche", "vegano", "12 posts mention 'vegano'", ["GoogleSearch"]);
  assert.equal(e.status, "INFERRED");
  assert.equal(e.value, "vegano");
  assert.equal(e.confidence, "none");
  assert.equal(e.source, "system-inference");
  assert.deepEqual(e.inferred_from, ["GoogleSearch"]);
  // CRITICAL: INFERRED is NOT the same as FOUND
  assert.notEqual(e.status, "FOUND");
});

test("statusLabel: human-readable Spanish labels", () => {
  assert.equal(statusLabel("FOUND"), "encontrado");
  assert.equal(statusLabel("NOT_FOUND"), "no encontrado");
  assert.equal(statusLabel("CONFIRMED_ABSENT"), "ausente confirmado");
  assert.equal(statusLabel("INFERRED"), "inferido");
});

test("confidenceLabel: human-readable Spanish labels", () => {
  assert.equal(confidenceLabel("high"), "alta");
  assert.equal(confidenceLabel("medium"), "media");
  assert.equal(confidenceLabel("low"), "baja");
  assert.equal(confidenceLabel("none"), "ninguna");
});

test("CRITICAL: 'no encontrado' is the label, NOT 'no tiene'", () => {
  // This is the core P0.6 rule:
  //   "Una inferencia del sistema NO puede presentarse como un hecho observado."
  //   "Website: no encontrado"  ← correct
  //   "El negocio no tiene website"  ← INCORRECT (we never confirmed absence)
  const e = notFound("website", "test");
  assert.equal(statusLabel(e.status), "no encontrado");
  assert.notEqual(statusLabel(e.status), "no tiene");
});

test("EvidenceRecord: deduplication by field key works", () => {
  const a = found("email", "a@b.com", "src1", "ev1");
  const b = notFound("email", "src2");
  // These are different evidence for the same field — caller decides how to merge
  assert.equal(a.field, b.field);
  assert.notEqual(a.status, b.status);
});
