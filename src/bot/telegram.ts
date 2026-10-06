// ============================================================
// src/bot/telegram.ts
// Telegram bot de AGENTE LEADS usando grammy – Long Polling
// ============================================================

import { Bot, Context, InputFile } from "grammy";
import path from "path";
import fs from "fs";
import { runAgentLoop } from "../agent/loop.js";
import { upsertUser } from "../database/sqlite.js";
import dotenv from "dotenv";
import {
  splitMessage,
  buildHelpText,
  buildStatsText,
} from "./telegram_helpers.js";
import { checkHealth, formatHealth } from "../agent/health.js";

dotenv.config({ override: true }); // override: el .env del proyecto gana sobre variables del sistema

// ── Env validation ─────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// FIX (QUAL-C4): catch both placeholder patterns — "AAAAAAAA" and "your_xxx_here"
if (!BOT_TOKEN || BOT_TOKEN.includes("AAAAAAAA") || BOT_TOKEN.includes("your") || BOT_TOKEN.includes("placeholder")) {
  throw new Error(
    "[Telegram] TELEGRAM_BOT_TOKEN is missing or still a placeholder. " +
      "Create a bot via @BotFather and set TELEGRAM_BOT_TOKEN in .env."
  );
}

const ALLOWED_IDS = (process.env.ALLOWED_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

if (ALLOWED_IDS.length === 0) {
  console.warn(
    "[Telegram] ⚠️  ALLOWED_IDS is empty – no user will be able to interact with the bot!"
  );
}

// ── Bot instance ───────────────────────────────────────────
export const bot = new Bot(BOT_TOKEN);

// ── Security middleware: whitelist ─────────────────────────
bot.use(async (ctx: Context, next) => {
  const userId = ctx.from?.id?.toString();

  if (!userId || !ALLOWED_IDS.includes(userId)) {
    console.warn(
      `[Security] Blocked unauthorized user: ${userId ?? "unknown"}`
    );
    await ctx.reply(
      "🚫 No estás autorizado para usar este agente. Contacta al administrador."
    );
    return; // Stop the middleware chain
  }

  // Update user record in DB
  const from = ctx.from!;
  upsertUser(
    userId,
    from.username,
    from.first_name,
    from.last_name
  );

  await next();
});

// ── /start command ─────────────────────────────────────────
bot.command("start", async (ctx) => {
  await ctx.reply(
    `👋 *Hola, soy AGENTE LEADS.*\n\n` +
      `Sistema de prospección inteligente B2B, impulsado por *GLM 5.3 Flash* vía NVIDIA NIM.\n\n` +
      `Puedo descubrir, investigar, validar y puntuar leads automáticamente. ` +
      `Escríbeme en lenguaje natural qué necesitas.\n\n` +
      `Usa /help para ver los comandos disponibles.`,
    { parse_mode: "Markdown" }
  );
});

// ── /clear command – wipe conversation history ─────────────
bot.command("clear", async (ctx) => {
  const userId = ctx.from!.id.toString();
  const db = (await import("../database/sqlite.js")).default;
  db.prepare("DELETE FROM conversations WHERE user_id = ?").run(userId);
  await ctx.reply("🗑️ Historial borrado. Empezamos de cero.");
});

// ── /memory command – show memory fragments ────────────────
bot.command("memory", async (ctx) => {
  const userId = ctx.from!.id.toString();
  const { getMemoryFragments } = await import("../database/sqlite.js");
  const frags = getMemoryFragments(userId);

  if (frags.length === 0) {
    await ctx.reply("🧠 No tengo recuerdos sobre ti todavía.");
    return;
  }

  const lines = frags.map((f) => `• *${f.key}*: ${f.value}`).join("\n");
  await ctx.reply(`🧠 *Mis recuerdos sobre ti:*\n\n${lines}`, {
    parse_mode: "Markdown",
  });
});

// ── /help command – P3: show available commands + examples ──
bot.command("help", async (ctx) => {
  const help = buildHelpText();
  const chunks = splitMessage(help);
  for (const chunk of chunks) {
    await ctx.reply(chunk, { parse_mode: "Markdown" });
  }
});

// ── /stats command – P3: lead intelligence DB stats ─────────
bot.command("stats", async (ctx) => {
  const stats = buildStatsText();
  const chunks = splitMessage(stats);
  for (const chunk of chunks) {
    await ctx.reply(chunk, { parse_mode: "Markdown" });
  }
});

// ── /health command – P3: system health check ───────────────
bot.command("health", async (ctx) => {
  const h = checkHealth();
  await ctx.reply(formatHealth(h), { parse_mode: "Markdown" });
});

// ── Text message handler ───────────────────────────────────
bot.on("message:text", async (ctx) => {
  const userId = ctx.from!.id.toString();
  const text = ctx.message.text;

  // Show typing indicator
  await ctx.replyWithChatAction("typing");

  try {
    const result = await runAgentLoop({
      userId,
      userMessage: text,
    });

    // P3: split long responses to respect Telegram's 4096 char limit
    const chunks = splitMessage(result.response);
    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: "Markdown" });
    }
    console.log(
      `[Bot] ✉️  User ${userId} → ${result.iterations} iterations → replied (${chunks.length} message${chunks.length > 1 ? "s" : ""})`
    );
  } catch (err) {
    console.error("[Bot] Agent error:", err);
    await ctx.reply(
      "⚠️ Tuve un problema procesando tu mensaje. Por favor intenta de nuevo."
    );
  }
});

// ── Voice message handler (middleware placeholder) ─────────
bot.on("message:voice", async (ctx) => {
  const userId = ctx.from!.id.toString();

  await ctx.replyWithChatAction("typing");

  try {
    // ─────────────────────────────────────────────────────────
    // PLACEHOLDER: Download voice → transcribe → agent loop
    // Replace the stub below with a real Whisper/OpenAI call.
    // ─────────────────────────────────────────────────────────
    const voice = ctx.message.voice;
    const fileId = voice.file_id;
    const file = await ctx.api.getFile(fileId);
    const filePath = file.file_path;

    if (!filePath) {
      await ctx.reply("❌ No pude obtener el archivo de audio.");
      return;
    }

    // Download the OGG file
    const audioUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    const tmpDir = "./data/tmp";
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const localPath = path.join(tmpDir, `${userId}_${Date.now()}.ogg`);
    const fetchModule = await import("node-fetch");
    const fetchFn = fetchModule.default;
    const audioRes = await fetchFn(audioUrl);
    const buffer = Buffer.from(await audioRes.arrayBuffer());
    fs.writeFileSync(localPath, buffer);

    // TODO: Call Whisper API here and get transcription text
    // const transcription = await transcribeAudio(localPath);
    const transcription = "[Transcripción de audio no implementada aún]";

    // Pass transcription into the agent loop
    const result = await runAgentLoop({
      userId,
      userMessage: transcription,
      transcription,
    });

    // Clean up temp file
    fs.unlinkSync(localPath);

    await ctx.reply(`🎤 *Transcripción:* ${transcription}\n\n${result.response}`, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("[Bot] Voice handler error:", err);
    await ctx.reply("⚠️ Error procesando la nota de voz.");
  }
});

// ── Graceful error handler ─────────────────────────────────
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[Bot] Error for update ${ctx.update.update_id}:`, err.error);
});
