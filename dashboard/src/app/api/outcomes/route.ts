// ============================================================
// src/app/api/outcomes/route.ts — Track + list prospect outcomes
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server";
import { db } from "@/lib/db";
import { recordOutcome } from "@/lib/ai/closed-loop";

const VALID_OUTCOMES = [
  "CLIENT",
  "NOT_INTERESTED",
  "UNREACHABLE",
  "DUPLICATE",
  "FOLLOW_UP_LATER",
] as const;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const { prospectId, outcome, reason, closedValue } = body ?? {};

    if (!prospectId || !outcome) {
      return NextResponse.json(
        { error: "prospectId and outcome required" },
        { status: 400 }
      );
    }
    if (!VALID_OUTCOMES.includes(outcome)) {
      return NextResponse.json(
        { error: "invalid outcome" },
        { status: 400 }
      );
    }

    const result = await recordOutcome({
      userId: user.id,
      prospectId,
      outcome,
      reason,
      closedValue,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    if (err?.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    console.error("[/api/outcomes POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "internal error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const events = await db.outcomeEvent.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        prospect: { select: { name: true, city: true, category: true } },
      },
    });
    return NextResponse.json({ events });
  } catch (err: any) {
    if (err?.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    console.error("[/api/outcomes GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "internal error" },
      { status: 500 }
    );
  }
}
