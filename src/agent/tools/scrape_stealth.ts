// ============================================================
// src/agent/tools/scrape_stealth.ts
//
// FIXED (P0 auditoría): la descripción anterior afirmaba "evade
// Cloudflare/Akamai", lo cual es un overclaim. Scrapling es un
// fetcher con fingerprint de navegador, NO un bypass de CAPTCHAs
// ni de sistemas anti-bot. Corregida.
//
// Esta tool delega en el `ScraplingScrapingProvider` (V2 provider
// abstraction) pero mantiene la interfaz legacy para no romper
// `loop.ts` y `registry.ts` existentes.
// ============================================================

import { Tool } from "../types.js";
import { runStealthScraper } from "../utils/python_bridge.js";

export const scrapeStealth: Tool = {
  definition: {
    type: "function",
    function: {
      name: "scrape_stealth",
      description:
        "Visita una URL y extrae su contenido usando Scrapling " +
        "(fetcher de Python con fingerprint de navegador headless). " +
        "Útil para extraer texto visible, emails y enlaces sociales de perfiles " +
        "individuales o páginas web estáticas. " +
        "Es un fetcher estándar — no es un bypass anti-bot ni resuelve CAPTCHAs. " +
        "Si el sitio bloquea la petición, devuelve PROVIDER_UNAVAILABLE. " +
        "Requiere que el venv de Python con scrapling esté configurado (.venv/bin/python).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL completa a visitar (ej. https://www.instagram.com/usuario/)" },
          selector: { type: "string", description: "Opcional. Selector CSS para extraer un dato específico (ej. 'header h1'). Si se omite, extrae texto + emails + links sociales." }
        },
        required: ["url"]
      }
    }
  },
  async execute({ url, selector }) {
    const urlStr = typeof url === "string" ? url : String(url ?? "");
    const selectorStr = typeof selector === "string" ? selector : undefined;
    try {
      const result = await runStealthScraper(urlStr, selectorStr, false);
      if (!result.success) {
         return `Error en scraping: ${result.error}`;
      }
      return JSON.stringify(result.result);
    } catch (error) {
      return `Error crítico: ${(error as Error).message}`;
    }
  }
};
