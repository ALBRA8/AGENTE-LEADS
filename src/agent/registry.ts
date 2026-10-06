// ============================================================
// src/agent/registry.ts
// Central tool registry – add new tools here.
//
// PRODUCTION CLOSURE §17: every tool is registered WITH its explicit
// contract. enforceContract wraps execute() with:
//   - SSRF guard for EXTERNAL url arguments
//   - hard timeout (contract.timeout_ms)
//   - audit trail (tool_audit table)
// Tool definitions (LLM-facing) are unchanged.
// ============================================================

import type { Tool } from "./types.js";
import { enforceContract } from "./core/tool_contract.js";
import { CONTRACTS } from "./tools/contracts.js";
import { getCurrentTime } from "./tools/get_current_time.js";
import { scrapeInstagramLeads } from "./tools/scrape_instagram_leads.js";
import { verifyEmail } from "./tools/verify_email.js";
import { saveLead } from "./tools/save_lead.js";
import { enrichLeadProfile } from "./tools/enrich_lead_profile.js";
import { scrapeStealth } from "./tools/scrape_stealth.js";
import { runLeadPipelineTool } from "./tools/run_lead_pipeline.js";
import { runOutreachTool } from "./tools/run_outreach.js";

/** Attach a contract to a tool by name (keeps definition, wraps execute). */
function contractTool(tool: Tool): Tool {
  const name = tool.definition.function.name;
  const contract = CONTRACTS[name];
  if (!contract) {
    // A tool without a contract is a closure-spec violation — fail loud.
    throw new Error(`[Registry] tool "${name}" has no §17 contract`);
  }
  return {
    definition: tool.definition,
    execute: enforceContract(contract, (args) => tool.execute(args)),
  };
}

// ── Register all available tools ───────────────────────────
const TOOL_REGISTRY: Tool[] = [
  contractTool(getCurrentTime),
  // ── V2 orchestrator tools (P0.9 + P2.4) ────────────────────────
  contractTool(runLeadPipelineTool),
  contractTool(runOutreachTool),
  // ── Legacy tools (kept for backward compatibility) ────────────────
  contractTool(scrapeInstagramLeads),
  contractTool(verifyEmail),
  contractTool(saveLead),
  contractTool(enrichLeadProfile),
  contractTool(scrapeStealth),
];

export function getAllTools(): Tool[] {
  return TOOL_REGISTRY;
}

export function getToolContract(name: string) {
  return CONTRACTS[name] ?? null;
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
