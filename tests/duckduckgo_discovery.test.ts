// ============================================================
// tests/duckduckgo_discovery.test.ts — P3 DuckDuckGo HTML search adapter
//
// Tests that:
//   - the provider name is "DuckDuckGo"
//   - isConfigured() returns true (no API key needed)
//   - discover() never throws to the caller
//   - discover() returns a ProviderResult envelope, and when the
//     sandbox has no network the failure is normalized to one of
//     { TIMEOUT, PROVIDER_UNAVAILABLE, TEMPORARY_FAILURE, EMPTY_RESULT }
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { DuckDuckGoDiscoveryProvider } from "../src/agent/providers/duckduckgo_discovery.js";

test("DuckDuckGoDiscoveryProvider: name is 'DuckDuckGo'", () => {
  const p = new DuckDuckGoDiscoveryProvider();
  assert.equal(p.name, "DuckDuckGo");
});

test("DuckDuckGoDiscoveryProvider: isConfigured returns true (no API key needed)", async () => {
  const p = new DuckDuckGoDiscoveryProvider();
  assert.equal(await p.isConfigured(), true);
});

test("DuckDuckGoDiscoveryProvider: discover returns ProviderResult (may be empty if no network)", async () => {
  const p = new DuckDuckGoDiscoveryProvider();
  // In sandbox without internet, this should fail gracefully and return an error result
  // (TIMEOUT or PROVIDER_UNAVAILABLE), NOT throw.
  const result = await p.discover({ query: "restaurantes veganos", location: "Bogotá", country: "Colombia" });
  assert.equal(typeof result.ok, "boolean");
  if (!result.ok) {
    assert.ok(result.error, "error should be set when ok=false");
    assert.ok(
      ["TIMEOUT", "PROVIDER_UNAVAILABLE", "TEMPORARY_FAILURE", "EMPTY_RESULT"].includes(
        result.error.type
      ),
      `unexpected error type: ${result.error.type}`
    );
  }
});

test("DuckDuckGoDiscoveryProvider: discover with empty query returns INVALID_INPUT (no fetch attempted)", async () => {
  const p = new DuckDuckGoDiscoveryProvider();
  const result = await p.discover({ query: "" });
  assert.equal(result.ok, false);
  assert.equal(result.error!.type, "INVALID_INPUT");
});

test("DuckDuckGoDiscoveryProvider: never throws to caller (interface contract)", async () => {
  const p = new DuckDuckGoDiscoveryProvider();
  // Even with minimal input, the provider must not throw — it must
  // always return a ProviderResult envelope.
  const r1 = await p.discover({ query: "x" });
  assert.equal(typeof r1.ok, "boolean");
});
