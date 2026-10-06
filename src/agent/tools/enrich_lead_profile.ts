// ============================================================
// src/agent/tools/enrich_lead_profile.ts
//
// FIXED (P0 auditoría): la tool anterior devolvía resultados crudos
// de Google Search y el LLM tenía que inferir el perfil. Ahora la
// descripción deja claro que es Research infraestructura, no
// inteligencia.
//
// La transformación de "resultados de búsqueda" → "Lead estructurado
// con evidencia" la hace el pipeline `runResearch` (P0.4).
// Esta tool sigue siendo útil para que el LLM haga enriquecimiento
// puntual sin pasar por el pipeline completo.
// ============================================================

import { Tool } from "../types.js";

export const enrichLeadProfile: Tool = {
  definition: {
    type: "function",
    function: {
      name: "enrich_lead_profile",
      description:
        "Busca información pública adicional sobre un lead " +
        "(menciones externas, contactos, redes sociales) usando Google Search via Apify. " +
        "Devuelve raw results (links, snippets, emails/phones extraídos). " +
        "IMPORTANTE: esto es infraestructura de extracción, NO inteligencia. " +
        "El LLM debe estructurar los resultados antes de presentarlos al usuario. " +
        "Para investigación estructurada con evidencia, preferir el tool `run_lead_pipeline` " +
        "que pasa por el pipeline de Research (P0.4) y produce Lead con EvidenceRecord[].",
      parameters: {
        type: "object",
        properties: {
          username: { type: "string", description: "Username de la red social" },
          niche: { type: "string", description: "Nicho o contexto del lead" }
        },
        required: ["username", "niche"]
      }
    }
  },
  async execute({ username, niche }) {
    const apiToken = process.env.APIFY_TOKEN;
    if (!apiToken) {
      return "Error: APIFY_TOKEN is required for enrichment.";
    }

    const url = `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${apiToken}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: `"${username}" ${niche} contact email OR linkedin OR website`,
          maxPagesPerQuery: 1,
          resultsPerPage: 5
        })
      });

      if (!response.ok) {
        return `Error en enriquecimiento: ${response.status} ${response.statusText}`;
      }

      const results = await response.json();
      return JSON.stringify({
        source: "Google Enrichment (raw results — Research infraestructura, no Lead estructurado)",
        lead: username,
        found_info: (results as any[]).map((r: any) => ({ title: r.title, link: r.url, snippet: r.description }))
      });
    } catch (error) {
      return `Error enriqueciendo perfil: ${(error as Error).message}`;
    }
  }
};
