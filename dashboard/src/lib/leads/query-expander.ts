// ============================================================
// src/lib/leads/query-expander.ts — Multi-query expansion service
// ============================================================
//
// Takes the user's offer + city + category + keywords and asks the
// LLM to produce 15-25 related search queries (service variants,
// neighborhood-scoped, synonyms, complementary niches, and Google
// dorks for public emails). The goal: run many parallel Google
// searches per user action and combine results to multiply the
// prospect volume per search action.
//
// Contract:
//   - Completes in a single LLM call (< 10s typical).
//   - NEVER throws — always returns at least the original query.
//   - Falls back to heuristic variations if the LLM fails or returns
//     malformed JSON.

import { aiChat } from "@/lib/ai/client";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExpandedQueryCategory =
  | "service_variant"
  | "neighborhood"
  | "synonym"
  | "complementary"
  | "dork";

const ALLOWED_CATEGORIES: ReadonlySet<ExpandedQueryCategory> = new Set<ExpandedQueryCategory>([
  "service_variant",
  "neighborhood",
  "synonym",
  "complementary",
  "dork",
]);

export interface ExpandedQuery {
  query: string;
  rationale: string; // why this query
  category: ExpandedQueryCategory;
}

export interface QueryExpansionResult {
  original: string;
  expanded: ExpandedQuery[];
}

export interface QueryExpansionInput {
  offerDescription: string;
  targetNiches?: string;
  city: string;
  country?: string;
  category?: string;
  keywords?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function coerceCategory(raw: unknown): ExpandedQueryCategory {
  if (typeof raw === "string" && ALLOWED_CATEGORIES.has(raw as ExpandedQueryCategory)) {
    return raw as ExpandedQueryCategory;
  }
  return "service_variant";
}

function buildOriginalQuery(input: QueryExpansionInput): string {
  const cat = input.category || "negocios";
  const country = input.country ? `, ${input.country}` : "";
  const kw = input.keywords ? ` ${input.keywords}` : "";
  return `${cat} en ${input.city}${country}${kw}`.trim();
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function expandQueries(
  input: QueryExpansionInput
): Promise<QueryExpansionResult> {
  const original = buildOriginalQuery(input);

  const system = `Eres un experto en prospección B2B y búsqueda web. Tu trabajo es generar queries de búsqueda relacionadas para encontrar el máximo número de negocios objetivo en una ciudad.

Generas ÚNICAMENTE JSON válido, sin markdown, con esta estructura:
{
  "queries": [
    { "query": "...", "rationale": "...", "category": "service_variant" | "neighborhood" | "synonym" | "complementary" | "dork" }
  ]
}

Categorías de expansión:
- service_variant: variaciones por servicio específico (botox, rellenos, depilación láser, medicina antienvejecimiento, etc.)
- neighborhood: nombres de barrios/zonas de la ciudad (El Poblado, Chapinero, etc.)
- synonym: sinónimos y formas alternativas de escribir el nicho (centro estético, clinica estetica, medicina estetica)
- complementary: nichos complementarios donde están los mismos clientes (cirugía plástica, dermatología, spa médico, odontología estética)
- dork: queries Google con operadores específicos para encontrar emails públicos (site:co "@gmail.com" + categoría + ciudad)

Reglas:
- Genera entre 15 y 25 queries.
- Cada query debe ser específica y útil para Google Search.
- Incluye al menos 3 queries de cada categoría.
- Adapta a la ciudad (conoce los barrios principales de ciudades hispanohablantes).
- No inventes nombres de barrios — usa solo barrios reales que conozcas de esa ciudad.
- Devuelve solo JSON, sin markdown.`;

  const userMsg = `OFERTA DEL USUARIO:
${input.offerDescription}

NICHOS OBJETIVO: ${input.targetNiches || "no especificado"}

BÚSQUEDA ORIGINAL:
- Ciudad: ${input.city}, ${input.country || ""}
- Categoría: ${input.category || "no especificada"}
- Keywords: ${input.keywords || "ninguna"}

Query original: "${original}"

Genera entre 15 y 25 queries expandidas.`;

  try {
    const raw = await aiChat([
      { role: "system", content: system },
      { role: "user", content: userMsg },
    ]);

    // Strip any accidental markdown fences the model may have added
    const cleaned = raw
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(cleaned) as { queries?: unknown };
    const rawList = Array.isArray(parsed.queries) ? parsed.queries : [];

    const queries: ExpandedQuery[] = rawList
      .map((item: unknown): ExpandedQuery | null => {
        if (!item || typeof item !== "object") return null;
        const q = item as { query?: unknown; rationale?: unknown; category?: unknown };
        const queryStr =
          typeof q.query === "string" ? q.query.trim() : "";
        if (!queryStr) return null;
        return {
          query: queryStr,
          rationale: typeof q.rationale === "string" ? q.rationale : "",
          category: coerceCategory(q.category),
        };
      })
      .filter((q): q is ExpandedQuery => q !== null);

    // Always guarantee at least the original query is in the result set,
    // even if the model returned nothing usable.
    if (queries.length === 0) {
      return { original, expanded: generateHeuristicQueries(input, original) };
    }

    return { original, expanded: queries };
  } catch (e) {
    console.error("[query-expander] AI error:", e);
    return { original, expanded: generateHeuristicQueries(input, original) };
  }
}

// ---------------------------------------------------------------------------
// Heuristic fallback (no LLM, no invented barrios)
// ---------------------------------------------------------------------------

function generateHeuristicQueries(
  input: QueryExpansionInput,
  original: string
): ExpandedQuery[] {
  const cat = input.category || "negocio";
  const city = input.city;
  const kw = input.keywords ? ` ${input.keywords}` : "";
  const tld = input.country?.toLowerCase() === "colombia" ? "co" : "com";

  const queries: ExpandedQuery[] = [
    {
      query: original,
      rationale: "Query original del usuario",
      category: "service_variant",
    },
    { query: `${cat} ${city}${kw}`, rationale: "Forma corta", category: "synonym" },
    {
      query: `${cat} en ${city}${kw}`,
      rationale: "Con preposición 'en'",
      category: "synonym",
    },
    {
      query: `clínicas de ${cat} en ${city}`,
      rationale: "Variante 'clínicas de'",
      category: "service_variant",
    },
    {
      query: `centro de ${cat} en ${city}`,
      rationale: "Variante 'centro de'",
      category: "service_variant",
    },
    {
      query: `${cat} ${city} directorio`,
      rationale: "Búsqueda en directorios",
      category: "complementary",
    },
    {
      query: `${cat} ${city} whatsapp`,
      rationale: "Negocios con contacto WhatsApp",
      category: "complementary",
    },
    {
      query: `site:${tld} "${cat}" "${city}" "@gmail.com"`,
      rationale: "Google dork para emails públicos en gmail",
      category: "dork",
    },
    {
      query: `site:${tld} "${cat}" "${city}" "@hotmail.com"`,
      rationale: "Google dork para emails públicos en hotmail",
      category: "dork",
    },
    {
      query: `site:facebook.com "${cat}" "${city}"`,
      rationale: "Dork para encontrar páginas de Facebook del nicho",
      category: "dork",
    },
    {
      query: `site:instagram.com "${cat}" "${city}"`,
      rationale: "Dork para encontrar perfiles de Instagram del nicho",
      category: "dork",
    },
  ];

  return queries;
}
