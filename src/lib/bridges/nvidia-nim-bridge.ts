// ============================================================
// src/lib/bridges/nvidia-nim-bridge.ts — NVIDIA NIM bridge (FASE 3)
// Wraps the NVIDIA NIM client (GLM 5.3 Flash) as a IBridge.
// This is the PRIMARY bridge — replaces direct nvidiaNIMClient calls.
// ============================================================

import { IBridge, BridgeResult, BridgeHealth } from './types.js';
import OpenAI from 'openai';

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_MODEL = 'z-ai/glm-5.3-flash';
const MAX_TOKENS = 4096;
const TIMEOUT_MS = 120_000;

export class NvidiaNimBridge implements IBridge {
  readonly type = 'nvidia-nim';
  readonly name = 'NVIDIA NIM (GLM 5.3 Flash)';
  private client: OpenAI | null = null;

  async isAvailable(): Promise<boolean> {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey || apiKey.includes("your") || apiKey.startsWith('nvapi-xxx')) {
      return false;
    }
    if (!this.client) {
      this.client = new OpenAI({
        baseURL: NVIDIA_BASE_URL,
        apiKey,
        timeout: TIMEOUT_MS,
        maxRetries: 0,
      });
    }
    return true;
  }

  async execute(operation: string, params: Record<string, unknown>): Promise<BridgeResult> {
    if (!this.client) {
      const available = await this.isAvailable();
      if (!available) return { success: false, error: 'NVIDIA NIM not available', source: this.type };
    }
    try {
      switch (operation) {
        case 'chat': {
          const messages = params.messages as any[];
          const temperature = (params.temperature as number) ?? 0.5;
          const maxTokens = (params.max_tokens as number) ?? MAX_TOKENS;
          const tools = params.tools as any[] | undefined;

          const res = await this.client!.chat.completions.create({
            model: NVIDIA_MODEL,
            messages,
            temperature,
            max_tokens: maxTokens,
            ...(tools ? { tools, tool_choice: 'auto' } : {}),
          });

          return { success: true, data: res, source: this.type };
        }
        case 'health': {
          return { success: true, data: { model: NVIDIA_MODEL, status: 'ok' }, source: this.type };
        }
        default:
          return { success: false, error: `Unknown operation: ${operation}`, source: this.type };
      }
    } catch (error: any) {
      return { success: false, error: error.message, source: this.type };
    }
  }

  async healthCheck(): Promise<BridgeHealth> {
    const available = await this.isAvailable();
    return {
      available,
      details: { type: this.type, model: NVIDIA_MODEL, baseUrl: NVIDIA_BASE_URL },
    };
  }
}
