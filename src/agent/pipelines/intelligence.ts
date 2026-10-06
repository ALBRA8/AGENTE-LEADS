// ============================================================
// src/agent/pipelines/intelligence.ts
// P1.2 — LLM-powered Lead Intelligence
//
// Uses GLM 5.3 Flash (reasoning model) to produce:
//   - A 1-2 sentence summary of what the lead IS
//   - An estimated opportunity size (small/medium/large)
//   - A suggested outreach angle (what to pitch first)
//   - A confidence level on the LLM's own assessment
//
// CRITICAL: the LLM is the INTELLIGENCE layer. It does NOT
// invent facts. It reasons ABOUT the facts that the deterministic
// pipeline already produced (validation state + evidence records).
// If evidence is missing, the LLM says "no determinable".
// ============================================================

import { nvidiaNIMClient, NVIDIA_CONFIG, withRetry } from "../../config/nvidia.js";
import type { Lead } from "../core/lead.js";
import { inferred, type EvidenceRecord } from "../core/evidence.js";
import type { ExecutionRecorder } from "../core/execution.js";

export interface IntelligenceInput {
  lead: Lead;
  /** Optional: the offer the user is selling (gives context for the angle) */
  offer_description?: string;
}

export interface IntelligenceOutput {
  lead: Lead;
  intelligence: LeadIntelligence;
}

export interface LeadIntelligence {
  /** 1-2 sentence summary: "Vegan restaurant in Medellín, ~8000 followers on Instagram, has website" */
  summary: string;
  /** Estimated opportunity size: "small" | "medium" | "large" | "unknown" */
  opportunity_size: "small" | "medium" | "large" | "unknown";
  /** Suggested outreach angle: "Web design refresh — current site has no SSL and is not mobile responsive" */
  outreach_angle: string;
  /** Confidence on the LLM's own assessment: high/medium/low/none */
  confidence: "high" | "medium" | "low" | "none";
  /** What signals the LLM used (for transparency) */
  signals_used: string[];
}

const SYSTEM_PROMPT = `You are AGENTE LEADS' Lead Intelligence module. Your job is to reason about a lead's public information and produce actionable intelligence for sales.

You will receive:
- The lead's structured data (name, contact info, sources)
- The validation state (what's been verified)
- The evidence records (what was observed vs. inferred vs. not found)

You must return JSON ONLY (no markdown) with this structure:
{
  "summary": "1-2 sentence factual description of what this lead IS, using ONLY the data provided. If data is missing, say 'no determinable' for that aspect.",
  "opportunity_size": "small | medium | large | unknown — based on signals like followers, web presence, validation status",
  "outreach_angle": "1-sentence suggestion on what to pitch first, based on observed pains (e.g. 'Web design refresh — site has no SSL'). If no pain detected, say 'No clear angle — generic outreach'",
  "confidence": "high | medium | low | none — your confidence on the above assessments",
  "signals_used": ["array of field names you used to reason about this lead"]
}

CRITICAL RULES:
1. NEVER invent facts not in the input. If you don't know, say "no determinable" or "unknown".
2. Distinguish between what's OBSERVED (FOUND) and what's NOT_FOUND (searched but didn't appear).
3. NEVER claim "doesn't have X" if X is just NOT_FOUND — say "X not found in available sources" instead.
4. Be CONSERVATIVE on opportunity_size — only say "large" if multiple strong signals.
5. Output ONLY JSON, no prose, no markdown fences.`;

export async function runIntelligence(
  input: IntelligenceInput,
  trace?: ExecutionRecorder
): Promise<IntelligenceOutput> {
  const end = trace?.start("intelligence.glm_5_3_flash", {
    provider: "NVIDIA NIM GLM 5.3 Flash",
    intent: `LLM reasoning about lead: ${input.lead.name}`,
  });

  // Build the LLM input — feed it the structured lead data + evidence
  const userMsg = buildLLMInput(input.lead, input.offer_description);

  try {
    const response = await withRetry(
      () =>
        nvidiaNIMClient.chat.completions.create({
          model: NVIDIA_CONFIG.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMsg },
          ],
          temperature: 0.5,
          top_p: 1,
          max_tokens: NVIDIA_CONFIG.maxTokens,  // 4096 — enough for reasoning + answer
        }),
      "intelligence LLM call"
    );

    const content = response?.choices?.[0]?.message?.content;
    if (!content) {
      end?.({ error: { type: "EMPTY_RESULT", message: "LLM returned no content", retryable: false } });
      return { lead: input.lead, intelligence: makeFallbackIntelligence(input.lead) };
    }

    // Strip code fences if any
    const cleaned = content.replace(/```json|```/g, "").trim();
    let parsed: LeadIntelligence;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      end?.({ error: e });
      return { lead: input.lead, intelligence: makeFallbackIntelligence(input.lead) };
    }

    // Add an INFERRED evidence record for the LLM's intelligence
    // (P0.6: this IS an inference, not a fact)
    const intelligenceEvidence: EvidenceRecord = inferred(
      "llm_intelligence",
      parsed.summary,
      `LLM (GLM 5.3 Flash) inferred summary. Confidence: ${parsed.confidence}. Signals: ${parsed.signals_used.join(", ")}`,
      parsed.signals_used
    );
    input.lead.evidence.push(intelligenceEvidence);

    end?.({ output: `summary="${parsed.summary.substring(0, 80)}…" opportunity=${parsed.opportunity_size}` });

    return { lead: input.lead, intelligence: parsed };
  } catch (e: any) {
    end?.({ error: e });
    console.warn("[intelligence] LLM failed:", e.message);
    return { lead: input.lead, intelligence: makeFallbackIntelligence(input.lead) };
  }
}

function buildLLMInput(lead: Lead, offerDescription?: string): string {
  const lines: string[] = [];
  lines.push("LEAD DATA:");
  lines.push(`- Name: ${lead.name}`);
  lines.push(`- Username: ${lead.username ?? "n/a"}`);
  lines.push(`- Platform: ${lead.platform ?? "n/a"}`);
  lines.push(`- URL: ${lead.url ?? "n/a"}`);
  // FIX (ARCH-H3): use evidence status labels instead of "NOT FOUND"
  // (P0.6: distinguish "searched, didn't find" from "didn't search")
  const websiteStatus = lead.evidence.find((e) => e.field === "website");
  const emailStatus = lead.evidence.find((e) => e.field === "email");
  const phoneStatus = lead.evidence.find((e) => e.field === "phone");
  lines.push(`- Website: ${lead.website ?? `(${websiteStatus?.status ?? "no investigado"})`}`);
  lines.push(`- Email: ${lead.email ?? `(${emailStatus?.status ?? "no investigado"})`}`);
  lines.push(`- Phone: ${lead.phone ?? `(${phoneStatus?.status ?? "no investigado"})`}`);
  lines.push(`- Location: ${lead.location ?? "n/a"}`);
  lines.push(`- Category: ${lead.category ?? "n/a"}`);
  lines.push(`- Sources: ${lead.sources.join(", ")}`);
  lines.push(`- Discovered at: ${lead.discovered_at}`);
  lines.push(`- Research state: ${lead.research_state}`);
  if (lead.lead_score !== undefined) {
    lines.push(`- Lead Score: ${lead.lead_score}/100`);
  }

  if (lead.validation && Object.keys(lead.validation).length > 0) {
    lines.push("");
    lines.push("VALIDATION STATE:");
    for (const [field, v] of Object.entries(lead.validation)) {
      lines.push(`- ${field}: ${v.status} (confidence: ${v.confidence}) — ${v.notes ?? "no notes"}`);
    }
  }

  if (lead.evidence.length > 0) {
    lines.push("");
    lines.push("EVIDENCE RECORDS (status: FOUND | NOT_FOUND | CONFIRMED_ABSENT | INFERRED):");
    for (const e of lead.evidence) {
      const valStr = e.value ? `value="${e.value}" ` : "";
      lines.push(`- ${e.field}: ${valStr}status=${e.status} confidence=${e.confidence} source=${e.source}`);
    }
  }

  if (offerDescription) {
    lines.push("");
    lines.push(`CONTEXT — the seller's offer: ${offerDescription}`);
  }

  lines.push("");
  lines.push("Produce the JSON intelligence assessment per the system prompt.");
  return lines.join("\n");
}

function makeFallbackIntelligence(lead: Lead): LeadIntelligence {
  // When LLM is unavailable, produce a minimal intelligence from deterministic signals
  const foundCount = lead.evidence.filter((e) => e.status === "FOUND").length;
  const size: LeadIntelligence["opportunity_size"] =
    foundCount >= 4 ? "medium" :
    foundCount >= 2 ? "small" :
    "unknown";
  return {
    summary: `${lead.name} — ${lead.category ?? "negocio"} en ${lead.location ?? "ubicación no determinable"}. ${foundCount} datos encontrados.`,
    opportunity_size: size,
    outreach_angle: "No clear angle — LLM unavailable, generic outreach recommended",
    confidence: "low",
    signals_used: lead.evidence.filter((e) => e.status === "FOUND").map((e) => e.field),
  };
}
