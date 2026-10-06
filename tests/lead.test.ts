// ============================================================
// tests/lead.test.ts — P0.1 Canonical Lead model
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDedupSignature,
  extractDomain,
  normalizeUrl,
  normalizeName,
  extractHandle,
  extractSocialFromUrl,
  type Lead,
  type CandidateLead,
} from "../src/agent/core/lead.js";

test("buildDedupSignature: normalizes email + website + handles", () => {
  const sig = buildDedupSignature({
    name: "Vegan Heaven",
    username: "@VeganHeavenMed",
    website: "HTTPS://WWW.veganheaven.com.co/",
    email: "Contact@VeganHeaven.COM",
    phone: "+57 311 567 8901",
    location: "Medellín",
    url: "https://www.instagram.com/veganheavenmed",
  });

  assert.equal(sig.email, "contact@veganheaven.com");
  assert.equal(sig.domain, "veganheaven.com.co");
  assert.equal(sig.website, "veganheaven.com.co");
  assert.equal(sig.instagram, "veganheavenmed");
  assert.equal(sig.linkedin, null);
  assert.equal(sig.phone, "573115678901");
  assert.equal(sig.normalized_name_location, "vegan heaven|medellin");
});

test("buildDedupSignature: handles missing fields gracefully", () => {
  const sig = buildDedupSignature({ name: "Solo Name" });
  assert.equal(sig.email, null);
  assert.equal(sig.website, null);
  assert.equal(sig.instagram, null);
  assert.equal(sig.phone, null);
  assert.equal(sig.normalized_name_location, "solo name");
});

test("extractDomain: handles various URL formats", () => {
  assert.equal(extractDomain("https://www.example.com/page"), "example.com");
  assert.equal(extractDomain("http://sub.example.com"), "sub.example.com");
  assert.equal(extractDomain("example.com/path"), "example.com");
  assert.equal(extractDomain("not-a-url"), null);
});

test("normalizeUrl: strips protocol + www + trailing slash", () => {
  assert.equal(normalizeUrl("https://www.example.com/"), "example.com");
  assert.equal(normalizeUrl("http://example.com/page"), "example.com/page");
  assert.equal(normalizeUrl("example.com"), "example.com");
});

test("normalizeName: lowercases, removes accents + punctuation", () => {
  assert.equal(normalizeName("Café Médellín!"), "cafe medellin");
  assert.equal(normalizeName("  Más  espacios  "), "mas espacios");
  assert.equal(normalizeName("Niño-número"), "nino numero");
});

test("extractHandle: strips leading @", () => {
  assert.equal(extractHandle("@username", "instagram"), "username");
  assert.equal(extractHandle("username", "instagram"), "username");
  assert.equal(extractHandle(null, "instagram"), null);
});

test("extractSocialFromUrl: extracts profile handle from social URLs", () => {
  assert.equal(extractSocialFromUrl("https://www.instagram.com/veganheaven/", "instagram"), "veganheaven");
  // FIX (QUAL-C1): LinkedIn now returns the full path so different profiles don't dedup to "in"
  assert.equal(extractSocialFromUrl("https://linkedin.com/in/juan-perez", "linkedin"), "in/juan-perez");
  assert.equal(extractSocialFromUrl("https://linkedin.com/company/acme-corp", "linkedin"), "company/acme-corp");
  assert.equal(extractSocialFromUrl("https://example.com", "instagram"), null);
});

test("Lead type: candidate has source + discovered_at", () => {
  const candidate: CandidateLead = {
    name: "Test",
    source: "MockDiscovery",
    discovered_at: new Date().toISOString(),
  };
  assert.equal(candidate.source, "MockDiscovery");
  assert.ok(candidate.discovered_at.includes("T"));
});

test("Lead type: full Lead has evidence + validation + dedup_signature", () => {
  const lead: Lead = {
    name: "Test",
    sources: ["MockDiscovery"],
    discovered_at: new Date().toISOString(),
    evidence: [],
    validation: {},
    research_state: "DISCOVERED",
  };
  assert.equal(lead.research_state, "DISCOVERED");
  assert.equal(lead.evidence.length, 0);
});
