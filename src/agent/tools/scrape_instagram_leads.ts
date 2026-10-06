import { Tool } from "../types.js";

export const scrapeInstagramLeads: Tool = {
  definition: {
    type: "function",
    function: {
      name: "scrape_instagram_leads",
      description:
        "LEGACY: Hace una búsqueda en Google (via Apify google-search-scraper) buscando " +
        "páginas que mencionen el query + @gmail.com. NO es scraping de Instagram directamente. " +
        "Limitado a direcciones @gmail.com. Devuelve resultados crudos de Google sin normalizar. " +
        "Para prospección estructurada con calificación y evidencia, usar 'run_lead_pipeline'.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Palabra clave o nicho (ej. 'fotografos madrid')" }
        },
        required: ["query"]
      }
    }
  },
  async execute({ query }) {
    const apiToken = process.env.APIFY_TOKEN;
    if (!apiToken) {
      return "Error: APIFY_TOKEN is not set in environment variables.";
    }
    const url = `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${apiToken}`;
    
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: `site:instagram.com + ${query} + @gmail.com`,
          maxPagesPerQuery: 1,
          resultsPerPage: 10 // Empezamos con pocos para eficiencia del agente
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        return `Error calling Apify: ${response.status} ${response.statusText} - ${errorText}`;
      }

      const data = await response.json();
      // Retornamos un resumen para que el LLM decida qué leads procesar
      return JSON.stringify(data);
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }
};
