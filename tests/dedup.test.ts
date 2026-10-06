// ============================================================
// tests/dedup.test.ts — P0.7 Multi-signal deduplication
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, cleanupTestEnv } from "./setup.js";
import { runDedup } from "../src/agent/pipelines/dedup.js";
import { buildDedupSignature, type Lead, type MatchLevel } from "../src/agent/core/lead.js";
import { found, notFound } from "../src/agent/core/evidence.js";

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
    sources: ["MockDiscovery"],
    discovered_at: new Date().toISOString(),
    evidence: [
      found("email", "hello@veganheaven.com", "Google", "found"),
      found("website", "https://veganheaven.com.co", "Google", "found"),
      notFound("phone", "Google"),
    ],
    validation: {},
    research_state: "VALIDATED",
    dedup_signature: buildDedupSignature({
      name: "Vegan Heaven",
      username: "veganheavenmed",
      website: "https://veganheaven.com.co",
      email: "hello@veganheaven.com",
      phone: "+57 311 567 8901",
      location: "Medellín",
      url: "https://instagram.com/veganheavenmed",
    }),
    ...overrides,
  };
}

test("dedup: first save creates a new lead", async () => {
  setupTestEnv();
  try {
    const result = await runDedup({ lead: makeLead() });
    assert.equal(result.action, "created");
    assert.equal(result.matchLevel, "NO_MATCH");
    assert.ok(result.stored.id);
  } finally {
    cleanupTestEnv();
  }
});

test("dedup: EXACT match by email merges into existing lead", async () => {
  setupTestEnv();
  try {
    // Save lead 1
    const first = await runDedup({ lead: makeLead() });
    assert.equal(first.action, "created");

    // Save lead 2 with same email → should merge
    const second = await runDedup({
      lead: makeLead({
        name: "Vegan Heaven UPDATED",
        sources: ["DifferentSource"],
      }),
    });
    assert.equal(second.action, "merged");
    assert.equal(second.matchLevel, "EXACT");
    assert.ok(second.matchedOn.includes("email"));
    assert.equal(second.stored.id, first.stored.id);
  } finally {
    cleanupTestEnv();
  }
});

test("dedup: EXACT match by website when email differs", async () => {
  setupTestEnv();
  try {
    const first = await runDedup({ lead: makeLead() });

    // Same website, different email
    const second = await runDedup({
      lead: makeLead({
        email: "different@email.com",
        dedup_signature: buildDedupSignature({
          name: "Vegan Heaven",
          website: "https://veganheaven.com.co",
          email: "different@email.com",
        }),
      }),
    });
    assert.equal(second.action, "merged");
    assert.equal(second.matchLevel, "EXACT");
    assert.ok(second.matchedOn.includes("website"));
  } finally {
    cleanupTestEnv();
  }
});

test("dedup: STRONG match by instagram username", async () => {
  setupTestEnv();
  try {
    const first = await runDedup({ lead: makeLead() });

    // Different email + website, same instagram
    const second = await runDedup({
      lead: makeLead({
        email: "new@email.com",
        website: "https://different-site.com",
        username: "veganheavenmed",  // same
        dedup_signature: buildDedupSignature({
          name: "Vegan Heaven",
          username: "veganheavenmed",
          email: "new@email.com",
          website: "https://different-site.com",
        }),
      }),
    });
    assert.equal(second.action, "merged");
    assert.equal(second.matchLevel, "STRONG");
    assert.ok(second.matchedOn.includes("instagram"));
  } finally {
    cleanupTestEnv();
  }
});

test("dedup: PROBABLE match by normalized name + location", async () => {
  setupTestEnv();
  try {
    const first = await runDedup({ lead: makeLead() });

    // Different email, website, username, phone — only name + location match
    const second = await runDedup({
      lead: makeLead({
        email: "new@email.com",
        website: "https://other.com",
        username: "different_user",
        phone: "+57 999 999 9999",
        name: "Vegan Heaven",  // same name
        dedup_signature: buildDedupSignature({
          name: "Vegan Heaven",
          email: "new@email.com",
          website: "https://other.com",
          username: "different_user",
          phone: "+57 999 999 9999",
          location: "Medellín",
        }),
      }),
    });
    assert.equal(second.action, "merged");
    assert.equal(second.matchLevel, "PROBABLE");
    assert.ok(second.matchedOn.includes("normalized_name_location"));
  } finally {
    cleanupTestEnv();
  }
});

test("dedup: merge preserves more advanced research_state", async () => {
  setupTestEnv();
  try {
    // Save a DISCOVERED lead
    const first = await runDedup({
      lead: makeLead({ research_state: "DISCOVERED" }),
    });

    // Save a VALIDATED lead that matches
    const second = await runDedup({
      lead: makeLead({ research_state: "VALIDATED" }),
    });

    // Merged lead should have VALIDATED (more advanced)
    assert.equal(second.stored.research_state, "VALIDATED");
  } finally {
    cleanupTestEnv();
  }
});

test("dedup: merge deduplicates evidence by field (prefers FOUND)", async () => {
  setupTestEnv();
  try {
    // Lead 1: email FOUND
    const first = await runDedup({
      lead: makeLead({
        evidence: [found("email", "hello@veganheaven.com", "src1", "found")],
      }),
    });

    // Lead 2: email NOT_FOUND, phone FOUND
    const second = await runDedup({
      lead: makeLead({
        evidence: [
          notFound("email", "src2"),
          found("phone", "+57 311 567 8901", "src2", "found"),
        ],
      }),
    });

    // Merged lead should have email FOUND (preserved from existing)
    // AND phone FOUND (added from incoming)
    const emailEv = second.stored.evidence.find((e) => e.field === "email");
    assert.equal(emailEv!.status, "FOUND");
    assert.equal(emailEv!.value, "hello@veganheaven.com");

    const phoneEv = second.stored.evidence.find((e) => e.field === "phone");
    assert.equal(phoneEv!.status, "FOUND");
  } finally {
    cleanupTestEnv();
  }
});

test("dedup: NO_MATCH when no signals align", async () => {
  setupTestEnv();
  try {
    const first = await runDedup({ lead: makeLead() });

    // Completely different lead
    const second = await runDedup({
      lead: makeLead({
        name: "Different Restaurant",
        username: "different_user",
        website: "https://different.com",
        email: "different@email.com",
        phone: "+57 999 999 9999",
        location: "Bogotá",
        dedup_signature: buildDedupSignature({
          name: "Different Restaurant",
          username: "different_user",
          website: "https://different.com",
          email: "different@email.com",
          phone: "+57 999 999 9999",
          location: "Bogotá",
        }),
      }),
    });
    assert.equal(second.action, "created");
    assert.equal(second.matchLevel, "NO_MATCH");
  } finally {
    cleanupTestEnv();
  }
});
