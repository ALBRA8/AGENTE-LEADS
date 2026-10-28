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
import { assertPublicUrl } from "./core/ssrf_guard.js";
import { recordToolAudit } from "./storage/agent_infra.js";
import type { ToolContract, ToolPermission } from "./core/tool_contract.js";

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

  const start = Date.now();

  // §17: SSRF guard for EXTERNAL tools with url_args
  const contract = getToolContract(name);
  if (contract && contract.permissions.includes("EXTERNAL") && contract.url_args) {
    for (const argName of contract.url_args) {
      const val = args[argName];
      if (typeof val === "string") {
        const check = assertPublicUrl(val);
        if (!check.ok) {
          // Audit the SSRF rejection
          try { recordToolAudit({ tool_name: name, args_summary: JSON.stringify(args).substring(0, 200), status: "failed", error_type: check.error.type, duration_ms: 0, execution_note: "SSRF blocked" }); } catch {}
          return `SSRF guard rejected: ${check.error.message}`;
        }
      }
    }
  }

  try {
    const result = await tool.execute(args);
    const duration = Date.now() - start;
    // Audit successful execution
    try { recordToolAudit({ tool_name: name, args_summary: JSON.stringify(args).substring(0, 200), status: "ok", duration_ms: duration }); } catch {}
    return result;
  } catch (e: any) {
    const duration = Date.now() - start;
    try { recordToolAudit({ tool_name: name, args_summary: JSON.stringify(args).substring(0, 200), status: "failed", error_type: "EXECUTION_ERROR", duration_ms: duration, execution_note: e.message }); } catch {}
    return `Error: ${e.message}`;
  }
}

// ── PRODUCTION CLOSURE §17: Tool Contracts ───────────────
// Each tool has a contract declaring permissions, risk, timeout, etc.

const TOOL_CONTRACTS: Record<string, ToolContract> = {
  "run_lead_pipeline": {
    id: "run_lead_pipeline", name: "run_lead_pipeline",
    purpose: "Execute the full lead pipeline: discover → research → validate → score → store",
    input_schema: { query: "string", location: "string?", niche: "string?" },
    output_schema: { report_text: "string", found: "number" },
    permissions: ["READ", "EXTERNAL"],
    risk: "medium",
    side_effects: ["writes leads to DB"],
    timeout_ms: 300_000,
    retry_policy: { max_attempts: 1, backoff: "none" },
    evidence_behavior: "records all found data as evidence",
    audit_behavior: "always",
    url_args: [],
  },
  "run_outreach": {
    id: "run_outreach", name: "run_outreach",
    purpose: "Generate proposals and send via email/WhatsApp",
    input_schema: { offer_description: "string", dry_run: "boolean?" },
    output_schema: { sent: "number", failed: "number" },
    permissions: ["READ", "WRITE", "EXTERNAL", "SENSITIVE"],
    risk: "high",
    side_effects: ["sends real emails/WhatsApp messages when dry_run=false"],
    timeout_ms: 120_000,
    retry_policy: { max_attempts: 1, backoff: "none" },
    evidence_behavior: "records outreach_sent evidence",
    audit_behavior: "always",
    url_args: [],
  },
  "get_current_time": {
    id: "get_current_time", name: "get_current_time",
    purpose: "Returns current date/time",
    input_schema: { timezone: "string?" },
    output_schema: { time: "string" },
    permissions: ["READ"],
    risk: "low",
    side_effects: [],
    timeout_ms: 5_000,
    retry_policy: { max_attempts: 1, backoff: "none" },
    evidence_behavior: "none",
    audit_behavior: "none",
  },
  "scrape_instagram_leads": {
    id: "scrape_instagram_leads", name: "scrape_instagram_leads",
    purpose: "Search Google for Instagram profiles with emails (legacy)",
    input_schema: { query: "string" },
    output_schema: { results: "raw JSON" },
    permissions: ["READ", "EXTERNAL"],
    risk: "medium",
    side_effects: [],
    timeout_ms: 60_000,
    retry_policy: { max_attempts: 2, backoff: "exponential" },
    evidence_behavior: "none",
    audit_behavior: "always",
    url_args: [],
  },
  "verify_email": {
    id: "verify_email", name: "verify_email",
    purpose: "Verify email validity",
    input_schema: { email: "string" },
    output_schema: { valid: "boolean" },
    permissions: ["READ", "EXTERNAL"],
    risk: "low",
    side_effects: [],
    timeout_ms: 15_000,
    retry_policy: { max_attempts: 2, backoff: "exponential" },
    evidence_behavior: "records email_validation evidence",
    audit_behavior: "always",
    url_args: [],
  },
  "save_lead": {
    id: "save_lead", name: "save_lead",
    purpose: "Save a lead to local SQLite (legacy)",
    input_schema: { username: "string", email: "string" },
    output_schema: { ok: "boolean" },
    permissions: ["READ", "WRITE"],
    risk: "low",
    side_effects: ["writes to leads table"],
    timeout_ms: 5_000,
    retry_policy: { max_attempts: 1, backoff: "none" },
    evidence_behavior: "none",
    audit_behavior: "always",
    url_args: [],
  },
  "enrich_lead_profile": {
    id: "enrich_lead_profile", name: "enrich_lead_profile",
    purpose: "Enrich lead with Google Search results (legacy)",
    input_schema: { username: "string", niche: "string" },
    output_schema: { found_info: "raw JSON" },
    permissions: ["READ", "EXTERNAL"],
    risk: "medium",
    side_effects: [],
    timeout_ms: 30_000,
    retry_policy: { max_attempts: 2, backoff: "exponential" },
    evidence_behavior: "none",
    audit_behavior: "always",
    url_args: [],
  },
  "scrape_stealth": {
    id: "scrape_stealth", name: "scrape_stealth",
    purpose: "Fetch a URL with Scrapling (Python, SSRF-guarded)",
    input_schema: { url: "string", selector: "string?" },
    output_schema: { text: "string", emails: "string[]" },
    permissions: ["READ", "EXTERNAL"],
    risk: "medium",
    side_effects: [],
    timeout_ms: 60_000,
    retry_policy: { max_attempts: 1, backoff: "none" },
    evidence_behavior: "none",
    audit_behavior: "always",
    url_args: ["url"],
  },
};

/** §17: Get the contract for a registered tool by name */
export function getToolContract(toolName: string): ToolContract | undefined {
  return TOOL_CONTRACTS[toolName];
}
