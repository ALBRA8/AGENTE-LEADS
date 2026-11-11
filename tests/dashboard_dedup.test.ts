// ============================================================
// tests/dashboard_dedup.test.ts — Dedup multi-señal del dashboard
// Cubre el módulo puro dashboard/src/lib/leads/dedup.ts:
// normalizadores, decideSameBusiness (señales y conflictos),
// selección de sobreviviente determinista y funciones de alto
// nivel usadas por las rutas /api/search y /api/chat.
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";

// El paquete dashboard es CJS (sin "type": "module"), así que importamos
// el módulo TS vía el interop de default para que node --test --import tsx
// lo cargue correctamente desde la raíz.
import dedupModule from "../dashboard/src/lib/leads/dedup.js";

const {
  normName,
  normCity,
  normPhone,
  normSite,
  decideSameBusiness,
  canMerge,
  completenessScore,
  survivorKey,
  pickSurvivor,
  dedupProspects,
  matchExistingProspect,
} = dedupModule as typeof import("../dashboard/src/lib/leads/dedup.js");

// ── Normalizadores ─────────────────────────────────────────────

test("dashboard dedup: normName quita tildes, colapsa espacios y normaliza caso", () => {
  assert.equal(normName("Café Pepe"), "cafe pepe");
  assert.equal(normName("CAFE  PEPE"), "cafe pepe");
  assert.equal(normName("  Panadería   La   Espiga "), "panaderia la espiga");
  assert.equal(normName(""), "");
  assert.equal(normName(null), "");
  assert.equal(normName(undefined), "");
});

test("dashboard dedup: normPhone canonicaliza formatos y prefijos de país", () => {
  // Mismo número en tres formatos distintos → misma forma canónica
  assert.equal(normPhone("+57 300 111 22 33"), "3001112233");
  assert.equal(normPhone("+573001112233"), "3001112233");
  assert.equal(normPhone("3001112233"), "3001112233");
  assert.equal(normPhone("(57) 300-111-2233"), "3001112233");
  // Determinista y vacío
  assert.equal(normPhone(""), "");
  assert.equal(normPhone(null), "");
});

test("dashboard dedup: normSite quita protocolo, www, query y barra final", () => {
  assert.equal(normSite("https://www.cafepepe.com/"), "cafepepe.com");
  assert.equal(normSite("http://cafepepe.com/contacto?utm=x"), "cafepepe.com/contacto");
  assert.equal(normSite("WWW.CAFEPEPE.COM"), "cafepepe.com");
  assert.equal(normSite("cafepepe.com/#seccion"), "cafepepe.com");
  assert.equal(normSite(""), "");
  assert.equal(normSite(null), "");
});

test("dashboard dedup: normCity normaliza ciudades con tildes y caso", () => {
  assert.equal(normCity("Medellín"), "medellin");
  assert.equal(normCity("MEDELLIN"), "medellin");
});

// ── (a) mismo nombre, distinta website ─────────────────────────

test("(a) mismo nombre con distinta website NO se fusiona (conflicto decisivo)", () => {
  const a = { name: "Café Pepe", city: "Medellín", website: "https://cafepepe.com" };
  const b = { name: "Café Pepe", city: "Medellín", website: "https://cafepepe.net" };
  const v = decideSameBusiness(a, b);
  assert.equal(v.same, false);
  assert.equal(v.strength, "NONE");
  assert.equal(v.conflict, "website");
  assert.equal(canMerge(v), false);
});

// ── (b) mismo nombre+ciudad, distinto teléfono ─────────────────

test("(b) mismo nombre y ciudad con distinto teléfono NO se fusiona", () => {
  const a = { name: "Bar Nora", city: "Bogotá", phone: "+57 300 111 22 33" };
  const b = { name: "Bar Nora", city: "Bogotá", phone: "+57 311 555 66 77" };
  const v = decideSameBusiness(a, b);
  assert.equal(v.same, false);
  assert.equal(v.strength, "NONE");
  assert.equal(v.conflict, "phone");
  assert.equal(canMerge(v), false);
});

// ── (c) mismo negocio entre proveedores (formatos distintos) ───

test("(c) mismo negocio con teléfono en formato distinto y web con/sin www SÍ se fusiona (EXACT)", () => {
  const google = {
    name: "Panadería La Espiga",
    city: "Cali",
    phone: "+57 300 111 22 33",
    website: "https://www.laespiga.co",
  };
  const scraper = {
    name: "Panaderia la espiga",
    city: "Cali",
    phone: "+573001112233",
    website: "laespiga.co",
  };
  const v = decideSameBusiness(google, scraper);
  assert.equal(v.same, true);
  assert.equal(v.strength, "EXACT");
  assert.equal(v.conflict, undefined);
  assert.equal(canMerge(v), true);
});

test("(c) mismo teléfono normalizado con una web vacía SÍ se fusiona (EXACT por teléfono)", () => {
  const v = decideSameBusiness(
    { name: "Panadería La Espiga", city: "Cali", phone: "+57 300 111 22 33", website: "laespiga.co" },
    { name: "La Espiga Pan", city: "Cali", phone: "3001112233" }
  );
  assert.equal(v.same, true);
  assert.equal(v.strength, "EXACT");
});

test("(limitación documentada) misma web con distinta ruta cuenta como website distinta", () => {
  // Regla estricta: normSite conserva la ruta; si las websites normalizadas
  // difieren el veredicto es negativo decisivo, aunque el teléfono coincida.
  const v = decideSameBusiness(
    { name: "Panadería La Espiga", city: "Cali", phone: "+573001112233", website: "https://www.laespiga.co/contacto" },
    { name: "Panadería La Espiga", city: "Cali", phone: "+573001112233", website: "laespiga.co" }
  );
  assert.equal(v.same, false);
  assert.equal(v.conflict, "website");
});

test("(c) misma website normalizada con nombres distintos SÍ se fusiona (EXACT)", () => {
  const v = decideSameBusiness(
    { name: "Tienda Doña Ana", website: "https://tiendana.com" },
    { name: "Ana Compras", website: "tiendana.com/" }
  );
  assert.equal(v.same, true);
  assert.equal(v.strength, "EXACT");
});

// ── (d) tildes / espacios / caso distintos en misma ciudad ─────

test("(d) nombres con tildes, espacios y caso distintos en la misma ciudad SÍ se fusionan (STRONG)", () => {
  const a = { name: "Café Pepe", city: "Medellín" };
  const b = { name: "CAFE  PEPE", city: "medellin" };
  assert.equal(normName(a.name), normName(b.name));
  const v = decideSameBusiness(a, b);
  assert.equal(v.same, true);
  assert.equal(v.strength, "STRONG");
  assert.equal(v.conflict, undefined);
});

// ── (e) ambiguo: website distinta → separados, existente intacto ─

test("(e) mismo nombre+ciudad con websites distintas produce registros separados", () => {
  const existing = {
    id: "existing-1",
    name: "Café Pepe",
    city: "Medellín",
    website: "https://cafepepe.com",
  };
  const incoming = {
    name: "Café Pepe",
    city: "Medellín",
    website: "https://cafespepe.com",
  };
  // El veredicto es negativo por conflicto de website
  const v = decideSameBusiness(incoming, existing);
  assert.equal(v.same, false);
  assert.equal(v.conflict, "website");
  // El match contra la BD devuelve null → la ruta crea un registro nuevo
  const matched = matchExistingProspect(incoming, [existing]);
  assert.equal(matched, null);
});

test("(e) el registro existente NUNCA se sobreescribe: se devuelve la misma referencia sin mutar", () => {
  const existing = {
    id: "existing-1",
    name: "cafe pepe",
    city: "medellin",
    website: "cafepepe.com",
    phone: "3001112233",
    email: "hola@cafepepe.com",
    description: "Café de barrio",
  };
  const snapshot = JSON.stringify(existing);
  const incoming = {
    name: "Café Pepe",
    city: "Medellín",
    website: "https://www.cafepepe.com/",
    phone: "+57 300 111 22 33",
    email: "nuevo@cafepepe.com",
  };
  const matched = matchExistingProspect(incoming, [existing]);
  // Misma referencia (el llamador reutiliza el id existente)
  assert.equal(matched, existing);
  assert.equal(matched?.id, "existing-1");
  // Sin mutación: el existente conserva sus valores originales
  assert.equal(JSON.stringify(existing), snapshot);
  assert.equal(existing.email, "hola@cafepepe.com");
});

// ── (f) PROBABLE: solo nombre, ciudad distinta o desconocida ────

test("(f) solo nombre coincidente con ciudad distinta (PROBABLE) NO se fusiona", () => {
  const v = decideSameBusiness(
    { name: "La Tienda", city: "Medellín" },
    { name: "La Tienda", city: "Bogotá" }
  );
  assert.equal(v.same, false);
  assert.equal(v.strength, "PROBABLE");
  assert.equal(canMerge(v), false);
  // Contra la BD: candidato por nombre con otra ciudad → no match
  const matched = matchExistingProspect(
    { name: "La Tienda", city: "Medellín" },
    [{ id: "db-1", name: "La Tienda", city: "Bogotá" }]
  );
  assert.equal(matched, null);
});

test("(f) solo nombre coincidente con ciudad desconocida (PROBABLE) NO se fusiona", () => {
  const v = decideSameBusiness(
    { name: "La Tienda", city: "Medellín" },
    { name: "La Tienda" }
  );
  assert.equal(v.same, false);
  assert.equal(v.strength, "PROBABLE");
  // Y si el nombre ni siquiera coincide, no hay señal alguna
  const v2 = decideSameBusiness(
    { name: "La Tienda", city: "Medellín" },
    { name: "Otro Negocio", city: "Medellín" }
  );
  assert.equal(v2.same, false);
  assert.equal(v2.strength, "NONE");
});

// ── Sobreviviente determinista (independiente del orden) ───────

test("el sobreviviente es el más completo y NO depende del orden de llegada", () => {
  const rico = {
    name: "Café Pepe",
    city: "Medellín",
    website: "cafepepe.com",
    phone: "+57 300 111 22 33",
    email: "hola@cafepepe.com",
    address: "Calle 10 # 4-25",
    description: "Café de especialidad",
  };
  const pobre = {
    name: "cafe pepe",
    city: "Medellín",
    website: "https://www.cafepepe.com/",
    phone: "+573001112233",
  };
  // Duplicados reales: misma web y mismo teléfono normalizados
  assert.ok(canMerge(decideSameBusiness(rico, pobre)));
  assert.ok(completenessScore(rico) > completenessScore(pobre));
  // Ambos órdenes producen el MISMO ganador (misma referencia de contenido)
  assert.equal(pickSurvivor([rico, pobre]), rico);
  assert.equal(pickSurvivor([pobre, rico]), rico);
});

test("desempate lexicográfico por normName+city cuando la completitud es igual", () => {
  const beta = { name: "Zapatos Beta", city: "Cali" };
  const alfa = { name: "Zapatos Alfa", city: "Cali" };
  assert.ok(survivorKey(alfa) < survivorKey(beta));
  assert.equal(pickSurvivor([beta, alfa]), alfa);
  assert.equal(pickSurvivor([alfa, beta]), alfa);
});

test("dedupProspects fusiona duplicados multi-proveedor y reporta eliminados", () => {
  const raw = [
    { name: "Panadería La Espiga", city: "Cali", phone: "+57 300 111 22 33", source: "google" },
    { name: "Panaderia la espiga", city: "Cali", phone: "+573001112233", website: "laespiga.co", source: "scraper" },
    { name: "Café Pepe", city: "Medellín", website: "cafepepe.com", source: "google" },
    { name: "CAFE PEPE", city: "Medellín", website: "https://www.cafepepe.com/", phone: "+57 311 444 55 66", email: "hola@cafepepe.com", source: "scraper" },
    { name: "Café Pepe", city: "Bogotá", source: "scraper" }, // PROBABLE: ciudad distinta, NO fusiona
  ];
  const a = dedupProspects(raw);
  const b = dedupProspects([...raw].reverse());
  // Tres negocios reales: La Espiga, Café Pepe (Medellín) y Café Pepe (Bogotá)
  assert.equal(a.unique.length, 3);
  assert.equal(a.duplicatesRemoved, 2);
  // El resultado no depende del orden de llegada de la entrada
  assert.equal(a.unique.length, b.unique.length);
  assert.deepEqual(
    a.unique.map((u) => survivorKey(u)).sort(),
    b.unique.map((u) => survivorKey(u)).sort()
  );
  // El ganador de cada grupo es el más completo, no el primero que llegó
  const espiga = a.unique.find((u) => normName(u.name).includes("espiga"));
  assert.equal(espiga?.website, "laespiga.co");
  const pepe = a.unique.find((u) => normName(u.name) === "cafe pepe" && u.city === "Medellín");
  assert.equal(pepe?.email, "hola@cafepepe.com");
});

// ── matchExistingProspect (lógica de las rutas) ────────────────

test("matchExistingProspect reutiliza por teléfono aunque el nombre difiera (EXACT)", () => {
  const existing = { id: "db-9", name: "Distribuidora Andina", city: "Bogotá", phone: "+57 601 234 5678" };
  const matched = matchExistingProspect(
    { name: "Andina Distribución", city: "Bogotá", phone: "6012345678" },
    [existing]
  );
  assert.equal(matched, existing);
});

test("matchExistingProspect con conflicto de teléfono devuelve null (crea registro nuevo)", () => {
  const existing = { id: "db-1", name: "Bar Nora", city: "Bogotá", phone: "+57 300 111 22 33" };
  const matched = matchExistingProspect(
    { name: "Bar Nora", city: "Bogotá", phone: "+57 311 555 66 77" },
    [existing]
  );
  assert.equal(matched, null);
});

test("matchExistingProspect elige el mismo candidato aunque las filas lleguen en otro orden", () => {
  const rp = { name: "Café Pepe", city: "Medellín" };
  const dbA = { id: "db-a", name: "Café Pepe", city: "Medellín", website: "cafepepe.com", phone: "+57 300 111 22 33" };
  const dbB = { id: "db-b", name: "cafe pepe", city: "medellin", email: "hola@cafepepe.com" };
  const m1 = matchExistingProspect(rp, [dbA, dbB]);
  const m2 = matchExistingProspect(rp, [dbB, dbA]);
  assert.equal(m1, dbA);
  assert.equal(m2, dbA); // dbA es más completo: gana en ambos órdenes
});
