// ============================================================
// src/lib/ai/client.ts — NVIDIA NIM GLM 5.3 Flash client
// P3: unified with AGENTE-LEADS V2 — same LLM, same model
// ============================================================

import OpenAI from "openai";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL = "z-ai/glm-5.3-flash";
const MAX_TOKENS = 4096;
const TEMPERATURE = 0.5;
const TIMEOUT_MS = 120_000;

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey || apiKey.includes("your")) {
      throw new Error("NVIDIA_API_KEY not configured — add it to .env");
    }
    _client = new OpenAI({
      baseURL: NVIDIA_BASE_URL,
      apiKey,
      timeout: TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  return _client;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Send a chat completion to GLM 5.3 Flash via NVIDIA NIM.
 * Returns the text content of the assistant's response.
 */
export async function aiChat(messages: ChatMessage[]): Promise<string> {
  const client = getClient();
  const res = await client.chat.completions.create({
    model: NVIDIA_MODEL,
    messages,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
  });
  const content = res?.choices?.[0]?.message?.content;
  if (!content) throw new Error("GLM 5.3 Flash returned empty response");
  return content;
}

/**
 * Send a chat completion with tools (function calling).
 * Returns the full response so the caller can inspect tool_calls.
 */
export async function aiChatWithTools(
  messages: ChatMessage[],
  tools: any[]
): Promise<any> {
  const client = getClient();
  const res = await client.chat.completions.create({
    model: NVIDIA_MODEL,
    messages,
    tools,
    tool_choice: "auto",
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
  });
  return res;
}

export const AI_MODEL = NVIDIA_MODEL;
export { getClient as getNvidiaClient };

// ── Backward compat: z-ai-web-dev-sdk client for page_reader/web_search ──
// (used by freshness-checker, tech-stack-detector, web-search-adapter)
import ZAI from "z-ai-web-dev-sdk";

let _zaiClient: Awaited<ReturnType<typeof ZAI.create>> | null = null;

export async function getAIClient() {
  if (!_zaiClient) {
    _zaiClient = await ZAI.create();
  }
  return _zaiClient;
}
