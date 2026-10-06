// ============================================================
// src/app/api/prospects/route.ts — Prospect list + filters
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await requireUser();
  const { searchParams } = new URL(req.url);
  const city = searchParams.get("city");
  const category = searchParams.get("category");
  const tier = searchParams.get("tier");
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const favoriteOnly = searchParams.get("favorite") === "1";
  const includeFiltered = searchParams.get("includeFiltered") === "1";
  const sort = searchParams.get("sort") || "createdAt:desc";
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "20");

  const where: any = { userId: user.id };
  if (city && city !== "ALL") where.city = city;
  if (category && category !== "ALL") where.category = category;
  if (tier && tier !== "ALL") where.tier = tier;
  if (status && status !== "ALL") where.status = status;
  if (favoriteOnly) where.isFavorite = true;
  if (!includeFiltered && tier !== "TIER_F") {
    where.tier = { not: "TIER_F" };
    if (tier && tier !== "ALL") {
      where.tier = tier;
    }
  }
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { description: { contains: search } },
      { category: { contains: search } },
      { address: { contains: search } },
    ];
  }

  const [total, prospects] = await Promise.all([
    db.prospect.count({ where }),
    db.prospect.findMany({
      where,
      orderBy: sort.includes(":")
        ? { [sort.split(":")[0]]: sort.split(":")[1] as any }
        : { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: { select: { proposals: true, notes: true } },
      },
    }),
  ]);

  // Get unique filter values
  const [cities, categories, tiers, statuses] = await Promise.all([
    db.prospect.findMany({
      where: { userId: user.id },
      select: { city: true },
      distinct: ["city"],
    }),
    db.prospect.findMany({
      where: { userId: user.id },
      select: { category: true },
      distinct: ["category"],
    }),
    db.prospect.findMany({
      where: { userId: user.id },
      select: { tier: true },
      distinct: ["tier"],
    }),
    db.prospect.findMany({
      where: { userId: user.id },
      select: { status: true },
      distinct: ["status"],
    }),
  ]);

  return NextResponse.json({
    prospects,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    filters: {
      cities: cities.map((c) => c.city).filter(Boolean).sort(),
      categories: categories.map((c) => c.category).filter(Boolean).sort(),
      tiers: tiers.map((t) => t.tier).sort(),
      statuses: statuses.map((s) => s.status).sort(),
    },
  });
}

export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  const body = await req.json();
  const { id, ...fields } = body;

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // If status is changing, record in history
  if (fields.status) {
    const current = await db.prospect.findFirst({
      where: { id, userId: user.id },
    });
    if (current && current.status !== fields.status) {
      await db.statusHistory.create({
        data: {
          prospectId: id,
          fromStatus: current.status,
          toStatus: fields.status,
          reason: fields.statusReason || null,
        },
      });
      fields.lastContactedAt =
        fields.status === "CONTACTED" || fields.status === "INTERESTED"
          ? new Date()
          : current.lastContactedAt;
      delete fields.statusReason;
    }
  }

  const updated = await db.prospect.update({
    where: { id, userId: user.id },
    data: fields,
  });
  return NextResponse.json({ prospect: updated });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.prospect.delete({ where: { id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
