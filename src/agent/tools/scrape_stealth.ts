import { Tool } from "../types.js";
import { runStealthScraper } from "../utils/python_bridge.js";

export const scrapeStealth: Tool = {
  definition: {
    type: "function",
    function: {
      name: "scrape_stealth",
      description: "Visita una URL de forma indetectable (evade Cloudflare/Akamai) y extrae su contenido. Útil para perfiles de Instagram individuales o sitios web que bloquean el scraping convencional.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL completa a visitar (ej. https://www.instagram.com/usuario/)" },
          selector: { type: "string", description: "Opcional. Selector CSS para extraer un dato específico (ej. 'header h1'). Si se omite, extrae emails y links de forma automática." }
        },
        required: ["url"]
      }
    }
  },
  async execute({ url, selector }) {
    console.log(`[AgentLoop] 🥷 Ejecutando Scrape Stealth en: ${url}`);
    try {
      const result = await runStealthScraper(url, selector, false);
      if (!result.success) {
         return `Error en scraping stealth: ${result.error}`;
      }
      return JSON.stringify(result.result);
    } catch (error) {
      return `Error crítico: ${(error as Error).message}`;
    }
  }
};
