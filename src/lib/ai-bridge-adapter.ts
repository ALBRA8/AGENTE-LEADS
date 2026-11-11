// ============================================================
// src/lib/ai-bridge-adapter.ts — FASE 8 (LIPO)
//
// Bridge-aware AI chat function. Routes LLM calls through the
// harness BridgeRegistry when available, falls back to direct
// nvidiaNIMClient when the harness is not initialized.
//
// This is the compatibility layer that lets existing pipeline
// code (loop.ts, intelligence.ts, outreach.ts) use the bridge
// WITHOUT a full rewrite.
// ============================================================

import { getHarness } from "./bootstrap.js";
import { nvidiaNIMClient, NVIDIA_CONFIG, withRetry } from "../config/nvidia.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  toolCalls?: any[];
  raw?: any;
}

/**
 * Send a chat completion through the harness bridge (preferred)
 * or fall back to direct NVIDIA NIM client (compatibility).
 *
 * When the harness is initialized:
 *   aiChatViaBridge({ messages, tools }) → bridges.execute('chat', ...) → NvidiaNimBridge
 *
 * When the harness is NOT initialized:
 *   aiChatViaBridge({ messages, tools }) → nvidiaNIMClient.chat.completions.create()
 */
export async function aiChatViaBridge(params: {
  messages: ChatMessage[];
  tools?: any[];
  temperature?: number;
  max_tokens?: number;
}): Promise<ChatResult> {
  const { messages, tools, temperature, max_tokens } = params;

  // ── Try harness bridge first ──────────────────────────────
  const harness = getHarness();
  if (harness) {
    const result = await harness.bridges.execute("chat", {
      messages,
      tools,
      temperature: temperature ?? 0.5,
      max_tokens: max_tokens ?? NVIDIA_CONFIG.maxTokens,
    });

    if (result.success && result.data) {
      const res = result.data as any;
      const choice = res?.choices?.[0];
      if (choice) {
        return {
          content: choice.message?.content ?? "",
          toolCalls: choice.message?.tool_calls,
          raw: res,
        };
      }
    }
    // Bridge failed — fall through to direct client
    console.warn("[aiBridge] bridge failed, falling back to direct NVIDIA NIM:", result.error);
  }

  // ── Fallback: direct NVIDIA NIM client ───────────────────
  return await withRetry(async () => {
    const res = await nvidiaNIMClient.chat.completions.create({
      model: NVIDIA_CONFIG.model,
      messages,
      temperature: temperature ?? NVIDIA_CONFIG.temperature,
      max_tokens: max_tokens ?? NVIDIA_CONFIG.maxTokens,
      ...(tools ? { tools, tool_choice: "auto" } : {}),
    });

    const choice = res?.choices?.[0];
    if (!choice) throw new Error("Empty response from NVIDIA NIM");

    return {
      content: choice.message?.content ?? "",
      toolCalls: choice.message?.tool_calls,
      raw: res,
    };
  }, "aiChatViaBridge");
}

/**
 * Simple text chat — convenience wrapper for when you don't need
 * tool calls. Returns just the text content.
 */
export async function aiChatViaBridgeText(messages: ChatMessage[]): Promise<string> {
  const result = await aiChatViaBridge({ messages });
  if (!result.content) throw new Error("AI returned empty response");
  return result.content;
}
