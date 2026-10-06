// ============================================================
// src/agent/health.ts
// Production health check — answers "is the system operational?"
//
// Used by:
//   - the Telegram /health command (to be wired in src/index.ts)
//   - stdout logging on boot
//   - future /healthz HTTP endpoint
//
// Design:
//   - Pure read-only — never mutates state.
//   - No network calls (we do not ping NVIDIA NIM here; that's a
//     separate deep probe). We just check that the API key is
//     configured.
//   - Returns a typed HealthCheck object that's easy to serialize
//     and a separate formatter for human-readable output.
// ============================================================

import { checkStorageHealth, getDb } from "./storage/lead_intelligence.js";
import { NVIDIA_CONFIG } from "../config/nvidia.js";
import fs from "fs";
import path from "path";

export interface HealthCheck {
  status: "ok" | "degraded" | "down";
  timestamp: string;
  components: {
    nvidia_api_key: "configured" | "missing";
    nvidia_model: string;
    telegram_bot_token: "configured" | "missing";
    apify_token: "configured" | "missing" | "optional";
    sendgrid: "configured" | "missing" | "optional";
    whatsapp: "configured" | "missing" | "optional";
    crm_albra_webhook: "configured" | "missing" | "optional";
    conversations_db: { ok: boolean; path: string; size_bytes: number };
    lead_intelligence_db: { ok: boolean; path: string; tables: string[]; leads_count: number };
    python_venv: { ok: boolean; path: string };
  };
  uptime_seconds: number;
}

const startedAt = Date.now();

export function checkHealth(): HealthCheck {
  const convDbPath = process.env.DB_PATH ?? "./data/agente-leads.db";
  const leadsDbPath = process.env.LEADS_DB_PATH ?? "./data/lead-intelligence.db";

  // Check conversations DB
  let convDbOk = false;
  let convDbSize = 0;
  try {
    if (fs.existsSync(convDbPath)) {
      const stat = fs.statSync(convDbPath);
      convDbOk = true;
      convDbSize = stat.size;
    }
  } catch {}

  // Check lead intelligence DB
  let leadsHealth: { ok: boolean; tables: string[]; dbPath: string };
  let leadsCount = 0;
  try {
    leadsHealth = checkStorageHealth();
    // Use a COUNT(*) query directly rather than getAllLeads(N).getAll().length,
    // because materializing all leads creates one prepared statement per lead
    // (for the per-lead evidence lookup inside rowToLead). With 30+ leads that
    // is 30+ statements per call; across multiple health checks V8 GC can
    // finalize them after the env is torn down, hitting the better-sqlite3 +
    // Node 24 "RemoveEnvironmentCleanupHook: (env) != nullptr" crash.
    // COUNT(*) needs exactly one statement regardless of row count.
    const row = getDb()
      .prepare("SELECT COUNT(*) AS c FROM lead_intelligence_leads")
      .get() as { c: number } | undefined;
    leadsCount = row?.c ?? 0;
  } catch {
    leadsHealth = { ok: false, tables: [], dbPath: leadsDbPath };
  }

  // Check Python venv (Scrapling scraper — optional)
  const isWindows = process.platform === "win32";
  const pythonExe = path.resolve(
    process.cwd(),
    ".venv",
    isWindows ? "Scripts" : "bin",
    "python"
  );
  const pythonVenvOk = fs.existsSync(pythonExe);

  // Determine env-var presence. Tokens that are still placeholders
  // (contain "your" or "placeholder") are treated as missing.
  const hasNvidiaKey = Boolean(
    process.env.NVIDIA_API_KEY && !process.env.NVIDIA_API_KEY.includes("your")
  );
  const hasTelegramToken = Boolean(
    process.env.TELEGRAM_BOT_TOKEN &&
      !process.env.TELEGRAM_BOT_TOKEN.includes("placeholder")
  );
  const hasApifyToken = Boolean(
    process.env.APIFY_TOKEN && !process.env.APIFY_TOKEN.includes("your")
  );
  const hasSendgrid = Boolean(
    process.env.SENDGRID_API_KEY && !process.env.SENDGRID_API_KEY.includes("your")
  );
  const hasWhatsapp = Boolean(
    process.env.WHATSAPP_TOKEN && !process.env.WHATSAPP_TOKEN.includes("your")
  );
  const hasCrmWebhook = Boolean(process.env.CRM_ALBRA_WEBHOOK_URL);

  // Overall status: LLM + Telegram are HARD requirements; DBs are soft
  // (degraded, not down, because the agent may still start and surface
  // a useful error to the user).
  let status: "ok" | "degraded" | "down" = "ok";
  if (!hasNvidiaKey) status = "down"; // can't function without LLM
  else if (!hasTelegramToken) status = "down"; // can't function without Telegram
  else if (!leadsHealth.ok || !convDbOk) status = "degraded";

  return {
    status,
    timestamp: new Date().toISOString(),
    components: {
      nvidia_api_key: hasNvidiaKey ? "configured" : "missing",
      nvidia_model: NVIDIA_CONFIG.model,
      telegram_bot_token: hasTelegramToken ? "configured" : "missing",
      apify_token: hasApifyToken ? "configured" : "optional",
      sendgrid: hasSendgrid ? "configured" : "optional",
      whatsapp: hasWhatsapp ? "configured" : "optional",
      crm_albra_webhook: hasCrmWebhook ? "configured" : "optional",
      conversations_db: { ok: convDbOk, path: convDbPath, size_bytes: convDbSize },
      lead_intelligence_db: {
        ok: leadsHealth.ok,
        path: leadsHealth.dbPath,
        tables: leadsHealth.tables,
        leads_count: leadsCount,
      },
      python_venv: { ok: pythonVenvOk, path: pythonExe },
    },
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
  };
}

/**
 * Format health check as human-readable text (for Telegram /health command
 * or for stdout logging).
 */
export function formatHealth(h: HealthCheck): string {
  const emoji =
    h.status === "ok" ? "✅" : h.status === "degraded" ? "⚠️" : "❌";
  const lines: string[] = [
    `${emoji} AGENTE LEADS — Health: ${h.status.toUpperCase()}`,
    ``,
    `Uptime: ${h.uptime_seconds}s`,
    `LLM: ${h.components.nvidia_model} (${h.components.nvidia_api_key})`,
    `Telegram: ${h.components.telegram_bot_token}`,
    `Apify: ${h.components.apify_token}`,
    `SendGrid: ${h.components.sendgrid}`,
    `WhatsApp: ${h.components.whatsapp}`,
    `CRM-ALBRA webhook: ${h.components.crm_albra_webhook}`,
    ``,
    `Conversations DB: ${h.components.conversations_db.ok ? "✅" : "❌"} (${h.components.conversations_db.path}, ${h.components.conversations_db.size_bytes} bytes)`,
    `Lead intelligence DB: ${h.components.lead_intelligence_db.ok ? "✅" : "❌"} (${h.components.lead_intelligence_db.path}, ${h.components.lead_intelligence_db.leads_count} leads)`,
    `Python venv (Scrapling): ${h.components.python_venv.ok ? "✅" : "❌ (optional)"}`,
  ];
  return lines.join("\n");
}
