// ============================================================
// src/lib/ai/closed-loop.ts — Closed-loop learning service
// Tracks outcomes, discovers patterns, scores look-alikes
// ============================================================

import { db } from "@/lib/db";
import { aiChat } from "@/lib/ai/client";

export type OutcomeType =
  | "CLIENT"
  | "NOT_INTERESTED"
  | "UNREACHABLE"
  | "DUPLICATE"
  | "FOLLOW_UP_LATER";

export interface GeneratedInsight {
  insightText: string;
  feature: string;
  condition: string;
  conversionRate: number;
  sampleSize: number;
  liftFactor: number;
}

interface FeatureStat {
  feature: string;
  condition: string;
  total: number;
  clients: number;
  conversionRate: number;
  liftFactor: number;
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function safeParseJSON<T = any>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function bucketFreshnessScore(raw: any): string | null {
  if (raw == null) return null;
  const n = typeof raw === "string" ? parseFloat(raw) : Number(raw);
  if (!isFinite(n)) return null;
  if (n < 30) return "<30";
  if (n < 60) return "30-60";
  return "60+";
}

interface ProspectFeatures {
  tier: string;
  nicheFit?: string | null;
  painDetected: boolean;
  painType?: string | null;
  techStack?: string | null;
  freshnessData?: string | null;
  city?: string | null;
  category?: string | null;
}

/**
 * Extract all (feature, condition) pairs from a prospect.
 * Each entry is a *placeholder* FeatureStat with total=clients=0 —
 * the caller is responsible for aggregating counts.
 */
function extractFeatures(p: ProspectFeatures): FeatureStat[] {
  const features: FeatureStat[] = [];

  // tier
  if (p.tier && p.tier !== "PENDING") {
    features.push(emptyStat("tier", p.tier));
  }

  // nicheFit
  if (p.nicheFit && p.nicheFit !== "none") {
    features.push(emptyStat("nicheFit", p.nicheFit));
  }

  // painDetected
  features.push(emptyStat("painDetected", p.painDetected ? "true" : "false"));

  // painType
  if (p.painType) {
    features.push(emptyStat("painType", p.painType));
  }

  // techStack.cms
  const ts = safeParseJSON(p.techStack);
  if (ts && ts.cms) {
    features.push(emptyStat("techStack.cms", String(ts.cms)));
  }

  // freshnessData
  const fd = safeParseJSON(p.freshnessData);
  if (fd) {
    if (typeof fd.isMobileResponsive === "boolean") {
      features.push(
        emptyStat("freshnessData.isMobileResponsive", String(fd.isMobileResponsive))
      );
    }
    if (typeof fd.hasBookingSystem === "boolean") {
      features.push(
        emptyStat("freshnessData.hasBookingSystem", String(fd.hasBookingSystem))
      );
    }
    // freshnessScore bucket — handle multiple possible field names
    const freshRaw =
      fd.freshnessScore ?? fd.freshness ?? fd.daysSinceLastUpdate ?? fd.sslAgeDays;
    const bucket = bucketFreshnessScore(freshRaw);
    if (bucket) {
      features.push(emptyStat("freshnessData.freshnessScore", bucket));
    }
  }

  // city
  if (p.city) {
    features.push(emptyStat("city", p.city));
  }

  // category
  if (p.category) {
    features.push(emptyStat("category", p.category));
  }

  return features;
}

function emptyStat(feature: string, condition: string): FeatureStat {
  return {
    feature,
    condition,
    total: 0,
    clients: 0,
    conversionRate: 0,
    liftFactor: 1,
  };
}

const statKey = (f: { feature: string; condition: string }) =>
  `${f.feature}=${f.condition}`;

// ------------------------------------------------------------
// recordOutcome
// ------------------------------------------------------------

const STATUS_MAP: Record<OutcomeType, string> = {
  CLIENT: "CLIENT",
  NOT_INTERESTED: "NOT_INTERESTED",
  UNREACHABLE: "NOT_INTERESTED",
  DUPLICATE: "NOT_INTERESTED",
  FOLLOW_UP_LATER: "CONTACTED",
};

/**
 * Track a new outcome for a prospect:
 * 1. Insert an OutcomeEvent row
 * 2. Update Prospect.status to match the outcome
 * 3. Fire analyzeOutcomes(userId) in the background (no await)
 * 4. Return success
 */
export async function recordOutcome(input: {
  userId: string;
  prospectId: string;
  outcome: OutcomeType;
  reason?: string;
  closedValue?: number;
}): Promise<{ ok: true; insightGenerated?: boolean }> {
  const { userId, prospectId, outcome, reason, closedValue } = input;

  // 1. Insert OutcomeEvent
  await db.outcomeEvent.create({
    data: {
      userId,
      prospectId,
      outcome,
      reason: reason ?? null,
      closedValue: closedValue ?? null,
    },
  });

  // 2. Update Prospect.status
  const newStatus = STATUS_MAP[outcome];
  try {
    await db.prospect.update({
      where: { id: prospectId },
      data: { status: newStatus },
    });
  } catch (err) {
    // Prospect may have been deleted — don't fail the whole call
    console.error("[closed-loop] failed to update prospect status:", err);
  }

  // 3. Fire analyzeOutcomes in background (no await)
  void analyzeOutcomes(userId).catch((err) => {
    console.error("[closed-loop] background analyzeOutcomes failed:", err);
  });

  // 4. Return success
  return { ok: true };
}

// ------------------------------------------------------------
// analyzeOutcomes
// ------------------------------------------------------------

/**
 * Analyze all outcomes for a user and discover patterns.
 * - Groups outcomes by (feature, condition) extracted from each prospect
 * - Computes conversion rate + lift factor per group
 * - Filters for statistically meaningful groups (sample ≥ 3, lift ≥ 1.5 or ≤ 0.5)
 * - Calls LLM to summarize the top patterns into human-readable insights
 * - Upserts into LearnedInsight table (one row per user)
 */
export async function analyzeOutcomes(userId: string): Promise<{
  totalOutcomes: number;
  totalClients: number;
  conversionRate: number;
  insights: GeneratedInsight[];
  topConvertingFeatures: {
    feature: string;
    condition: string;
    rate: number;
    sample: number;
  }[];
  topDisqualifyingFeatures: {
    feature: string;
    condition: string;
    rate: number;
    sample: number;
  }[];
}> {
  // 1. Fetch all outcomes with prospect data
  const events = await db.outcomeEvent.findMany({
    where: { userId },
    include: { prospect: true },
  });

  const totalOutcomes = events.length;
  const totalClients = events.filter((e) => e.outcome === "CLIENT").length;
  const conversionRate =
    totalOutcomes > 0 ? totalClients / totalOutcomes : 0;

  // 2. Aggregate counts per (feature, condition)
  const agg = new Map<string, FeatureStat>();

  for (const ev of events) {
    const p = ev.prospect;
    if (!p) continue;
    const features = extractFeatures({
      tier: p.tier,
      nicheFit: p.nicheFit,
      painDetected: p.painDetected,
      painType: p.painType,
      techStack: p.techStack,
      freshnessData: p.freshnessData,
      city: p.city,
      category: p.category,
    });
    const isClient = ev.outcome === "CLIENT";

    for (const f of features) {
      const k = statKey(f);
      const existing =
        agg.get(k) ?? emptyStat(f.feature, f.condition);
      existing.total += 1;
      if (isClient) existing.clients += 1;
      agg.set(k, existing);
    }
  }

  // 3. Compute conversionRate + liftFactor per group
  const allStats: FeatureStat[] = Array.from(agg.values()).map((s) => {
    const cr = s.total > 0 ? s.clients / s.total : 0;
    const lift =
      conversionRate > 0 && s.total > 0 ? cr / conversionRate : 1;
    return {
      ...s,
      conversionRate: cr,
      liftFactor: lift,
    };
  });

  // 4. Filter for sample ≥ 3 and lift ≥ 1.5 or ≤ 0.5
  const significant = allStats.filter(
    (s) => s.total >= 3 && (s.liftFactor >= 1.5 || s.liftFactor <= 0.5)
  );

  // 5. Sort by sample × |lift-1| desc
  significant.sort((a, b) => {
    const aScore = a.total * Math.abs(a.liftFactor - 1);
    const bScore = b.total * Math.abs(b.liftFactor - 1);
    return bScore - aScore;
  });

  // 6. Top 10
  const top = significant.slice(0, 10);

  // 7. Generate human-readable insights via LLM (one batched call)
  let insightTexts: string[] = [];
  if (top.length > 0) {
    try {
      const llmResp = await aiChat([
        {
          role: "system",
          content:
            "Generas insights de ventas en español. Devuelves ÚNICAMENTE un array JSON de strings, una frase por cada patrón, en el mismo orden. Cada frase debe mencionar la característica, la condición, y el lift relativo a la media. No uses markdown.",
        },
        {
          role: "user",
          content:
            `Patrones (en orden):\n${top
              .map(
                (s, i) =>
                  `${i + 1}. feature=${s.feature}, condition=${s.condition}, ` +
                  `conversionRate=${(s.conversionRate * 100).toFixed(1)}%, ` +
                  `sampleSize=${s.total}, liftFactor=${s.liftFactor.toFixed(2)} ` +
                  `(1.0=media, >1=positivo, <1=negativo)`
              )
              .join("\n")}\n\n` +
              `Genera 1 frase en español por cada patrón, en el mismo orden. ` +
              `Ejemplo: "Las clínicas con WordPress y tema gratuito convierten 3x más que las promedio". ` +
              `Devuelve solo el array JSON.`,
        },
      ]);
      const cleaned = llmResp.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        insightTexts = parsed as string[];
      }
    } catch (err) {
      console.error("[closed-loop] LLM insight generation failed:", err);
      // fall back to templated text below
    }
  }

  const insights: GeneratedInsight[] = top.map((s, i) => ({
    insightText:
      insightTexts[i] ||
      `${s.feature}=${s.condition}: ${(s.conversionRate * 100).toFixed(
        1
      )}% conv (${s.clients}/${s.total}), lift ${s.liftFactor.toFixed(2)}x`,
    feature: s.feature,
    condition: s.condition,
    conversionRate: s.conversionRate,
    sampleSize: s.total,
    liftFactor: s.liftFactor,
  }));

  // 8. Top converting + top disqualifying feature summaries
  const topConvertingFeatures = allStats
    .filter((s) => s.total >= 3 && s.liftFactor >= 1.5)
    .sort((a, b) => b.liftFactor - a.liftFactor)
    .slice(0, 5)
    .map((s) => ({
      feature: s.feature,
      condition: s.condition,
      rate: s.conversionRate,
      sample: s.total,
    }));

  const topDisqualifyingFeatures = allStats
    .filter((s) => s.total >= 3 && s.liftFactor <= 0.5)
    .sort((a, b) => a.liftFactor - b.liftFactor)
    .slice(0, 5)
    .map((s) => ({
      feature: s.feature,
      condition: s.condition,
      rate: s.conversionRate,
      sample: s.total,
    }));

  // 9. Upsert LearnedInsight row (one per user)
  await upsertInsightsRow(userId, insights, totalOutcomes);

  return {
    totalOutcomes,
    totalClients,
    conversionRate,
    insights,
    topConvertingFeatures,
    topDisqualifyingFeatures,
  };
}

/**
 * Upsert the user's LearnedInsight row.
 * The scalar fields (feature, condition, etc.) hold the strongest insight's
 * data, while insightText holds the full JSON-serialized array of all insights.
 */
async function upsertInsightsRow(
  userId: string,
  insights: GeneratedInsight[],
  totalOutcomes: number
): Promise<void> {
  const serialized = JSON.stringify(insights);

  if (insights.length > 0) {
    const top = insights[0];
    await db.learnedInsight.upsert({
      where: { userId },
      create: {
        userId,
        insightText: serialized,
        feature: top.feature,
        condition: top.condition,
        conversionRate: top.conversionRate,
        sampleSize: top.sampleSize,
        liftFactor: top.liftFactor,
      },
      update: {
        insightText: serialized,
        feature: top.feature,
        condition: top.condition,
        conversionRate: top.conversionRate,
        sampleSize: top.sampleSize,
        liftFactor: top.liftFactor,
      },
    });
  } else {
    // Store a neutral placeholder so callers know analysis has run
    await db.learnedInsight.upsert({
      where: { userId },
      create: {
        userId,
        insightText: serialized, // "[]"
        feature: "none",
        condition: "none",
        conversionRate: 0,
        sampleSize: totalOutcomes,
        liftFactor: 1,
      },
      update: {
        insightText: serialized,
        feature: "none",
        condition: "none",
        conversionRate: 0,
        sampleSize: totalOutcomes,
        liftFactor: 1,
      },
    });
  }
}

// ------------------------------------------------------------
// computeLookAlikeScore
// ------------------------------------------------------------

/**
 * Compute a look-alike score (0-100) for a new prospect based on
 * how similar it is to the user's existing CLIENT outcomes.
 * - 50 = neutral (no insights stored yet)
 * - Score = 50 * (product of matching positive-lift factors, capped [0.1, 2.0])
 * - Clamped to [0, 100]
 */
export async function computeLookAlikeScore(
  userId: string,
  prospect: ProspectFeatures
): Promise<number> {
  const stored = await db.learnedInsight.findUnique({
    where: { userId },
  });
  if (!stored) return 50;

  let insights: GeneratedInsight[] = [];
  try {
    const parsed = JSON.parse(stored.insightText);
    if (Array.isArray(parsed)) {
      insights = parsed as GeneratedInsight[];
    }
  } catch {
    return 50;
  }

  if (insights.length === 0) return 50;

  // Extract features of the new prospect and build a lookup set
  const features = extractFeatures(prospect);
  const featureKeys = new Set(features.map((f) => statKey(f)));

  // Product of matching positive-lift factors (>1 only)
  let product = 1;
  for (const ins of insights) {
    if (ins.liftFactor > 1) {
      const key = statKey(ins);
      if (featureKeys.has(key)) {
        product *= ins.liftFactor;
      }
    }
  }

  // Cap to [0.1, 2.0]
  const capped = Math.max(0.1, Math.min(2.0, product));

  // Score = 50 * product, clamped to [0, 100]
  const score = 50 * capped;
  return Math.max(0, Math.min(100, score));
}
