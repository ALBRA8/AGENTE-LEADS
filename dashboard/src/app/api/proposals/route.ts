// ============================================================
// src/app/api/proposals/route.ts — Proposal list & generation
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server";
import { db } from "@/lib/db";
import { generateProposal } from "@/lib/ai/proposals";

export async function GET(req: NextRequest) {
  const user = await requireUser();
  const { searchParams } = new URL(req.url);
  const prospectId = searchParams.get("prospectId");

  const where: any = { userId: user.id };
  if (prospectId) where.prospectId = prospectId;

  const proposals = await db.proposal.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { prospect: { select: { name: true, city: true, category: true } } },
  });

  return NextResponse.json({ proposals });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  const body = await req.json();
  const { prospectId, style, offerId } = body;

  if (!prospectId || !style) {
    return NextResponse.json(
      { error: "prospectId and style required" },
      { status: 400 }
    );
  }

  const prospect = await db.prospect.findFirst({
    where: { id: prospectId, userId: user.id },
  });
  if (!prospect) {
    return NextResponse.json({ error: "prospect not found" }, { status: 404 });
  }

  let offer: any = null;
  if (offerId) {
    offer = await db.offer.findFirst({
      where: { id: offerId, userId: user.id },
    });
  }
  if (!offer && prospect.offerId) {
    offer = await db.offer.findFirst({
      where: { id: prospect.offerId, userId: user.id },
    });
  }
  if (!offer) {
    offer = await db.offer.findFirst({
      where: { userId: user.id, isActive: true },
      orderBy: { createdAt: "desc" },
    });
  }
  if (!offer) {
    return NextResponse.json(
      { error: "No offer configured. Please create an offer in Ajustes first." },
      { status: 400 }
    );
  }

  const content = await generateProposal({
    offer: {
      name: offer.name,
      description: offer.description,
      priceRange: offer.priceRange,
      idealCustomer: offer.idealCustomer,
      targetNiches: offer.targetNiches,
      sector: offer.sector,
    },
    prospect: {
      name: prospect.name,
      category: prospect.category,
      city: prospect.city,
      address: prospect.address,
      website: prospect.website,
      phone: prospect.phone,
      email: prospect.email,
      socialLinks: prospect.socialLinks,
      description: prospect.description,
    },
    style,
    painType: prospect.painType,
    painEvidence: prospect.painEvidence,
  });

  const proposal = await db.proposal.create({
    data: {
      userId: user.id,
      prospectId,
      offerId: offer.id,
      style,
      content,
    },
  });

  return NextResponse.json({ proposal });
}

export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  const body = await req.json();
  const { id, editedContent, isSent } = body;

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const data: any = {};
  if (editedContent !== undefined) {
    data.editedContent = editedContent;
    data.isEdited = true;
  }
  if (isSent !== undefined) {
    data.isSent = isSent;
    if (isSent) data.sentAt = new Date();
  }

  const updated = await db.proposal.update({
    where: { id, userId: user.id },
    data,
  });
  return NextResponse.json({ proposal: updated });
}
