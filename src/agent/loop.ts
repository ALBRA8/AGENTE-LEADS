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
Tu objetivo es encontrar quiénes podrían ser clientes, investigar quiénes son, validar la información, generar inteligencia con LLM, y opcionalmente enviar outreach.

## Herramienta 1: run_lead_pipeline (descubrimiento + investigación + validación + inteligencia)
Para CUALQUIER búsqueda de leads, USA PRIMERO este tool.
Ejecuta el pipeline determinístico completo:
  DESCUBRIR → INVESTIGAR → VALIDAR → DEDUPLICAR → SCORING → INTELIGENCIA (LLM) → ALMACENAR → REPORTAR

Parámetros: query (obligatorio), location, niche, platform, min_followers, top_n, max_concurrency, offer_description (para activar inteligencia LLM), enable_intelligence (default true si hay offer_description).

Te devuelve un reporte TOP LEADS en Markdown con cada campo marcado como:
  - encontrado (observado en una fuente pública)
  - validado (verificado contra fuente externa)
  - no encontrado (se buscó pero no apareció — NO afirmes que no existe)
  - inferido (derivado por el sistema)

Cada lead tiene un Lead Score 0-100 (computado por el pipeline de Scoring, P1.1).

## Herramienta 2: run_outreach (propuestas personalizadas con IA + envío)
DESPUÉS de run_lead_pipeline, cuando el usuario quiera enviar propuestas:
- Genera propuestas personalizadas con GLM 5.3 Flash para cada lead con score >= min_score (default 50)
- Por defecto ejecuta en DRY RUN (genera pero NO envía) — el usuario debe pasar dry_run=false explícitamente para enviar
- Canal: email si hay email validado (SendGrid), WhatsApp si hay teléfono (WhatsApp Cloud API)
- Usa APIs OFICIALES — no bots, no CAPTCHA bypass
- Fire CRM-ALBRA webhook si está configurado

## Herramientas legacy (solo para casos puntuales)
- 'scrape_instagram_leads': descubre candidatos vía Apify (requiere APIFY_TOKEN)
- 'enrich_lead_profile': enriquecimiento puntual con Google Search
- 'verify_email': verificación puntual de un email
- 'scrape_stealth': extracción de una URL específica con Scrapling (Python)
- 'save_lead': guardar un lead individual (legacy, dedup por email)

## Reglas de comportamiento
- Sé proactivo y autónomo. Si run_lead_pipeline devuelve 0 resultados, reformula la query y reintenta.
- No afirmes capacidades que el sistema no tiene (Scrapling NO evade CAPTCHAs ni Cloudflare).
- Distingue siempre entre "no encontrado" y "no tiene" — solo lo segundo requiere confirmación.
- Para outreach, SIEMPRE pregunta al usuario antes de pasar dry_run=false — no envíes propuestas sin confirmación.
- Responde en el idioma del usuario.`;
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
