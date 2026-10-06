// ============================================================
// src/scripts/graceful_shutdown.ts
// Production graceful shutdown — registers handlers for SIGINT/SIGTERM.
//
// Usage (from src/index.ts):
//   import "./scripts/graceful_shutdown.js";
//   // later, if you want to register a cleanup task:
//   import { registerCleanupTask } from "./scripts/graceful_shutdown.js";
//   registerCleanupTask("close-bot", async () => { await bot.stop(); });
//
// Design:
//   - SIGINT/SIGTERM run all registered cleanup tasks in parallel,
//     waiting up to 10s for them to finish before force-exiting.
//   - Second signal forces an immediate exit (Unix convention).
//   - uncaughtException triggers a graceful shutdown so we still try
//     to flush logs / close DBs before dying.
//   - unhandledRejection is logged but does NOT shut down (Node 16+
//     treats it as fatal by default; we override that here so that
//     a flaky async path doesn't kill the bot).
// ============================================================

let shuttingDown = false;
const CLEANUP_TASKS: Array<() => Promise<void>> = [];

/**
 * Register a named cleanup task to be run on shutdown.
 * Tasks are run in parallel; each is awaited independently so one
 * failing task doesn't prevent the others from running.
 */
export function registerCleanupTask(
  name: string,
  fn: () => Promise<void>
): void {
  CLEANUP_TASKS.push(async () => {
    console.log(`[shutdown] running cleanup: ${name}`);
    try {
      await fn();
      console.log(`[shutdown] ✓ ${name} done`);
    } catch (e: any) {
      console.error(`[shutdown] ✗ ${name} failed: ${e.message}`);
    }
  });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    console.log(`[shutdown] already shutting down — forcing exit`);
    process.exit(1);
  }
  shuttingDown = true;
  console.log(`\n[shutdown] received ${signal}, gracefully shutting down...`);

  // Hard cap: if cleanup hangs, force exit after 10s.
  const FORCE_EXIT_MS = 10_000;
  const forceExitTimer = setTimeout(() => {
    console.error(`[shutdown] force exit after ${FORCE_EXIT_MS}ms`);
    process.exit(1);
  }, FORCE_EXIT_MS);

  // Run all cleanup tasks in parallel — each task catches its own errors.
  await Promise.allSettled(CLEANUP_TASKS.map((t) => t()));

  clearTimeout(forceExitTimer);
  console.log(`[shutdown] all cleanup done, exiting`);
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("uncaughtException", (err) => {
  console.error("[shutdown] uncaughtException:", err);
  void shutdown("uncaughtException").catch(() => process.exit(1));
});
process.on("unhandledRejection", (reason) => {
  console.error("[shutdown] unhandledRejection:", reason);
  // don't shut down on rejection — just log. Node 16+ would otherwise
  // terminate the process, which is too aggressive for a long-running bot.
});
