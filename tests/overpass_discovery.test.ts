// ============================================================
// tests/overpass_discovery.test.ts — P3 OpenStreetMap Overpass adapter
//
// Tests that:
//   - the provider name is "OpenStreetMap"
//   - isConfigured() returns true (no API key needed)
//   - discover() never throws to the caller
//   - discover() returns a ProviderResult envelope, and when the
//     sandbox has no network the failure is normalized to one of
//     { TIMEOUT, PROVIDER_UNAVAILABLE, TEMPORARY_FAILURE, EMPTY_RESULT }
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { OverpassDiscoveryProvider } from "../src/agent/providers/overpass_discovery.js";

test("OverpassDiscoveryProvider: name is 'OpenStreetMap'", () => {
  const p = new OverpassDiscoveryProvider();
  assert.equal(p.name, "OpenStreetMap");
});

test("OverpassDiscoveryProvider: isConfigured returns true (no API key needed)", async () => {
  const p = new OverpassDiscoveryProvider();
  assert.equal(await p.isConfigured(), true);
});

test("OverpassDiscoveryProvider: discover returns ProviderResult (may be empty if no network)", async () => {
  const p = new OverpassDiscoveryProvider();
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

test("OverpassDiscoveryProvider: discover with no city returns INVALID_INPUT (no fetch attempted)", async () => {
  const p = new OverpassDiscoveryProvider();
  const result = await p.discover({ query: "restaurantes veganos" });
  assert.equal(result.ok, false);
  assert.equal(result.error!.type, "INVALID_INPUT");
});

test("OverpassDiscoveryProvider: never throws to caller (interface contract)", async () => {
  const p = new OverpassDiscoveryProvider();
  // Even with a bogus call, the provider must not throw — it must
  // always return a ProviderResult envelope.
  const r1 = await p.discover({ query: "x", location: "x" });
  assert.equal(typeof r1.ok, "boolean");
});
