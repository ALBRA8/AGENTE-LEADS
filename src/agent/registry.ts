// ============================================================
// src/agent/registry.ts
// Central tool registry – add new tools here
// ============================================================

import type { Tool } from "./types.js";
import { getCurrentTime } from "./tools/get_current_time.js";
import { scrapeInstagramLeads } from "./tools/scrape_instagram_leads.js";
import { verifyEmail } from "./tools/verify_email.js";
import { saveLead } from "./tools/save_lead.js";
import { enrichLeadProfile } from "./tools/enrich_lead_profile.js";
import { scrapeStealth } from "./tools/scrape_stealth.js";
import { runLeadPipelineTool } from "./tools/run_lead_pipeline.js";
import { runOutreachTool } from "./tools/run_outreach.js";

// ── Register all available tools ───────────────────────────
const TOOL_REGISTRY: Tool[] = [
  getCurrentTime,
  // ── V2 orchestrator tools (P0.9 + P2.4) ────────────────────────
  runLeadPipelineTool,
  runOutreachTool,
  // ── Legacy tools (kept for backward compatibility) ────────────────
  scrapeInstagramLeads,
  verifyEmail,
  saveLead,
  enrichLeadProfile,
  scrapeStealth
];

export function getAllTools(): Tool[] {
  return TOOL_REGISTRY;
}

export async function executeToolByName(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const tool = TOOL_REGISTRY.find(
    (t) => t.definition.function.name === name
  );

  if (!tool) {
    return `Herramienta desconocida: "${name}". Las herramientas disponibles son: ${TOOL_REGISTRY.map(
      (t) => t.definition.function.name
    ).join(", ")}.`;
  }

  return tool.execute(args);
}
