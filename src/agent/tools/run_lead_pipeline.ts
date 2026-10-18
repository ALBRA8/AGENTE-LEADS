// ============================================================
// src/agent/tools/run_lead_pipeline.ts
// P0.9 — Tool that runs the full deterministic lead pipeline.
//
// The LLM calls this when it needs to find leads. The tool executes:
//   DISCOVERY → RESEARCH → VALIDATION → EVIDENCE → DEDUPLICATION → STORAGE → REPORT
//
// The LLM does NOT need to call individual pipeline steps. It expresses
// the intent and the orchestrator does the rest.
// ============================================================

import type { Tool } from "../types.js";
import { runLeadPipeline } from "../pipelines/orchestrator.js";
import { buildProviderRegistry } from "../providers/registry.js";

export const runLeadPipelineTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "run_lead_pipeline",
      description:
        "Ejecuta el pipeline completo de prospección de leads de forma determinística: " +
        "DESCUBRIR → INVESTIGAR → VALIDAR → RECOPILAR EVIDENCIA → DEDUPLICAR → GUARDAR → REPORTAR. " +
        "Úsalo cuando el usuario quiera encontrar leads (negocios, perfiles, contactos). " +
        "Devuelve un reporte TOP LEADS con los mejores candidatos, indicando para cada campo " +
        "si el dato fue observado, validado, inferido o no encontrado. " +
        "Los proveedores externos (Apify, Scrapling, email verifier) se usan si están configurados; " +
        "si no, se usa el MockDiscovery provider para que el pipeline siga funcionando.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Qué buscar (ej. 'restaurantes veganos', 'clínicas de estética', 'fotógrafos')"
          },
          location: {
            type: "string",
            description: "Ciudad o zona (ej. 'Medellín', 'Bogotá')"
          },
          niche: {
            type: "string",
            description: "Nicho opcional para refinar (ej. 'vegano', 'medicina estética')"
          },
          platform: {
            type: "string",
            description: "Plataforma objetivo opcional (ej. 'instagram', 'google_search')"
          },
          min_followers: {
            type: "number",
            description: "Filtro opcional: mínimo de seguidores que debe tener el candidato"
          },
          top_n: {
            type: "number",
            description: "Número máximo de leads a incluir en el reporte top (default 10)"
          }
        },
        required: ["query"]
      }
    }
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const intent = {
      query: String(args.query ?? ""),
      location: args.location ? String(args.location) : undefined,
      niche: args.niche ? String(args.niche) : undefined,
      platform: args.platform ? String(args.platform) : undefined,
      min_followers: typeof args.min_followers === "number" ? args.min_followers : undefined,
      top_n: typeof args.top_n === "number" ? args.top_n : 10,
    };

    // Build providers — uses real Apify/Scrapling/RapidEmail if configured
    // OR falls back to MockDiscovery if Apify is not available.
    const providers = buildProviderRegistry();

    try {
      const result = await runLeadPipeline(intent, providers);
      return (
        `${result.report_text}\n\n` +
        `---\n` +
        `**Resumen de ejecución:**\n` +
        `- Candidates descubiertos: ${result.candidates_count}\n` +
        `- Investigados: ${result.researched_count}\n` +
        `- Validados: ${result.validated_count}\n` +
        `- Almacenados: ${result.stored_count}\n` +
        `- Outcome: ${result.outcome}\n` +
        `- Execution ID: ${result.execution_id}\n`
      );
    } catch (e: any) {
      return `Error ejecutando pipeline: ${e.message}`;
    }
  },
};
