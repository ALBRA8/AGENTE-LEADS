import { Tool } from "../types.js";

export const enrichLeadProfile: Tool = {
  definition: {
    type: "function",
    function: {
      name: "enrich_lead_profile",
      description: "Busca información adicional de un perfil (email, web, LinkedIn) si no se encontró contacto directo.",
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

    console.log(`[AgentLoop] 🧪 Enriqueciendo perfil para: ${username}...`);

    // Usamos Google Search Scraper para buscar menciones externas del contacto
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
        return `Error en enriquecimiento: ${response.statusText}`;
      }

      const results = await response.json();
      return JSON.stringify({
        source: "Google Enrichment",
        lead: username,
        found_info: results.map((r: any) => ({ title: r.title, link: r.url, snippet: r.description }))
      });
    } catch (error) {
      return `Error enriqueciendo perfil: ${(error as Error).message}`;
    }
  }
};
