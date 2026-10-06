// Seed demo user + offer + sample prospects on first call
import { NextResponse } from "next/server";
import { ensureDemoUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { mockAestheticClinics } from "@/lib/leads/mock-source-data";

export async function POST() {
  try {
    const user = await ensureDemoUser();

    // Create default offer if none
    let offer = await db.offer.findFirst({
      where: { userId: user.id },
    });
    if (!offer) {
      offer = await db.offer.create({
        data: {
          userId: user.id,
          name: "Marketing digital y diseño web para clínicas de estética",
          description:
            "Servicio integral de marketing digital y diseño web especializado para clínicas de estética y medicina estética. Incluye diseño de página web profesional, gestión de redes sociales, publicidad pagada en Meta y Google, y generación de leads cualificados.",
          priceRange: "$1,500 - $5,000 USD / mes",
          idealCustomer:
            "Clínicas de estética con 1-5 sedes, facturación media-alta, que quieren crecer su flujo de pacientes",
          targetNiches:
            "clínica estética, medicina estética, cirugía plástica, dermatología, spa médico",
          cities: "Bogotá, Medellín, Cali",
          countries: "Colombia",
          sector: "Salud y belleza",
          isActive: true,
        },
      });
    }

    // Create default integration settings
    const integ = await db.integration.findUnique({
      where: { userId: user.id },
    });
    if (!integ) {
      await db.integration.create({ data: { userId: user.id } });
    }

    // Seed a few sample prospects so dashboard isn't empty
    const existingProspects = await db.prospect.count({
      where: { userId: user.id },
    });
    if (existingProspects === 0) {
      const samples = mockAestheticClinics.slice(0, 5);
      for (const s of samples) {
        await db.prospect.create({
          data: {
            userId: user.id,
            offerId: offer.id,
            name: s.name,
            category: s.category,
            city: s.city,
            country: s.country,
            address: s.address,
            website: s.website,
            phone: s.phone,
            email: s.email,
            socialLinks: s.socialLinks ? JSON.stringify(s.socialLinks) : null,
            description: s.description,
            source: "mock",
            sourceUrl: s.sourceUrl,
            status: "NEW",
            tier: "PENDING",
          },
        });
      }
    }

    return NextResponse.json({
      ok: true,
      user: { email: user.email, password: "agente123" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
