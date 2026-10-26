// ============================================================
// src/lib/ai/intelligence.ts — LLM-powered Lead Intelligence (P1.2)
// GLM 5.3 Flash reasons about each lead and produces:
//   summary, opportunity_size, outreach_angle, confidence
// ============================================================

import { aiChat } from "./client";
import { db } from "@/lib/db";

export interface LeadIntelligence {
  summary: string;
  opportunity_size: "small" | "medium" | "large" | "unknown";
  outreach_angle: string;
  confidence: "high" | "medium" | "low" | "none";
  signals_used: string[];
}

const SYSTEM_PROMPT = `You are AGENTE LEADS' Lead Intelligence module. Your job is to reason about a lead's public information and produce actionable intelligence for sales.

Return JSON ONLY (no markdown, no prose) with this structure:
{
  "summary": "1-2 sentence factual description using ONLY the data provided",
  "opportunity_size": "small | medium | large | unknown",
  "outreach_angle": "1-sentence suggestion on what to pitch first",
  "confidence": "high | medium | low | none",
  "signals_used": ["array of field names used"]
}

CRITICAL RULES:
1. NEVER invent facts not in the input. Say "no determinable" if unknown.
2. Distinguish FOUND (observed) from NOT_FOUND (searched but didn't appear).
3. NEVER claim "doesn't have X" if X is just NOT_FOUND.
4. Be CONSERVATIVE — only say "large" if multiple strong signals.
5. Output ONLY JSON.`;

export async function generateIntelligence(prospectId: string, offerDescription?: string): Promise<LeadIntelligence> {
  // Load the prospect from DB
  const prospect = await db.prospect.findUnique({
    where: { id: prospectId },
  });
  if (!prospect) return makeFallback("Prospect not found");

  // Build the LLM input from prospect data
  const userMsg = buildLLMInput(prospect, offerDescription);

  try {
    const raw = await aiChat([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ]);
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      summary: String(parsed.summary ?? ""),
      opportunity_size: parsed.opportunity_size ?? "unknown",
      outreach_angle: String(parsed.outreach_angle ?? ""),
      confidence: parsed.confidence ?? "low",
      signals_used: Array.isArray(parsed.signals_used) ? parsed.signals_used : [],
    };
  } catch (e: any) {
    console.error("[intelligence] GLM 5.3 Flash error:", e.message);
    return makeFallback(prospect.name);
  }
}

function buildLLMInput(prospect: any, offerDescription?: string): string {
  const lines: string[] = [];
  lines.push("LEAD DATA:");
  lines.push(`- Name: ${prospect.name}`);
  lines.push(`- Website: ${prospect.website ?? "no investigado"}`);
  lines.push(`- Email: ${prospect.email ?? "no investigado"}`);
  lines.push(`- Phone: ${prospect.phone ?? "no investigado"}`);
  lines.push(`- Location: ${prospect.city ?? "n/a"}`);
  lines.push(`- Category: ${prospect.category ?? "n/a"}`);
  lines.push(`- Tier: ${prospect.tier}`);
  lines.push(`- Niche Fit: ${prospect.nicheFit ?? "n/a"}`);
  lines.push(`- Pain Detected: ${prospect.painDetected ? prospect.painType : "no"}`);
  lines.push(`- Pain Evidence: ${prospect.painEvidence ?? "n/a"}`);
  if (prospect.techStack) {
    try {
      const ts = JSON.parse(prospect.techStack);
      lines.push(`- Tech Stack: CMS=${ts.cms}, DIY=${ts.isDiySite}, PRO=${ts.isProSite}`);
    } catch {}
  }
  if (prospect.freshnessData) {
    try {
      const fd = JSON.parse(prospect.freshnessData);
      lines.push(`- Freshness: score=${fd.freshnessScore}/100, responsive=${fd.isMobileResponsive}, booking=${fd.hasBookingSystem}`);
    } catch {}
  }
  if (offerDescription) {
    lines.push(`\nSELLER'S OFFER: ${offerDescription}`);
  }
  lines.push("\nProduce the JSON intelligence assessment per the system prompt.");
  return lines.join("\n");
}

function makeFallback(name: string): LeadIntelligence {
  return {
    summary: `${name} — información limitada disponible.`,
    opportunity_size: "unknown",
    outreach_angle: "No clear angle — generic outreach recommended",
    confidence: "low",
    signals_used: [],
  };
}
