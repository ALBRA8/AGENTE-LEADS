// ============================================================
// src/agent/types.ts
// Shared type definitions for the agent layer
// ============================================================

import type { ChatCompletionTool } from "openai/resources/chat/completions.js";

export interface Tool {
  /** Function definition that will be sent to the LLM */
  definition: ChatCompletionTool;
  /** Handler that receives parsed args and returns a result string */
  execute(args: Record<string, unknown>): Promise<string>;
}

export interface AgentInput {
  userId: string;
  userMessage: string;
  /** Pre-transcribed text when input came from audio */
  transcription?: string;
}

export interface AgentOutput {
  response: string;
  /** How many tool iterations were used in this turn */
  iterations: number;
}
