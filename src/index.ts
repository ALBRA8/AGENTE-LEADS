// ============================================================
// src/index.ts
// AGENTE LEADS – Entry point
// ============================================================

import "dotenv/config";
import { bot } from "./bot/telegram.js";

const AGENT_NAME = process.env.AGENT_NAME ?? "AGENTE LEADS";

async function main() {
  console.log(`
╔═══════════════════════════════════════╗
║        ${AGENT_NAME.padEnd(31)} ║
║   Kimi K2.5 · NVIDIA NIM · grammy     ║
╚═══════════════════════════════════════╝
`);

  console.log("[Boot] 🗄️  Database initialized (SQLite WAL mode)");
  console.log("[Boot] 🤖 Starting Telegram bot (Long Polling)…");

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
