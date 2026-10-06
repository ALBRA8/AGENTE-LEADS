// ============================================================
// src/app/api/integrations/route.ts — Integration settings CRUD
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server";
import { db } from "@/lib/db";

export async function GET() {
  const user = await requireUser();
  let integ = await db.integration.findUnique({
    where: { userId: user.id },
  });
  if (!integ) {
    integ = await db.integration.create({ data: { userId: user.id } });
  }
  // Mask secrets in response
  return NextResponse.json({
    integration: {
      telegramBotToken: integ.telegramBotToken ? "***configured***" : "",
      telegramAllowedIds: integ.telegramAllowedIds || "",
      sendgridApiKey: integ.sendgridApiKey ? "***configured***" : "",
      sendgridFromEmail: integ.sendgridFromEmail || "",
      whatsappToken: integ.whatsappToken ? "***configured***" : "",
      whatsappPhoneId: integ.whatsappPhoneId || "",
      googlePlacesApiKey: integ.googlePlacesApiKey ? "***configured***" : "",
      apifyToken: integ.apifyToken ? "***configured***" : "",
    },
    configured: {
      telegram: Boolean(integ.telegramBotToken),
      sendgrid: Boolean(integ.sendgridApiKey),
      whatsapp: Boolean(integ.whatsappToken),
      googlePlaces: Boolean(integ.googlePlacesApiKey),
      apify: Boolean(integ.apifyToken),
    },
  });
}

export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  const body = await req.json();

  // Don't overwrite existing secrets with the mask
  const data: any = {};
  const fields = [
    "telegramBotToken",
    "telegramAllowedIds",
    "sendgridApiKey",
    "sendgridFromEmail",
    "whatsappToken",
    "whatsappPhoneId",
    "googlePlacesApiKey",
    "apifyToken",
  ];
  for (const f of fields) {
    if (body[f] !== undefined && body[f] !== "***configured***") {
      data[f] = body[f] || null;
    }
  }

  let integ = await db.integration.findUnique({
    where: { userId: user.id },
  });
  if (!integ) {
    integ = await db.integration.create({
      data: { userId: user.id, ...data },
    });
  } else {
    integ = await db.integration.update({
      where: { userId: user.id },
      data,
    });
  }

  return NextResponse.json({ ok: true });
}
