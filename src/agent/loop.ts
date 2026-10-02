// ============================================================
// src/agent/loop.ts
// Agent Loop – Razonamiento, Herramientas y Respuesta (AGENTE LEADS)
// ============================================================

import type {
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions.js";

import { nvidiaNIMClient, NVIDIA_CONFIG, withRetry } from "../config/nvidia.js";
import {
  saveMessage,
  getRecentMessages,
  getMemoryFragments,
} from "../database/sqlite.js";
import { getAllTools, executeToolByName } from "./registry.js";
import type { AgentInput, AgentOutput, Tool } from "./types.js";

// ── System prompt factory ──────────────────────────────────
function buildSystemPrompt(userId: string): string {
  const memories = getMemoryFragments(userId);
  const memoryBlock =
    memories.length > 0
      ? memories.map((m) => `• [${m.key}]: ${m.value}`).join("\n")
      : "No hay recuerdos previos registrados.";

  return `Eres AGENTE LEADS, el sistema autónomo de prospección inteligente más avanzado. 
Tu objetivo es entregar un Reporte de Ejecución impecable al usuario sobre leads de alta calidad.

## Proceso Autónomo (Self-Healing Workflow)
1. **Extracción Secundaria**: Usa 'scrape_instagram_leads' para buscar. Si devuelve 0 resultados, REINTENTA automáticamente reformulando la consulta.
2. **Extracción Primaria / Profunda (Stealth)**: Si encuentras el enlace de un perfil o web relevante pero no tiene email visible, o si Apify falla, USA INMEDIATAMENTE 'scrape_stealth' con esa URL particular. Está diseñado para evadir bloqueos y encontrar emails o información de contacto oculta.
3. **Normalización**: Limpia los emails antes de verificarlos (ej: cambia [at] por @, elimina espacios).
4. **Verificación**: Valida cada email encontrado. Si no encuentras email pero el perfil es relevante, usa 'enrich_lead_profile'.
5. **Deduplicación**: Guarda el lead usando 'save_lead'. El sistema detectará automáticamente si ya existe.

## Formato del Reporte de Ejecución (Telegram)
Al finalizar, DEBES generar un resumen estructurado:
- 📊 **Resumen**: [X] Encontrados | [Y] Válidos | [Z] Guardados (Nuevos/Actualizados).
- 🛠️ **Estado Técnico**: Notifica si hubo fallos (ej: tokens expirados, errores de red).
- 🚀 **Próximos Pasos**: Sugerencia para mejorar la siguiente búsqueda.

## Reglas de Comportamiento
- Ejecuta procesos en lote siempre que sea posible.
- Sé extremadamente proactivo y autónomo. No preguntes si debes reintentar una búsqueda fallida, hazlo.
- Responde siempre en el idioma del usuario.`;
}

// ── History reconstruction ─────────────────────────────────
function buildHistory(userId: string): ChatCompletionMessageParam[] {
  const rows = getRecentMessages(userId, 20); // 20 rows → ~10 turns
  rows.reverse(); // oldest first

  const messages: ChatCompletionMessageParam[] = [];

  for (const row of rows) {
    if (row.role === "user") {
      messages.push({ role: "user", content: row.content });
    } else if (row.role === "assistant") {
      messages.push({ role: "assistant", content: row.content });
    } else if (row.role === "tool" && row.tool_call_id) {
      const toolMsg: ChatCompletionToolMessageParam = {
        role: "tool",
        tool_call_id: row.tool_call_id,
        content: row.content,
      };
      messages.push(toolMsg);
    }
    // system messages from DB are intentionally omitted – we inject fresh ones
  }

  return messages;
}

// ── Main Agent Loop ────────────────────────────────────────
export async function runAgentLoop(input: AgentInput): Promise<AgentOutput> {
  const { userId, userMessage } = input;
  const maxIterations = Number(process.env.MAX_TOOL_ITERATIONS ?? 10);

  // 1. Persist user turn
  saveMessage(userId, "user", userMessage);

  // 2. Build message array
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(userId) },
    ...buildHistory(userId),
  ];

  const tools = getAllTools();
  let iterations = 0;

  // 3. Agent Loop
  for (let i = 0; i < maxIterations; i++) {
    iterations++;

    const response = await withRetry(
      () =>
        nvidiaNIMClient.chat.completions.create({
          model: NVIDIA_CONFIG.model,
          messages,
          tools: tools.map((t: Tool) => t.definition),
          tool_choice: "auto",
          max_tokens: NVIDIA_CONFIG.maxTokens,
          temperature: NVIDIA_CONFIG.temperature,
          top_p: NVIDIA_CONFIG.topP,
        }),
      `iteration ${i + 1}`
    );

    const choice = response.choices[0];
    if (!choice) throw new Error("[AgentLoop] Empty response from NVIDIA NIM");

    const assistantMessage = choice.message;

    // Append assistant message to context
    messages.push(assistantMessage as ChatCompletionMessageParam);

    // 4a. If finish_reason is 'stop' → we have a final answer
    if (choice.finish_reason === "stop" || !assistantMessage.tool_calls?.length) {
      const finalText = assistantMessage.content ?? "(sin respuesta)";
      saveMessage(userId, "assistant", finalText);
      return { response: finalText, iterations };
    }

    // 4b. Tool calls → execute in parallel and feed results back
    const toolCalls = assistantMessage.tool_calls;

    console.log(`[AgentLoop] ⚡ Orchestrating ${toolCalls.length} tool calls in parallel...`);

    const toolResults = await Promise.all(
      toolCalls.map(async (toolCall) => {
        const fnName = toolCall.function.name;
        let args: Record<string, unknown> = {};

        try {
          args = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          args = {};
        }

        console.log(`[AgentLoop] 🔧 Tool call: ${fnName}`, args);

        let toolResult: string;
        try {
          toolResult = await executeToolByName(fnName, args);
        } catch (err) {
          toolResult = `Error ejecutando herramienta "${fnName}": ${
            (err as Error).message
          }`;
        }

        console.log(`[AgentLoop] ✅ Tool result from ${fnName} completed.`);
        
        // Persist each interaction
        saveMessage(userId, "tool", toolResult, fnName, toolCall.id);

        return {
          role: "tool" as const,
          tool_call_id: toolCall.id,
          content: toolResult,
        };
      })
    );

    // Feed all results back into context
    messages.push(...toolResults);
  }

  // Safety exit – max iterations reached
  const fallback =
    "He alcanzado el límite de razonamiento. Por favor, reformula tu pregunta.";
  saveMessage(userId, "assistant", fallback);
  return { response: fallback, iterations };
}
