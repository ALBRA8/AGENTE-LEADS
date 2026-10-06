// ============================================================
// src/app/api/insights/route.ts — Retrieve learned insights
// ============================================================

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server";
import { db } from "@/lib/db";
import { analyzeOutcomes } from "@/lib/ai/closed-loop";

export async function GET() {
  try {
    const user = await requireUser();

    const insight = await db.learnedInsight.findUnique({
      where: { userId: user.id },
    });

    if (!insight) {
      // No outcomes tracked yet — trigger first analysis (best-effort)
      const analysis = await analyzeOutcomes(user.id);
      return NextResponse.json({
        stored: null,
        liveAnalysis: analysis,
      });
    }

    const outcomesCount = await db.outcomeEvent.count({
      where: { userId: user.id },
    });

    return NextResponse.json({
      stored: {
        insightText: insight.insightText,
        feature: insight.feature,
        condition: insight.condition,
        conversionRate: insight.conversionRate,
        sampleSize: insight.sampleSize,
        liftFactor: insight.liftFactor,
        updatedAt: insight.updatedAt,
      },
      outcomesCount,
    });
  } catch (err: any) {
    if (err?.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    console.error("[/api/insights GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "internal error" },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const user = await requireUser();
    // Force re-analysis
    const analysis = await analyzeOutcomes(user.id);
    return NextResponse.json(analysis);
  } catch (err: any) {
    if (err?.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    console.error("[/api/insights POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "internal error" },
      { status: 500 }
    );
  }
}
