// ============================================================
// src/app/api/offers/route.ts — Offer CRUD
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server";
import { db } from "@/lib/db";

export async function GET() {
  const user = await requireUser();
  const offers = await db.offer.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ offers });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  const body = await req.json();
  const {
    name,
    description,
    priceRange,
    idealCustomer,
    targetNiches,
    cities,
    countries,
    budget,
    sector,
  } = body;

  if (!name || !description) {
    return NextResponse.json(
      { error: "Nombre y descripción son obligatorios" },
      { status: 400 }
    );
  }

  const offer = await db.offer.create({
    data: {
      userId: user.id,
      name,
      description,
      priceRange: priceRange || null,
      idealCustomer: idealCustomer || null,
      targetNiches: targetNiches || null,
      cities: cities || null,
      countries: countries || null,
      budget: budget || null,
      sector: sector || null,
    },
  });

  return NextResponse.json({ offer });
}

export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const offer = await db.offer.update({
    where: { id, userId: user.id },
    data: fields,
  });
  return NextResponse.json({ offer });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.offer.delete({ where: { id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
