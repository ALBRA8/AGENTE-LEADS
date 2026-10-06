// ============================================================
// src/app/api/dashboard/route.ts — KPI aggregation endpoint
// ============================================================

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const user = await requireUser();

    const [
      totalProspects,
      tierA,
      tierB,
      tierC,
      tierF,
      statusNew,
      statusContacted,
      statusInterested,
      statusNotInterested,
      statusClient,
      totalProposals,
      favoriteCount,
      byCity,
      byCategory,
      recentSearches,
    ] = await Promise.all([
      db.prospect.count({ where: { userId: user.id } }),
      db.prospect.count({ where: { userId: user.id, tier: "TIER_A" } }),
      db.prospect.count({ where: { userId: user.id, tier: "TIER_B" } }),
      db.prospect.count({ where: { userId: user.id, tier: "TIER_C" } }),
      db.prospect.count({ where: { userId: user.id, tier: "TIER_F" } }),
      db.prospect.count({ where: { userId: user.id, status: "NEW" } }),
      db.prospect.count({ where: { userId: user.id, status: "CONTACTED" } }),
      db.prospect.count({ where: { userId: user.id, status: "INTERESTED" } }),
      db.prospect.count({ where: { userId: user.id, status: "NOT_INTERESTED" } }),
      db.prospect.count({ where: { userId: user.id, status: "CLIENT" } }),
      db.proposal.count({ where: { userId: user.id } }),
      db.prospect.count({ where: { userId: user.id, isFavorite: true } }),
      db.prospect.groupBy({
        by: ["city"],
        where: { userId: user.id },
        _count: { _all: true },
        orderBy: { _count: { city: "desc" } },
      }),
      db.prospect.groupBy({
        by: ["category"],
        where: { userId: user.id },
        _count: { _all: true },
        orderBy: { _count: { category: "desc" } },
        take: 8,
      }),
      db.searchJob.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    return NextResponse.json({
      kpis: {
        totalProspects,
        totalProposals,
        favoriteCount,
        statusBreakdown: {
          NEW: statusNew,
          CONTACTED: statusContacted,
          INTERESTED: statusInterested,
          NOT_INTERESTED: statusNotInterested,
          CLIENT: statusClient,
        },
        tierBreakdown: {
          TIER_A: tierA,
          TIER_B: tierB,
          TIER_C: tierC,
          TIER_F: tierF,
        },
        highMatchCount: tierA + tierB,
      },
      byCity: byCity.map((c) => ({ city: c.city || "N/A", count: c._count._all })),
      byCategory: byCategory.map((c) => ({
        category: c.category || "N/A",
        count: c._count._all,
      })),
      recentSearches: recentSearches.map((s) => ({
        id: s.id,
        city: s.city,
        category: s.category,
        keywords: s.keywords,
        sourceAdapter: s.sourceAdapter,
        status: s.status,
        foundCount: s.foundCount,
        tierACount: s.tierACount,
        tierBCount: s.tierBCount,
        createdAt: s.createdAt,
      })),
    });
  } catch (e: any) {
    if (e.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
