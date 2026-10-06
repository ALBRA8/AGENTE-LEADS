// ============================================================
// src/app/api/notes/route.ts — Notes CRUD
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await requireUser();
  const { searchParams } = new URL(req.url);
  const prospectId = searchParams.get("prospectId");
  if (!prospectId) return NextResponse.json({ notes: [] });
  const notes = await db.note.findMany({
    where: { prospectId, userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ notes });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  const { prospectId, content } = await req.json();
  if (!prospectId || !content) {
    return NextResponse.json(
      { error: "prospectId and content required" },
      { status: 400 }
    );
  }
  const note = await db.note.create({
    data: { userId: user.id, prospectId, content },
  });
  return NextResponse.json({ note });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.note.delete({ where: { id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
