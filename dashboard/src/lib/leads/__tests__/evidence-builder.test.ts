// ============================================================
// src/lib/leads/__tests__/evidence-builder.test.ts
// Tests del contrato 2: evidencia por campo (borradores puros).
// Cubre: mapa de confidence por fuente, caso completo FOUND,
// caso mínimo (solo name → 3 NOT_FOUND), marcado isMock
// (source "mock", confidence 0.4, sourceUrl anulada) y orden.
// ============================================================
import { describe, expect, it } from "vitest";
import { buildDiscoveryEvidence, sourceConfidence } from "../evidence-builder";
import type { RawProspect } from "../types";

const PROSPECT_COMPLETO: RawProspect = {
  name: "Clínica Estética",
  website: "https://clinicaestetica.com",
  phone: "+57 300 123 4567",
  email: "hola@clinicaestetica.com",
  address: "Calle 123 #45-67, Bogotá",
  rating: 4.5,
  ratingCount: 120,
  placeId: "ChIJabc123",
  source: "google_places",
  sourceUrl: "https://maps.google.com/?cid=123",
};

describe("sourceConfidence", () => {
  it.each([
    ["mock", 0.4],
    ["google_places", 0.95],
    ["overpass", 0.8],
    ["web_search", 0.7],
    ["web_scraper", 0.6],
    ["manual", 1.0],
    ["fuente_desconocida", 0.5],
  ])('source "%s" → confidence %s', (source, expected) => {
    expect(sourceConfidence(source)).toBe(expected);
  });
});

describe("buildDiscoveryEvidence — caso completo", () => {
  const evidence = buildDiscoveryEvidence(PROSPECT_COMPLETO);

  it("genera una entrada FOUND por cada campo presente (6 en total)", () => {
    expect(evidence).toHaveLength(6);
    expect(evidence.every((e) => e.status === "FOUND")).toBe(true);
    expect(evidence.map((e) => e.field)).toEqual([
      "website",
      "phone",
      "email",
      "address",
      "rating",
      "placeId",
    ]);
  });

  it("los values son String(valor) exacto", () => {
    expect(evidence.map((e) => e.value)).toEqual([
      "https://clinicaestetica.com",
      "+57 300 123 4567",
      "hola@clinicaestetica.com",
      "Calle 123 #45-67, Bogotá",
      "4.5", // rating numérico → string
      "ChIJabc123",
    ]);
  });

  it("usa la fuente real, su confidence y conserva sourceUrl", () => {
    for (const e of evidence) {
      expect(e.source).toBe("google_places");
      expect(e.confidence).toBe(0.95);
      expect(e.sourceUrl).toBe("https://maps.google.com/?cid=123");
    }
  });
});

describe("buildDiscoveryEvidence — caso mínimo (solo name)", () => {
  const MINIMO: RawProspect = { name: "Clínica X", source: "web_search" };
  const evidence = buildDiscoveryEvidence(MINIMO);

  it("genera exactamente 3 entradas NOT_FOUND (website, phone, email)", () => {
    expect(evidence).toHaveLength(3);
    expect(evidence.map((e) => e.field)).toEqual(["website", "phone", "email"]);
    expect(evidence.every((e) => e.status === "NOT_FOUND")).toBe(true);
  });

  it("las entradas NOT_FOUND no llevan value", () => {
    for (const e of evidence) {
      expect(e.value).toBeUndefined();
      expect(e).not.toHaveProperty("value");
    }
  });

  it("no genera entradas para address/rating/placeId cuando no aplican", () => {
    const fields = evidence.map((e) => e.field);
    expect(fields).not.toContain("address");
    expect(fields).not.toContain("rating");
    expect(fields).not.toContain("placeId");
  });

  it("usa la fuente del prospecto con su confidence", () => {
    for (const e of evidence) {
      expect(e.source).toBe("web_search");
      expect(e.confidence).toBe(0.7);
    }
  });
});

describe("buildDiscoveryEvidence — marcado isMock (contrato 10)", () => {
  const MOCK: RawProspect = {
    name: "Clínica Demo",
    website: "https://demo.local",
    phone: "3001234567",
    source: "web_search",
    sourceUrl: "https://no-debe-aparecer.example",
    isMock: true,
  };
  const evidence = buildDiscoveryEvidence(MOCK);

  it('fuente forzada a "mock" con confidence 0.4', () => {
    expect(evidence).toHaveLength(3); // website FOUND, phone FOUND, email NOT_FOUND
    for (const e of evidence) {
      expect(e.source).toBe("mock");
      expect(e.source).not.toBe("web_search");
      expect(e.confidence).toBe(0.4);
    }
  });

  it("sourceUrl anulada aunque el prospecto la trajera informada", () => {
    for (const e of evidence) {
      expect(e.sourceUrl).toBeUndefined();
      expect(e).not.toHaveProperty("sourceUrl");
    }
  });

  it("los datos presentes siguen siendo FOUND con su value", () => {
    expect(evidence.filter((e) => e.status === "FOUND").map((e) => e.field)).toEqual([
      "website",
      "phone",
    ]);
    expect(
      evidence.find((e) => e.field === "phone")?.value
    ).toBe("3001234567");
  });
});

describe("buildDiscoveryEvidence — reglas de campo", () => {
  it("rating 0 cuenta como presente (!= null) y se serializa a \"0\"", () => {
    const evidence = buildDiscoveryEvidence({ name: "X", rating: 0, source: "overpass" });
    const rating = evidence.find((e) => e.field === "rating");
    expect(rating?.status).toBe("FOUND");
    expect(rating?.value).toBe("0");
  });

  it("ordena estable: primero todas las FOUND, luego las NOT_FOUND", () => {
    const evidence = buildDiscoveryEvidence({
      name: "X",
      website: "https://a.com",
      address: "Calle 1",
      rating: 3.5,
      source: "web_scraper",
    });
    expect(evidence.map((e) => [e.field, e.status])).toEqual([
      ["website", "FOUND"],
      ["address", "FOUND"],
      ["rating", "FOUND"],
      ["phone", "NOT_FOUND"],
      ["email", "NOT_FOUND"],
    ]);
  });
});
