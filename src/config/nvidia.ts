// ============================================================
// src/config/nvidia.ts
// Configuración del cliente NVIDIA NIM para AGENTE LEADS (GLM 5.3 Flash)
// ============================================================

import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config({ override: true });

// ── Constants ─────────────────────────────────────────────
export const NVIDIA_CONFIG = {
  baseURL: "https://integrate.api.nvidia.com/v1",
  // ── Modelo activo (P1: actualizado a GLM 5.3 Flash) ───────
  // GLM 5.3 Flash es un modelo de razonamiento: genera
  // `reasoning_content` antes de `content`. Requiere max_tokens >= 1000
  // para que tenga espacio tanto para razonar como para responder.
  model: "z-ai/glm-5.3-flash",
  contextWindow: 128_000,
  maxTokens: 4_096,    // bumped from 8_192 to allow reasoning + answer
  temperature: 0.5,
  topP: 1,

  // Retry policy – exponential back-off
  retry: {
    maxAttempts: 3,
    initialDelayMs: 1_000,
    backoffFactor: 2,
  },
} as const;

// ── Validate required env vars ─────────────────────────────
const apiKey = process.env.NVIDIA_API_KEY;
// FIX (QUAL-C3): catch both placeholder patterns — "nvapi-xxx" and "your_xxx_here"
if (!apiKey || apiKey.startsWith("nvapi-xxx") || apiKey.includes("your")) {
  throw new Error(
    "[NVIDIA] NVIDIA_API_KEY está ausente o aún es el placeholder. " +
      "Please fill in your key in the .env file."
  );
}

// ── Singleton client ───────────────────────────────────────
// The openai SDK is used because NVIDIA NIM exposes an OpenAI-compatible API.
export const nvidiaNIMClient = new OpenAI({
  baseURL: NVIDIA_CONFIG.baseURL,
  apiKey,
  defaultHeaders: {
    "User-Agent": "AGENTE-LEADS/1.0 (Node.js; NVIDIA-NIM-Compatible)",
    Accept: "application/json",
  },
  timeout: 120_000,   // 120s — GLM 5.3 Flash reasoning can take 30-60s
  maxRetries: 0,     // We handle retries ourselves (exponential back-off)
});

// ── Exponential retry wrapper ──────────────────────────────
export async function withRetry<T>(
  fn: () => Promise<T>,
  label = "API call"
): Promise<T> {
  const { maxAttempts, initialDelayMs, backoffFactor } = NVIDIA_CONFIG.retry;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRetryable =
        err instanceof Error &&
        (err.message.includes("timeout") ||
          err.message.includes("ECONNRESET") ||
          err.message.includes("502") ||
          err.message.includes("503") ||
          err.message.includes("529"));

      if (!isRetryable || attempt === maxAttempts) break;

      const delayMs = initialDelayMs * Math.pow(backoffFactor, attempt - 1);
      console.warn(
        `[NVIDIA] ${label} attempt ${attempt}/${maxAttempts} failed. ` +
          `Retrying in ${delayMs}ms… (${(err as Error).message})`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
