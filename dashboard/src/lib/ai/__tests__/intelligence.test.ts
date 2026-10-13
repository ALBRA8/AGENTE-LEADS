// ============================================================
// src/lib/ai/__tests__/intelligence.test.ts — Tests P2
// Taxonomía FACT/INFERENCE/HYPOTHESIS/RECOMMENDATION en intelligence.
//
// Cobertura exigida:
//   1. Items del LLM con kinds válidos pasan normalizados (orden y texto).
//   2. HYPOTHESIS del LLM se conserva tal cual (el LLM SÍ puede especular).
//   3. Kinds basura ("fact", "Hecho", "EVIDENCIA"...) → normalizados o
//      descartados según la regla de honestidad (nunca reclasificados).
//   4. 0 items válidos del LLM → items deterministas con kinds correctos.
//   5. LLM lanza → fallback determinista (FACT/INFERENCE/RECOMMENDATION,
//      sin HYPOTHESIS) con confidence "low".
//   6. Máximo 10 items + dedupe por (kind + text lowercase).
//   7. Prospect inexistente → fallback honesto sin items.
// Nunca se llama al LLM real: aiChat y @/lib/db están mockeados.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// DB mock — creado vía vi.hoisted para que la factoría pueda referenciarlo.
const dbMock = vi.hoisted(() => ({
  prospect: { findUnique: vi.fn() },
}));

vi.mock("@/lib/ai/client", () => ({ aiChat: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import { aiChat } from "@/lib/ai/client";
import { db } from "@/lib/db";
import {
  buildDeterministicItems,
  generateIntelligence,
  normalizeItems,
} from "@/lib/ai/intelligence";

const aiChatMock = aiChat as unknown as ReturnType<typeof vi.fn>;
const findUniqueMock = db.prospect.findUnique as unknown as ReturnType<typeof vi.fn>;

// Silenciar el console.error del catch (mantener la salida de tests limpia)
let errSpy: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errSpy.mockRestore();
});

// ── Fixtures ────────────────────────────────────────────────

/** Prospect rico: Places (rating/businessStatus), dolor con evidencia, contacto completo. */
const RICH_PROSPECT = {
  id: "p-rich-1",
  name: "Clínica Dental Sonrisa",
  website: "https://clinica-sonrisa.com",
  phone: "+57 300 123 4567",
  email: "contacto@clinica-sonrisa.com",
  city: "Bogotá",
  category: "clínica dental",
  tier: "TIER_B",
  nicheFit: "medium",
  painDetected: true,
  painType: "outdated_website",
  painEvidence: "Copyright 2015 en el pie de página",
  techStack: JSON.stringify({ cms: "WordPress", isDiySite: true }),
  freshnessData: JSON.stringify({ freshnessScore: 40 }),
  rating: 4.5,
  ratingCount: 23,
  businessStatus: "OPERATIONAL",
  isMock: false,
  digitalPresence: "WEB_PENDIENTE_DE_VERIFICAR",
};

/** Respuesta LLM válida con los 4 kinds, incluida una HYPOTHESIS. */
const VALID_LLM_RESPONSE = JSON.stringify({
  summary: "Clínica dental en Bogotá con web propia, teléfono y email públicos.",
  opportunity_size: "medium",
  outreach_angle: "Proponer renovación de la web con agendamiento online.",
  confidence: "medium",
  signals_used: ["website", "phone", "rating"],
  items: [
    { kind: "FACT", text: "Website: https://clinica-sonrisa.com" },
    { kind: "INFERENCE", text: "Web desactualizada porque el copyright es de 2015" },
    { kind: "HYPOTHESIS", text: "Podría estar perdiendo pacientes por la lentitud de la web" },
    { kind: "RECOMMENDATION", text: "Llamar ofreciendo una auditoría web gratuita" },
  ],
});

function mockProspect(value: unknown) {
  findUniqueMock.mockResolvedValue(value);
}

/** Helper: kinds de una lista de items. */
const kinds = (items: { kind: string }[]) => items.map((i) => i.kind);

describe("generateIntelligence — taxonomía P2", () => {
  it("items del LLM con kinds válidos pasan normalizados, en orden y sin tocar la HYPOTHESIS", async () => {
    mockProspect(RICH_PROSPECT);
    aiChatMock.mockResolvedValue(VALID_LLM_RESPONSE);

    const res = await generateIntelligence("p-rich-1", "Diseño web para clínicas");

    expect(res.summary).toContain("Clínica dental en Bogotá");
    expect(res.opportunity_size).toBe("medium");
    expect(res.confidence).toBe("medium");
    expect(kinds(res.items)).toEqual(["FACT", "INFERENCE", "HYPOTHESIS", "RECOMMENDATION"]);
    // La HYPOTHESIS del LLM se conserva TAL CUAL (no se descarta ni reclasifica)
    expect(res.items[2].kind).toBe("HYPOTHESIS");
    expect(res.items[2].text).toBe("Podría estar perdiendo pacientes por la lentitud de la web");
    // El texto se recorta pero no se reescribe
    expect(res.items[0].text).toBe("Website: https://clinica-sonrisa.com");
  });

  it("kinds basura: sinónimos comunes es/en se normalizan, los no reconocidos se descartan", async () => {
    mockProspect(RICH_PROSPECT);
    aiChatMock.mockResolvedValue(
      JSON.stringify({
        summary: "s",
        opportunity_size: "unknown",
        outreach_angle: "a",
        confidence: "low",
        signals_used: [],
        items: [
          { kind: "fact", text: "minúsculas inglés" },
          { kind: "Hecho", text: "español capitalizado" },
          { kind: "inferencia", text: "sin acento" },
          { kind: "hipótesis", text: "con acento" },
          { kind: "recomendación", text: "recomendación es" },
          { kind: "EVIDENCIA", text: "no es un kind de la taxonomía" },
          { kind: "DATO_RARO", text: "tampoco" },
        ],
      })
    );

    const res = await generateIntelligence("p-rich-1");

    // "EVIDENCIA" y "DATO_RARO" se descartan (honestidad: NO se reclasifican)
    expect(kinds(res.items)).toEqual(["FACT", "FACT", "INFERENCE", "HYPOTHESIS", "RECOMMENDATION"]);
  });

  it("0 items válidos del LLM (array vacío) → se construyen items deterministas", async () => {
    mockProspect(RICH_PROSPECT);
    aiChatMock.mockResolvedValue(
      JSON.stringify({
        summary: "s",
        opportunity_size: "unknown",
        outreach_angle: "a",
        confidence: "low",
        signals_used: [],
        items: [],
      })
    );

    const res = await generateIntelligence("p-rich-1");

    expect(res.items).toEqual(buildDeterministicItems(RICH_PROSPECT));
    expect(kinds(res.items)).toEqual(["FACT", "FACT", "FACT", "FACT", "INFERENCE", "RECOMMENDATION"]);
    expect(res.items).toContainEqual({
      kind: "FACT",
      text: "Rating de Google: 4.5 (23 opiniones)",
    });
    expect(res.items).toContainEqual({
      kind: "INFERENCE",
      text: "Dolor detectado (outdated_website): Copyright 2015 en el pie de página",
    });
  });

  it("items del LLM todos inválidos (kinds irreconocibles) → deterministas", async () => {
    mockProspect(RICH_PROSPECT);
    aiChatMock.mockResolvedValue(
      JSON.stringify({
        summary: "s",
        opportunity_size: "unknown",
        outreach_angle: "a",
        confidence: "low",
        signals_used: [],
        items: [{ kind: "EVIDENCIA", text: "x" }, { kind: 42, text: "y" }, "no-soy-un-item"],
      })
    );

    const res = await generateIntelligence("p-rich-1");

    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items).toEqual(buildDeterministicItems(RICH_PROSPECT));
  });

  it("el LLM lanza → fallback determinista con confidence low, sin HYPOTHESIS", async () => {
    mockProspect(RICH_PROSPECT);
    aiChatMock.mockRejectedValue(new Error("boom de red simulada"));

    const res = await generateIntelligence("p-rich-1");

    expect(res.summary).toContain("Clínica Dental Sonrisa");
    expect(res.summary).toContain("información limitada");
    expect(res.opportunity_size).toBe("unknown");
    expect(res.confidence).toBe("low");

    // FACT observados presentes
    expect(res.items).toContainEqual({ kind: "FACT", text: "Website: https://clinica-sonrisa.com" });
    expect(res.items).toContainEqual({ kind: "FACT", text: "Teléfono: +57 300 123 4567" });
    expect(res.items).toContainEqual({ kind: "FACT", text: "Email: contacto@clinica-sonrisa.com" });
    expect(res.items).toContainEqual({ kind: "FACT", text: "Rating de Google: 4.5 (23 opiniones)" });
    // INFERENCE del dolor (con evidencia como porqué)
    expect(res.items).toContainEqual({
      kind: "INFERENCE",
      text: "Dolor detectado (outdated_website): Copyright 2015 en el pie de página",
    });
    // RECOMMENDATION derivada del dolor
    expect(res.items).toContainEqual({
      kind: "RECOMMENDATION",
      text: "Primera aproximación: abordar directamente outdated_website",
    });
    // Honestidad: el modo determinista NUNCA genera HYPOTHESIS
    expect(kinds(res.items)).not.toContain("HYPOTHESIS");
  });

  it("prospect inexistente → fallback honesto sin items inventados", async () => {
    mockProspect(null);

    const res = await generateIntelligence("no-existe");

    expect(res.summary).toContain("Prospect not found");
    expect(res.confidence).toBe("low");
    expect(res.items).toEqual([]);
    expect(aiChatMock).not.toHaveBeenCalled();
  });

  it("más de 10 items válidos con duplicados → techo 10 y sin duplicados", async () => {
    mockProspect(RICH_PROSPECT);
    const manyItems = [
      { kind: "FACT", text: "Dato uno" },
      { kind: "FACT", text: "dato dos" },
      { kind: "FACT", text: "DATO DOS" }, // duplicado (case-insensitive) del anterior
      ...Array.from({ length: 12 }, (_, i) => ({ kind: "INFERENCE", text: `Inferencia única ${i}` })),
    ];
    aiChatMock.mockResolvedValue(
      JSON.stringify({
        summary: "s",
        opportunity_size: "unknown",
        outreach_angle: "a",
        confidence: "low",
        signals_used: [],
        items: manyItems,
      })
    );

    const res = await generateIntelligence("p-rich-1");

    expect(res.items.length).toBe(10);
    // Dedupe: "dato dos" y "DATO DOS" colapsan a uno → quedan 2 FACT + 8 INFERENCE
    expect(kinds(res.items)).toEqual([
      "FACT", "FACT",
      ...Array.from({ length: 8 }, () => "INFERENCE"),
    ]);
    // Sin duplicados residuales por clave (kind + text lowercase)
    const keys = res.items.map((i) => `${i.kind}|${i.text.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("enums basura del LLM se saneían (opportunity_size/confidence) sin romper el resto", async () => {
    mockProspect(RICH_PROSPECT);
    aiChatMock.mockResolvedValue(
      JSON.stringify({
        summary: "s",
        opportunity_size: "GIGANTIC",
        outreach_angle: "a",
        confidence: "SUPREMO",
        signals_used: ["website", 42, null, "rating"],
        items: [{ kind: "FACT", text: "Dato observado" }],
      })
    );

    const res = await generateIntelligence("p-rich-1");

    expect(res.opportunity_size).toBe("unknown");
    expect(res.confidence).toBe("low");
    expect(res.signals_used).toEqual(["website", "rating"]);
    // El item válido del LLM sí se conserva (no se sustituye por deterministas)
    expect(res.items).toEqual([{ kind: "FACT", text: "Dato observado" }]);
  });
});

describe("normalizeItems", () => {
  it("no-array → []", () => {
    expect(normalizeItems(undefined)).toEqual([]);
    expect(normalizeItems(null)).toEqual([]);
    expect(normalizeItems("items")).toEqual([]);
    expect(normalizeItems({ kind: "FACT", text: "x" })).toEqual([]);
  });

  it("descarta entradas no-objeto, sin kind, con kind no-string y textos vacíos/whitespace", () => {
    const raw = [
      null,
      "string suelta",
      42,
      { text: "sin kind" },
      { kind: 42, text: "kind numérico" },
      { kind: "FACT", text: "" },
      { kind: "FACT", text: "   \n  " },
      { kind: "FACT", text: "este sí es válido" },
    ];
    expect(normalizeItems(raw)).toEqual([{ kind: "FACT", text: "este sí es válido" }]);
  });

  it("tabla de sinónimos es/en: Fact/HECHO/Dato → FACT, conclusión → INFERENCE, suposicion → HYPOTHESIS, acción → RECOMMENDATION", () => {
    const raw = [
      { kind: "Fact", text: "a" },
      { kind: "HECHO", text: "b" },
      { kind: " dato ", text: "c" }, // trim aplicado al kind
      { kind: "Conclusión", text: "d" },
      { kind: "suposicion", text: "e" },
      { kind: "Acción", text: "f" },
    ];
    expect(kinds(normalizeItems(raw))).toEqual([
      "FACT", "FACT", "FACT", "INFERENCE", "HYPOTHESIS", "RECOMMENDATION",
    ]);
  });

  it("kinds no reconocidos → item descartado, nunca reclasificado (honestidad)", () => {
    const raw = [
      { kind: "EVIDENCIA", text: "podría ser un hecho" },
      { kind: "opinion", text: "no está en la taxonomía" },
      { kind: "FACT", text: "válido" },
    ];
    expect(normalizeItems(raw)).toEqual([{ kind: "FACT", text: "válido" }]);
  });

  it("dedupe por (kind + text lowercase) conserva la primera aparición; mismo texto con kind distinto NO se deduplica", () => {
    const raw = [
      { kind: "FACT", text: "Website: https://x.com" },
      { kind: "FACT", text: "website: https://x.com" }, // dedupe (mismo kind, texto case-insensitive)
      { kind: "INFERENCE", text: "Website: https://x.com" }, // kind distinto → se conserva
    ];
    const out = normalizeItems(raw);
    expect(out).toEqual([
      { kind: "FACT", text: "Website: https://x.com" },
      { kind: "INFERENCE", text: "Website: https://x.com" },
    ]);
  });

  it("techo duro de 10 items aplicado tras el dedupe (no se pierden únicos evitables)", () => {
    const raw = [
      ...Array.from({ length: 8 }, (_, i) => ({ kind: "FACT", text: `F${i}` })),
      { kind: "INFERENCE", text: "I0" },
      { kind: "INFERENCE", text: "I0" }, // duplicado exacto
      { kind: "INFERENCE", text: "I1" },
      { kind: "RECOMMENDATION", text: "R0" }, // sería el 11º único
    ];
    const out = normalizeItems(raw);
    expect(out.length).toBe(10); // 8 FACT + 2 INFERENCE (I0 dedupe, I1 entra), R0 fuera
    expect(kinds(out)).toEqual([
      "FACT", "FACT", "FACT", "FACT", "FACT", "FACT", "FACT", "FACT", "INFERENCE", "INFERENCE",
    ]);
  });
});

describe("buildDeterministicItems", () => {
  it("prospect rico → FACTs observados + INFERENCE del dolor + RECOMMENDATION, sin HYPOTHESIS", () => {
    const items = buildDeterministicItems(RICH_PROSPECT);

    expect(kinds(items)).toEqual(["FACT", "FACT", "FACT", "FACT", "INFERENCE", "RECOMMENDATION"]);
    expect(items).toEqual([
      { kind: "FACT", text: "Website: https://clinica-sonrisa.com" },
      { kind: "FACT", text: "Teléfono: +57 300 123 4567" },
      { kind: "FACT", text: "Email: contacto@clinica-sonrisa.com" },
      { kind: "FACT", text: "Rating de Google: 4.5 (23 opiniones)" },
      { kind: "INFERENCE", text: "Dolor detectado (outdated_website): Copyright 2015 en el pie de página" },
      { kind: "RECOMMENDATION", text: "Primera aproximación: abordar directamente outdated_website" },
    ]);
    // businessStatus OPERATIONAL no genera FACT (no es novedad)
    expect(items.some((i) => i.text.includes("Estado del negocio"))).toBe(false);
    expect(kinds(items)).not.toContain("HYPOTHESIS");
  });

  it("sin web pero con teléfono → RECOMMENDATION de contacto directo; sin pain", () => {
    const items = buildDeterministicItems({
      name: "Tienda Doña Ana",
      phone: "+57 311 555 0000",
      painDetected: false,
    });

    expect(kinds(items)).toEqual(["FACT", "RECOMMENDATION"]);
    expect(items).toContainEqual({ kind: "RECOMMENDATION", text: "Contacto directo por teléfono/WhatsApp viable" });
  });

  it("prospect mínimo (solo nombre, sin contacto) → única RECOMMENDATION genérica de verificación", () => {
    const items = buildDeterministicItems({ name: "Negocio Desconocido" });

    expect(items).toEqual([{ kind: "RECOMMENDATION", text: "Verificar datos antes de contactar" }]);
    expect(kinds(items)).not.toContain("HYPOTHESIS");
  });

  it("dolor sin evidencia → INFERENCE sin ': evidencia' inventada", () => {
    const items = buildDeterministicItems({
      name: "X",
      painDetected: true,
      painType: "no_social_media",
    });

    expect(items).toContainEqual({ kind: "INFERENCE", text: "Dolor detectado (no_social_media)" });
    expect(items).toContainEqual({
      kind: "RECOMMENDATION",
      text: "Primera aproximación: abordar directamente no_social_media",
    });
  });

  it("digitalPresence SIN_WEB_CONFIRMADA → INFERENCE de madurez digital baja", () => {
    const items = buildDeterministicItems({
      name: "Y",
      digitalPresence: "SIN_WEB_CONFIRMADA",
      phone: "+57 300 000 0000",
    });

    expect(items).toContainEqual({
      kind: "INFERENCE",
      text: "Sin web confirmada — madurez digital baja",
    });
    expect(items).toContainEqual({
      kind: "RECOMMENDATION",
      text: "Contacto directo por teléfono/WhatsApp viable",
    });
  });

  it("businessStatus != OPERATIONAL → FACT con etiqueta ES", () => {
    const closed = buildDeterministicItems({ name: "Z", businessStatus: "CLOSED_TEMPORARILY" });
    expect(closed).toContainEqual({
      kind: "FACT",
      text: "Estado del negocio en Google: Cerrado temporalmente",
    });

    const dead = buildDeterministicItems({ name: "Z", businessStatus: "CLOSED_PERMANENTLY" });
    expect(dead).toContainEqual({
      kind: "FACT",
      text: "Estado del negocio en Google: Cerrado permanentemente",
    });
  });

  it("rating sin ratingCount → FACT con '(opiniones no disponibles)'; rating 0 legítimo", () => {
    const noCount = buildDeterministicItems({ name: "W", rating: 4.2 });
    expect(noCount).toContainEqual({ kind: "FACT", text: "Rating de Google: 4.2 (opiniones no disponibles)" });

    const zero = buildDeterministicItems({ name: "W", rating: 0, ratingCount: 0 });
    expect(zero).toContainEqual({ kind: "FACT", text: "Rating de Google: 0 (0 opiniones)" });
  });

  it("null/undefined → []; NUNCA genera HYPOTHESIS en ningún caso", () => {
    expect(buildDeterministicItems(null)).toEqual([]);
    expect(buildDeterministicItems(undefined)).toEqual([]);

    const fixtures = [
      RICH_PROSPECT,
      { name: "A", painDetected: true, painType: "outdated_website" },
      { name: "B", digitalPresence: "SIN_WEB_CONFIRMADA" },
      { name: "C", businessStatus: "CLOSED_PERMANENTLY", rating: 1 },
    ];
    for (const f of fixtures) {
      expect(kinds(buildDeterministicItems(f))).not.toContain("HYPOTHESIS");
    }
  });
});
