// ============================================================
// src/lib/leads/mock-source-data.ts — Realistic Colombian aesthetic clinics
// Used by MockLeadSourceAdapter as the demo data source.
// ============================================================

import type { RawProspect } from "./types";

const bogotaClinics: Omit<RawProspect, "source">[] = [
  {
    name: "Clínica Belleza & Estética Bogotá",
    category: "Clínica de estética",
    city: "Bogotá",
    country: "Colombia",
    address: "Calle 116 #15-25, Piso 4, Bogotá",
    website: "https://clinica-belleza-bogota.com",
    phone: "+57 601 7458900",
    email: "contacto@clinica-belleza-bogota.com",
    socialLinks: {
      instagram: "https://instagram.com/clinicabelleza_bog",
      facebook: "https://facebook.com/clinicabelleza.bogota",
    },
    description:
      "Clínica especializada en medicina estética facial y corporal. Tratamientos de botox, rellenos, radiofrecuencia y eliminación de tatuajes. Atendemos desde 2015.",
    sourceUrl: "https://maps.google.com/bogota/clinic-1",
  },
  {
    name: "Centro Médico Estético Renacer",
    category: "Medicina estética",
    city: "Bogotá",
    country: "Colombia",
    address: "Av. Chile #50-35, Local 201, Bogotá",
    website: "http://renacer-estetica.co",
    phone: "+57 601 2134400",
    email: "info@renacer-estetica.co",
    socialLinks: {
      instagram: "https://instagram.com/renacer_estetica",
      facebook: "https://facebook.com/renaceresteticabog",
      tiktok: "https://tiktok.com/@renacer_estetica",
    },
    description:
      "Centro médico con 3 sedes en Bogotá. Especialistas en liposucción no invasiva, hilos tensores y depilación láser. Equipo médico certificado.",
    sourceUrl: "https://maps.google.com/bogota/clinic-2",
  },
  {
    name: "Dermastetic Bogotá",
    category: "Dermatología estética",
    city: "Bogotá",
    country: "Colombia",
    address: "Carrera 13 #82-21, Consultorio 305, Bogotá",
    website: "https://dermastetic.com.co",
    phone: "+57 601 7654300",
    email: "citas@dermastetic.com.co",
    socialLinks: {
      instagram: "https://instagram.com/dermastetic_bog",
      facebook: "https://facebook.com/dermasteticcolombia",
    },
    description:
      "Clínica dermatológica enfocada en acné, manchas y envejecimiento cutáneo. Tecnología láser fractional y peelings químicos. Atención personalizada.",
    sourceUrl: "https://maps.google.com/bogota/clinic-3",
  },
  {
    name: "Instituto de Belleza Integral Andino",
    category: "Spa médico",
    city: "Bogotá",
    country: "Colombia",
    address: "Calle 72 #11-25, Piso 3, Bogotá",
    website: undefined,
    phone: "+57 601 2345678",
    email: undefined,
    socialLinks: {
      facebook: "https://facebook.com/institutoandino",
    },
    description:
      "Spa médico con más de 8 años de experiencia. Masajes reductores, presoterapia y faciales. Sin sitio web oficial. Solo reservas por teléfono.",
    sourceUrl: "https://maps.google.com/bogota/clinic-4",
  },
  {
    name: "Clínica de Cirugía Plástica San Felipe",
    category: "Cirugía plástica",
    city: "Bogotá",
    country: "Colombia",
    address: "Calle 100 #18-30, Torre B Consultorio 502, Bogotá",
    website: "http://cirugia-san-felipe.com",
    phone: "+57 601 7459912",
    email: "citas@cirugia-san-felipe.com",
    socialLinks: {
      instagram: "https://instagram.com/cirugia_san_felipe",
    },
    description:
      "Clínica de cirugía plástica y reconstructiva. Cirugías de mama, rinoplastia, lipoescultura. Sitio web sin actualizar desde 2019, no responsivo en móvil.",
    sourceUrl: "https://maps.google.com/bogota/clinic-5",
  },
  {
    name: "Beauty Medical Center Bogotá",
    category: "Clínica de estética",
    city: "Bogotá",
    country: "Colombia",
    address: "Av. Suba #120-45, Bogotá",
    website: "https://beautymedicalcenter.co",
    phone: "+57 311 5678901",
    email: "info@beautymedicalcenter.co",
    socialLinks: {
      instagram: "https://instagram.com/beautymedicalbog",
      facebook: "https://facebook.com/BeautyMedicalBog",
      tiktok: "https://tiktok.com/@beautymedicalbog",
    },
    description:
      "Clínica premium con tecnología de vanguardia. Tratamientos faciales con HIFU, IPL y CO2. Atención VIP y memberships de skincare.",
    sourceUrl: "https://maps.google.com/bogota/clinic-6",
  },
  {
    name: "Estética & Salud Centro Bogotá",
    category: "Clínica de estética",
    city: "Bogotá",
    country: "Colombia",
    address: "Calle 80 #30-15, Bogotá",
    website: undefined,
    phone: undefined,
    email: undefined,
    socialLinks: {},
    description:
      "Clínica pequeña con presencia local en el barrio. Sin web ni redes sociales activas. Solo atienden por referidos.",
    sourceUrl: "https://maps.google.com/bogota/clinic-7",
  },
  {
    name: "Clínica Láser Bogotá Premium",
    category: "Clínica láser estética",
    city: "Bogotá",
    country: "Colombia",
    address: "Carrera 7 #115-30, Bogotá",
    website: "https://laserbogotapremium.com",
    phone: "+57 601 2345612",
    email: "reservas@laserbogotapremium.com",
    socialLinks: {
      instagram: "https://instagram.com/laserbogotapremium",
      facebook: "https://facebook.com/laserbogotapremium",
    },
    description:
      "Clínica especializada en depilación láser diodo yáguar. Tecnología Soprano Titanium. Precios premium. Sin sistema de reservas online.",
    sourceUrl: "https://maps.google.com/bogota/clinic-8",
  },
];

const medellinClinics: Omit<RawProspect, "source">[] = [
  {
    name: "Clínica Estética El Poblado",
    category: "Clínica de estética",
    city: "Medellín",
    country: "Colombia",
    address: "Calle 10 #36-25, El Poblado, Medellín",
    website: "https://esteticaelpoblado.com",
    phone: "+57 604 2680500",
    email: "citas@esteticaelpoblado.com",
    socialLinks: {
      instagram: "https://instagram.com/estetica_elpoblado",
      facebook: "https://facebook.com/estetica.elpoblado",
      tiktok: "https://tiktok.com/@estetica_elpoblado",
    },
    description:
      "Clínica pionera en El Poblado. Tratamientos faciales y corporales de última generación. Más de 15 años de experiencia en el sector.",
    sourceUrl: "https://maps.google.com/medellin/clinic-1",
  },
  {
    name: "Centro Médico Estético Innovarte",
    category: "Medicina estética",
    city: "Medellín",
    country: "Colombia",
    address: "Av. El Poblado #10-45, Medellín",
    website: "https://innovarte.com.co",
    phone: "+57 604 3112233",
    email: "info@innovarte.com.co",
    socialLinks: {
      instagram: "https://instagram.com/innovarte_med",
      facebook: "https://facebook.com/innovartemed",
    },
    description:
      "Centro médico con 5 sedes en Antioquia. Especialistas en medicina antiaging, bioestimulación de cabello y tratamientos hormonales.",
    sourceUrl: "https://maps.google.com/medellin/clinic-2",
  },
  {
    name: "Láser Med Medellín",
    category: "Clínica láser estética",
    city: "Medellín",
    country: "Colombia",
    address: "Carrera 43A #1Sur-50, Medellín",
    website: "http://lasermed-medellin.co",
    phone: "+57 604 4445566",
    email: "citas@lasermed-medellin.co",
    socialLinks: {
      instagram: "https://instagram.com/lasermed_med",
    },
    description:
      "Clínica especializada en láser médico. Depilación, tatuajes, manchas y rejuvenecimiento. Sitio web estático antiguo sin formulario de contacto.",
    sourceUrl: "https://maps.google.com/medellin/clinic-3",
  },
  {
    name: "Clínica de Cirugía Plástica Aura",
    category: "Cirugía plástica",
    city: "Medellín",
    country: "Colombia",
    address: "Calle 8 #39-60, El Poblado, Medellín",
    website: "https://clinicaaura.com.co",
    phone: "+57 604 3124455",
    email: "citas@clinicaaura.com.co",
    socialLinks: {
      instagram: "https://instagram.com/clinicaaura",
      facebook: "https://facebook.com/clinicaauramed",
      tiktok: "https://tiktok.com/@clinicaaura",
    },
    description:
      "Clínica premium de cirugía plástica. Recibe pacientes internacionales. Liderada por el Dr. Gómez. Marketing digital limitado, oportunidad de expansión.",
    sourceUrl: "https://maps.google.com/medellin/clinic-4",
  },
  {
    name: "Spa Médico La Molería",
    category: "Spa médico",
    city: "Medellín",
    country: "Colombia",
    address: "Calle 14 #43F-90, Medellín",
    website: undefined,
    phone: "+57 311 5678912",
    email: undefined,
    socialLinks: {
      facebook: "https://facebook.com/spalaspolerias",
    },
    description:
      "Spa médico boutique. Tratamientos faciales y masajes. Sin presencia online relevante. Solo reseñas locales en Google.",
    sourceUrl: "https://maps.google.com/medellin/clinic-5",
  },
  {
    name: "DermoEstética Medellín",
    category: "Dermatología estética",
    city: "Medellín",
    country: "Colombia",
    address: "Carrera 70 #1-80, Medellín",
    website: "https://dermoestetica-medellin.com",
    phone: "+57 604 1234567",
    email: "info@dermoestetica-medellin.com",
    socialLinks: {
      instagram: "https://instagram.com/dermoesteticamed",
      facebook: "https://facebook.com/dermoesteticamed",
    },
    description:
      "Clínica dermatológica. Tratamientos para acné, rosácea y psoriasis. Sitio web con blog actualizado regularmente, oportunidades de captación de leads.",
    sourceUrl: "https://maps.google.com/medellin/clinic-6",
  },
  {
    name: "Estética Vital Medellín",
    category: "Clínica de estética",
    city: "Medellín",
    country: "Colombia",
    address: "Calle 35 #78-15, Laureles, Medellín",
    website: "https://estheticavital.co",
    phone: "+57 604 7654321",
    email: "reservas@estheticavital.co",
    socialLinks: {
      instagram: "https://instagram.com/estheticavitalmed",
      facebook: "https://facebook.com/estheticavitalmed",
      tiktok: "https://tiktok.com/@estheticavital",
    },
    description:
      "Clínica de estética integral. Tratamientos faciales, corporales y hormonales. Crecimiento reciente — abrieron 2da sede en 2024.",
    sourceUrl: "https://maps.google.com/medellin/clinic-7",
  },
  {
    name: "Clínica Rejuvenecer Medellín",
    category: "Medicina estética",
    city: "Medellín",
    country: "Colombia",
    address: "Carrera 43A #6Sur-30, El Poblado, Medellín",
    website: "http://rejuvenecer-medellin.com",
    phone: "+57 604 3332222",
    email: undefined,
    socialLinks: {
      instagram: "https://instagram.com/rejuvenecer_med",
    },
    description:
      "Clínica enfocada en medicina antiaging. Hilo tensor, hilos PDO, bioestimulación. Sitio web desactualizado sin formulario. Reseñas negativas mencionan 'no contestan WhatsApp'.",
    sourceUrl: "https://maps.google.com/medellin/clinic-8",
  },
];

const caliClinics: Omit<RawProspect, "source">[] = [
  {
    name: "Clínica Estética Cali Sur",
    category: "Clínica de estética",
    city: "Cali",
    country: "Colombia",
    address: "Calle 5 #70-30, Cali",
    website: "https://clinicacalisur.com",
    phone: "+57 602 5678900",
    email: "info@clinicacalisur.com",
    socialLinks: {
      instagram: "https://instagram.com/clinicacalisur",
      facebook: "https://facebook.com/clinicacalisur",
    },
    description:
      "Clínica estética en el sur de Cali. Tratamientos faciales y corporales. Equipo médico certificado. Sitio web responsive pero sin sistema de reservas online.",
    sourceUrl: "https://maps.google.com/cali/clinic-1",
  },
  {
    name: "Centro Médico Estético Valle del Lili",
    category: "Medicina estética",
    city: "Cali",
    country: "Colombia",
    address: "Calle 98 #11-25, Cali",
    website: "https://cmesteticavalle.com",
    phone: "+57 602 4897700",
    email: "citas@cmesteticavalle.com",
    socialLinks: {
      instagram: "https://instagram.com/cmvalleestetica",
      facebook: "https://facebook.com/cmvalleestetica",
      tiktok: "https://tiktok.com/@cmvalleestetica",
    },
    description:
      "Centro médico cercano al hospital Valle del Lili. Enfoque en cirugía estética y reconstructiva. Liderado por cirujanos certificados.",
    sourceUrl: "https://maps.google.com/cali/clinic-2",
  },
  {
    name: "DermoPlus Cali",
    category: "Dermatología estética",
    city: "Cali",
    country: "Colombia",
    address: "Av. 6N #30-15, Cali",
    website: "http://dermopluscali.co",
    phone: "+57 602 6789012",
    email: undefined,
    socialLinks: {
      instagram: "https://instagram.com/dermopluscali",
    },
    description:
      "Clínica dermatológica. Tratamientos láser, acné, manchas. Sitio web viejo no responsivo. Reseñas mencionan demoras en respuestas.",
    sourceUrl: "https://maps.google.com/cali/clinic-3",
  },
];

export const mockAestheticClinics: Omit<RawProspect, "source">[] = [
  ...bogotaClinics,
  ...medellinClinics,
  ...caliClinics,
];

/** Build RawProspect[] from mock data filtered by city */
export function buildMockProspects(input: {
  city: string;
  category?: string;
  keywords?: string;
}): RawProspect[] {
  const cityNorm = input.city.toLowerCase().trim();
  let arr = mockAestheticClinics.filter(
    (c) => c.city?.toLowerCase() === cityNorm
  );

  // If city not in mock, return all (for demo flexibility)
  if (arr.length === 0) arr = mockAestheticClinics;

  if (input.category) {
    const cat = input.category.toLowerCase();
    arr = arr.filter(
      (c) =>
        c.category?.toLowerCase().includes(cat) ||
        c.description?.toLowerCase().includes(cat)
    );
    if (arr.length === 0) arr = mockAestheticClinics; // fallback
  }

  if (input.keywords) {
    const kw = input.keywords.toLowerCase();
    arr = arr.filter(
      (c) =>
        c.name?.toLowerCase().includes(kw) ||
        c.description?.toLowerCase().includes(kw) ||
        c.category?.toLowerCase().includes(kw)
    );
    if (arr.length === 0) arr = mockAestheticClinics; // fallback
  }

  return arr.map((c) => ({ ...c, source: "mock" }));
}
