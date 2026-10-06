// ============================================================
// src/bot/telegram_helpers.ts
// Helpers for the Telegram bot — splitting long messages, formatting,
// inline keyboards, /stats and /help commands.
//
// IMPORTANT: do NOT import grammy here. These are pure functions that
// the existing telegram.ts (or future versions) can call. They return
// strings or simple data structures.
// ============================================================

import { getAllLeads, checkStorageHealth, getExecution } from "../agent/storage/lead_intelligence.js";
import type { Lead } from "../agent/core/lead.js";

/** Telegram message limit — 4096 chars per message */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/**
 * Split a long message into chunks that fit Telegram's 4096 char limit.
 * Tries to split on paragraph boundaries first, then sentence boundaries,
 * then falls back to hard character splits.
 */
export function splitMessage(text: string, maxLen = TELEGRAM_MAX_MESSAGE_LENGTH - 100): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split on a paragraph boundary
    let cutAt = remaining.lastIndexOf("\n\n", maxLen);
    if (cutAt < maxLen / 2) {
      // Try sentence boundary
      cutAt = remaining.lastIndexOf(". ", maxLen);
    }
    if (cutAt < maxLen / 2) {
      // Try line boundary
      cutAt = remaining.lastIndexOf("\n", maxLen);
    }
    if (cutAt < maxLen / 2) {
      // Hard split — no boundary char to include, slice exactly maxLen.
      // (We cannot use cutAt + 1 here because that would give maxLen + 1 chars.)
      chunks.push(remaining.slice(0, maxLen).trim());
      remaining = remaining.slice(maxLen).trim();
      continue;
    }
    chunks.push(remaining.slice(0, cutAt + 1).trim());
    remaining = remaining.slice(cutAt + 1).trim();
  }
  return chunks;
}

/**
 * Escape Markdown special chars for Telegram's MarkdownV2 parser.
 * (Telegram requires these to be escaped: _ * [ ] ( ) ~ ` > # + - = | { } . !)
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Format a Lead as a short Telegram-friendly one-liner.
 */
export function formatLeadSummary(lead: Lead): string {
  const score = lead.lead_score ?? "n/a";
  const email = lead.email ? "✉️" : "❌";
  const website = lead.website ? "🌐" : "❌";
  const phone = lead.phone ? "📞" : "❌";
  return `• ${lead.name} — score ${score}/100 ${email}${website}${phone}`;
}

/**
 * Build the /help command response.
 */
export function buildHelpText(): string {
  return [
    "🤖 *AGENTE LEADS — Comandos disponibles*",
    "",
    "*/start* — Mensaje de bienvenida",
    "*/help* — Esta ayuda",
    "*/stats* — Estadísticas del sistema (leads almacenados, ejecuciones)",
    "*/clear* — Borra tu historial de conversación",
    "*/memory* — Muestra lo que el agente recuerda de ti",
    "",
    "Puedes escribir en lenguaje natural:",
    "• \"Busca restaurantes veganos en Medellín con más de 5000 seguidores\"",
    "• \"Genera propuestas para los top 5 leads\"",
    "• \"Muéstrame el dashboard\"",
    "",
    "El agente decidirá automáticamente qué herramientas invocar.",
  ].join("\n");
}

/**
 * Build the /stats command response.
 * Reads from the lead_intelligence DB and reports:
 *   - total leads stored
 *   - leads with email/website/phone (coverage)
 *   - average lead score
 *   - executions table health
 */
export function buildStatsText(): string {
  // Tolerant of DB errors (e.g. when called in tests without setupTestEnv)
  let leads: any[] = [];
  let health: any = { dbPath: "n/a", tables: [], ok: false };
  try { leads = getAllLeads(1000); } catch {}
  try { health = checkStorageHealth(); } catch {}
  const total = leads.length;
  const withEmail = leads.filter((l) => l.email).length;
  const withWebsite = leads.filter((l) => l.website).length;
  const withPhone = leads.filter((l) => l.phone).length;
  const scored = leads.filter((l) => l.lead_score !== undefined);
  const avgScore = scored.length > 0
    ? Math.round(scored.reduce((sum, l) => sum + Number(l.lead_score), 0) / scored.length)
    : 0;
  const tierA = leads.filter((l) => (l.lead_score ?? 0) >= 75).length;
  const tierB = leads.filter((l) => {
    const s = Number(l.lead_score ?? 0);
    return s >= 50 && s < 75;
  }).length;

  return [
    "📊 *AGENTE LEADS — Stats*",
    "",
    `*Leads almacenados:* ${total}`,
    `*Con email:* ${withEmail} (${total > 0 ? Math.round(withEmail / total * 100) : 0}%)`,
    `*Con website:* ${withWebsite} (${total > 0 ? Math.round(withWebsite / total * 100) : 0}%)`,
    `*Con phone:* ${withPhone} (${total > 0 ? Math.round(withPhone / total * 100) : 0}%)`,
    "",
    `*Avg Lead Score:* ${avgScore}/100`,
    `*Tier A (>=75):* ${tierA}`,
    `*Tier B (50-74):* ${tierB}`,
    "",
    `*DB:* ${health.dbPath}`,
    `*Tables:* ${health.tables.join(", ")}`,
  ].join("\n");
}

/**
 * Build a quick summary of the latest N executions.
 */
export function buildRecentExecutionsText(limit = 5): string {
  // We don't have a "list executions" function yet, so we just return a hint
  // that this feature is not yet implemented. (Could be added later.)
  return `📋 Recent executions feature coming soon. (limit=${limit})`;
}
