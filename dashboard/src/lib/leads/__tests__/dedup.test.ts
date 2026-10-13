// ============================================================
// src/lib/leads/__tests__/dedup.test.ts
// Tests del dedup multi-señal P1 (funciones puras, sin red ni DB).
// Cubre: normalizaciones (nombre/teléfono/sitio), construcción de
// candidatos por señal y sameBusiness por cada señal + prioridad.
// ============================================================
import { describe, expect, it } from "vitest";
import {
  buildDedupCandidates,
  normName,
  normPhone,
  normSite,
  sameBusiness,
} from "../dedup";
import type { RawProspect } from "../types";

/** Fábrica de prospectos: name y source obligatorios, resto opcional. */
const rp = (over: Partial<RawProspect>): RawProspect => ({
  name: "Clínica Estética",
  source: "google_places",
  ...over,
});

describe("normName", () => {
  it('quita diacríticos y lowercasea: "Clínica Estética" → "clinica estetica"', () => {
    expect(normName("Clínica Estética")).toBe("clinica estetica");
  });

  it('quita puntuación y colapsa espacios: "  Estética   Dental-Norte, S.A. "', () => {
    expect(normName("  Estética   Dental-Norte, S.A. ")).toBe(
      "estetica dentalnorte sa"
    );
  });

  it('"ñ" → "n" (NFD + rango combinante)', () => {
    expect(normName("Diseño Español")).toBe("diseno espanol");
  });

  it('devuelve "" con undefined, null-like y vacío', () => {
    expect(normName(undefined)).toBe("");
    expect(normName("")).toBe("");
    expect(normName("   ")).toBe("");
  });
});

describe("normPhone", () => {
  it('"573001234567" == "+57 300 123 4567" (solo dígitos)', () => {
    expect(normPhone("+57 300 123 4567")).toBe("573001234567");
    expect(normPhone("(57) 300-123-4567")).toBe("573001234567");
  });

  it('quita ceros iniciales: "0034 600 123 456" == "+34 600 123 456"', () => {
    expect(normPhone("0034 600 123 456")).toBe("34600123456");
    expect(normPhone("+34 600 123 456")).toBe("34600123456");
  });

  it('devuelve "" con menos de 7 dígitos (códigos cortos, p. ej. "911")', () => {
    expect(normPhone("911")).toBe("");
    expect(normPhone("+57 300")).toBe("");
  });

  it('devuelve "" con undefined o vacío', () => {
    expect(normPhone(undefined)).toBe("");
    expect(normPhone("")).toBe("");
  });
});

describe("normSite", () => {
  it('baja el host y conserva SOLO host: "https://www.ClinicaX.com/servicios" → "clinicax.com"', () => {
    expect(normSite("https://www.ClinicaX.com/servicios")).toBe("clinicax.com");
  });

  it('quita protocolo sin www y conserva guiones del host: "http://Estetica-Los-Alpes.cl/contacto?x=1"', () => {
    expect(normSite("http://Estetica-Los-Alpes.cl/contacto?x=1")).toBe(
      "estetica-los-alpes.cl"
    );
  });

  it('funciona sin protocolo: "www.clinicax.com" → "clinicax.com"', () => {
    expect(normSite("www.clinicax.com")).toBe("clinicax.com");
  });

  it('sin slash final: "https://clinicax.com/" → "clinicax.com"', () => {
    expect(normSite("https://clinicax.com/")).toBe("clinicax.com");
  });

  it('conserva subdominios distintos de www y corta query/fragmento', () => {
    expect(normSite("HTTPS://SUB.ClinicaX.COM/a/b?q=1#top")).toBe(
      "sub.clinicax.com"
    );
  });

  it('devuelve "" con undefined o vacío', () => {
    expect(normSite(undefined)).toBe("");
    expect(normSite("")).toBe("");
  });
});

describe("buildDedupCandidates", () => {
  it("prospecto completo → EXACT (place/tel/web) + STRONG (nc) + PROBABLE (n), en orden", () => {
    const candidates = buildDedupCandidates(
      rp({
        city: "Bogotá",
        phone: "+57 300 123 4567",
        website: "https://www.clinicaestetica.com/contacto",
        placeId: "ChIJabc123",
      })
    );
    expect(candidates).toEqual([
      { signal: "EXACT", key: "place:ChIJabc123" },
      { signal: "EXACT", key: "tel:573001234567" },
      { signal: "EXACT", key: "web:clinicaestetica.com" },
      { signal: "STRONG", key: "nc:clinica estetica|bogota" },
      { signal: "PROBABLE", key: "n:clinica estetica" },
    ]);
  });

  it("sin placeId/phone/website → solo STRONG y PROBABLE", () => {
    const candidates = buildDedupCandidates(rp({ city: "Bogotá" }));
    expect(candidates).toEqual([
      { signal: "STRONG", key: "nc:clinica estetica|bogota" },
      { signal: "PROBABLE", key: "n:clinica estetica" },
    ]);
  });

  it("solo nombre (sin ciudad) → una única clave PROBABLE", () => {
    expect(buildDedupCandidates(rp({ city: undefined }))).toEqual([
      { signal: "PROBABLE", key: "n:clinica estetica" },
    ]);
  });

  it("sin nombre → sin candidatos (ni PROBABLE ni STRONG)", () => {
    expect(buildDedupCandidates(rp({ name: "", city: "Bogotá" }))).toEqual([]);
  });

  it("teléfono corto (<7 dígitos) → sin clave tel", () => {
    const keys = buildDedupCandidates(rp({ phone: "911" })).map((c) => c.key);
    expect(keys).not.toContain("tel:911");
  });

  it("nunca devuelve claves duplicadas", () => {
    const candidates = buildDedupCandidates(
      rp({
        city: "Bogotá",
        phone: "+57 300 123 4567",
        website: "https://clinicax.com",
        placeId: "ChIJabc123",
      })
    );
    expect(new Set(candidates.map((c) => c.key)).size).toBe(candidates.length);
  });
});

describe("sameBusiness", () => {
  it('EXACT por teléfono aunque el nombre difiera: "+57 300 123 4567" vs "573001234567"', () => {
    const a = rp({ name: "Clínica Estética", phone: "+57 300 123 4567" });
    const b = rp({ name: "Clinica Estetica del Norte", phone: "573001234567" });
    expect(sameBusiness(a, b)).toEqual({
      match: true,
      signal: "EXACT",
      key: "tel:573001234567",
    });
  });

  it("EXACT por website aunque difiera protocolo/www/path", () => {
    const a = rp({ name: "Clínica A", website: "https://www.ClinicaX.com/servicios" });
    const b = rp({ name: "Clínica B", website: "http://clinicax.com" });
    expect(sameBusiness(a, b)).toEqual({
      match: true,
      signal: "EXACT",
      key: "web:clinicax.com",
    });
  });

  it("EXACT por placeId aunque el resto del perfil difiera", () => {
    const a = rp({ name: "Clínica A", placeId: "ChIJabc123" });
    const b = rp({ name: "Clínica B (nombre nuevo)", placeId: "ChIJabc123" });
    expect(sameBusiness(a, b)).toEqual({
      match: true,
      signal: "EXACT",
      key: "place:ChIJabc123",
    });
  });

  it("STRONG por nombre+ciudad normalizados aunque teléfonos difieran", () => {
    const a = rp({ name: "Estética Norte", city: "Bogotá", phone: "+57 300 111 1111" });
    const b = rp({ name: "estetica NORTE", city: "bogota", phone: "+57 300 222 2222" });
    expect(sameBusiness(a, b)).toEqual({
      match: true,
      signal: "STRONG",
      key: "nc:estetica norte|bogota",
    });
  });

  it("PROBABLE por solo nombre cuando las ciudades difieren", () => {
    const a = rp({ name: "Estética Norte", city: "Bogotá" });
    const b = rp({ name: "estetica norte", city: "Cali" });
    expect(sameBusiness(a, b)).toEqual({
      match: true,
      signal: "PROBABLE",
      key: "n:estetica norte",
    });
  });

  it("devuelve la señal MÁS fuerte cuando coinciden varias (tel EXACT gana a nombre PROBABLE)", () => {
    const a = rp({ name: "Clínica Estética", city: "Bogotá", phone: "+57 300 123 4567" });
    const b = rp({ name: "clinica estetica", city: "Cali", phone: "573001234567" });
    // Coinciden n: (PROBABLE) y tel: (EXACT), pero no nc: (ciudades distintas).
    expect(sameBusiness(a, b)).toEqual({
      match: true,
      signal: "EXACT",
      key: "tel:573001234567",
    });
  });

  it("devuelve null cuando nada coincide", () => {
    const a = rp({
      name: "Clínica Estética",
      city: "Bogotá",
      phone: "+57 300 123 4567",
      website: "https://clinicax.com",
    });
    const b = rp({
      name: "Dental Sur",
      city: "Medellín",
      phone: "+57 311 987 6543",
      website: "https://dentalsur.co",
    });
    expect(sameBusiness(a, b)).toBeNull();
  });

  it("es simétrico: el mismo match con (a,b) y (b,a)", () => {
    const a = rp({ name: "Estética Norte", city: "Bogotá", phone: "+57 300 111 1111" });
    const b = rp({ name: "estetica NORTE", city: "bogota", phone: "+57 300 222 2222" });
    expect(sameBusiness(b, a)).toEqual(sameBusiness(a, b));
  });
});
