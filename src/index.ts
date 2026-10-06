// ============================================================
// src/index.ts
// AGENTE LEADS – Entry point
// P3: now registers graceful shutdown + health endpoint
// ============================================================

import "dotenv/config";
import { bot } from "./bot/telegram.js";
import { registerCleanupTask } from "./scripts/graceful_shutdown.js";
import { checkHealth, formatHealth } from "./agent/health.js";

const AGENT_NAME = process.env.AGENT_NAME ?? "AGENTE LEADS";

async function main() {
  // ── Print health check at startup ──────────────────────────
  const health = checkHealth();
  console.log(formatHealth(health));
  console.log("");

  if (health.status === "down") {
    console.error("[Boot] ❌ System is DOWN — missing critical config (NVIDIA_API_KEY or TELEGRAM_BOT_TOKEN).");
    console.error("[Boot]    Fill in .env and restart.");
    process.exit(1);
  }
  if (health.status === "degraded") {
    console.warn("[Boot] ⚠️  System is degraded — some optional providers are not configured.");
  }

  console.log(`
╔═══════════════════════════════════════╗
║        ${AGENT_NAME.padEnd(31)} ║
║   GLM 5.3 Flash · NVIDIA NIM · grammy     ║
╚═══════════════════════════════════════╝
`);

  console.log("[Boot] 🗄️  Database initialized (SQLite WAL mode)");
  console.log("[Boot] 🤖 Starting Telegram bot (Long Polling)…");

  // ── Register cleanup tasks for graceful shutdown ────────────
  registerCleanupTask("stop-bot", async () => {
    await bot.stop();
  });

  // Start Long Polling – no webhook, no port config needed
  await bot.start({
    onStart(botInfo) {
      console.log(
        `[Boot] ✅ Bot started: @${botInfo.username} (ID: ${botInfo.id})`
      );
      console.log("[Boot] 🔑 Whitelist active – only allowed users can chat.");
      console.log("[Boot] 🚀 AGENTE LEADS is live and listening!\n");
    },
  });
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
