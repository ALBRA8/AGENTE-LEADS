// ============================================================
// src/agent/affiliate-catalog.ts
// Catálogo de Productos y Ofertas de Afiliados para Cierre de Ventas
// Conectado con el ecosistema YouTube Automation & JVZoo
// ============================================================

export interface AffiliateProduct {
  id: string;
  aliases: string[];
  name: string;
  tagline: string;
  dealPrice: string;
  regularPrice: string;
  discountPct: string;
  vendor: string;
  affiliateUrl: string;
  guaranteeDays: number;
  benefits: string[];
  faq: Array<{ question: string; answer: string }>;
  closingPitch: string;
}

export const AFFILIATE_PRODUCTS: Record<string, AffiliateProduct> = {
  adastra: {
    id: "adastra",
    aliases: ["adastra", "adastra studio", "studio bundle", "bundle video", "video ia"],
    name: "Adastra Studio Bundle — Suite de Producción de Video IA",
    tagline: "Reemplaza un equipo completo de edición audiovisual sin suscripciones mensuales",
    dealPrice: "$67 USD (Pago Único)",
    regularPrice: "$197 USD",
    discountPct: "65% OFF",
    vendor: "Adastra AI Labs",
    affiliateUrl: "https://www.jvzoo.com/c/1/446851?tid=topseller",
    guaranteeDays: 30,
    benefits: [
      "🎭 Avatares hiperrealistas 4K con sincronización labial precisa (LipSync)",
      "💬 Generador de subtítulos dinámicos estilo Hormozi / MrBeast automáticos",
      "✂️ Auto-inserción de B-Rolls y efectos de sonido (SFX) sincronizados al guion",
      "🌍 Doblaje multilingüe a más de 40 idiomas con voces neuronales",
      "🚫 Cero costos mensuales recurrentes durante la ventana de lanzamiento"
    ],
    faq: [
      {
        question: "¿Es una suscripción mensual o pago único?",
        answer: "Es pago único de $67 durante la fase de lanzamiento oficial en JVZoo. No hay pagos recurrentes obligatorios."
      },
      {
        question: "¿Tiene garantía si no me gusta?",
        answer: "Sí, cuentas con 30 días de garantía total de devolución respaldada por la plataforma JVZoo."
      },
      {
        question: "¿Funciona en Windows y Mac?",
        answer: "Sí, es compatible tanto con Mac como con Windows, y no requiere tarjetas gráficas de última generación."
      }
    ],
    closingPitch: "🔥 Puedes reclamar el 65% de descuento especial en el enlace oficial de JVZoo aquí: https://www.jvzoo.com/c/1/446851?tid=topseller"
  },
  spark: {
    id: "spark",
    aliases: ["spark", "spark ai", "spark video", "shorts creator"],
    name: "Spark AI Video Creator — Generador Ultrarrápido de Shorts Virales",
    tagline: "Crea hasta 30 videos verticales para TikTok y YouTube Shorts en menos de 10 minutos",
    dealPrice: "$37 USD",
    regularPrice: "$97 USD",
    discountPct: "60% OFF",
    vendor: "SparkTech Media",
    affiliateUrl: "https://www.jvzoo.com/affiliate/affiliateinfonew/index/436239",
    guaranteeDays: 30,
    benefits: [
      "⚡ Flujo de 0 a Short renderizado en 60 segundos",
      "📱 Formato 9:16 nativo con stickers de enganche psicológico",
      "🔄 Repurposing automático de podcasts a micro-clips",
      "📈 Predicción de retención de audiencia segundo a segundo"
    ],
    faq: [
      {
        question: "¿Para qué plataformas sirve?",
        answer: "Genera formatos optimizados para YouTube Shorts, TikTok, Instagram Reels y Facebook Stories."
      }
    ],
    closingPitch: "🚀 Consigue tu copia con precio promocional aquí: https://www.jvzoo.com/affiliate/affiliateinfonew/index/436239"
  },
  viralrevenue: {
    id: "viralrevenue",
    aliases: ["viralrevenue", "viral revenue", "canales sin rostro", "faceless"],
    name: "ViralRevenueAI — Automatización de Canales Faceless y Monetización",
    tagline: "El mapa exacto para monetizar canales de YouTube sin mostrar tu rostro",
    dealPrice: "$47 USD",
    regularPrice: "$147 USD",
    discountPct: "68% OFF",
    vendor: "RevenueEngine AI",
    affiliateUrl: "https://www.jvzoo.com/c/1/442785?tid=topseller",
    guaranteeDays: 30,
    benefits: [
      "🎯 Detector de nichos con RPM mayor a $20 USD por cada mil vistas",
      "📝 Guiones hipnóticos estructurados para maximizar retención > 70%",
      "💸 Estrategia de monetización con afiliados antes de los 1,000 suscriptores"
    ],
    faq: [
      {
        question: "¿Necesito experiencia previa?",
        answer: "No, está diseñado con plantillas paso a paso desde nivel cero."
      }
    ],
    closingPitch: "💡 Accede a ViralRevenueAI con descuento de lanzamiento aquí: https://www.jvzoo.com/c/1/442785?tid=topseller"
  }
};

export function findProductByQuery(query: string): AffiliateProduct | null {
  const q = query.toLowerCase().trim();
  for (const product of Object.values(AFFILIATE_PRODUCTS)) {
    if (product.id === q || product.name.toLowerCase().includes(q)) {
      return product;
    }
    for (const alias of product.aliases) {
      if (q.includes(alias)) {
        return product;
      }
    }
  }
  return null;
}

export function formatProductPitch(prod: AffiliateProduct): string {
  const benefitsList = prod.benefits.map((b) => `• ${b}`).join("\n");
  return (
    `💎 *${prod.name}*\n` +
    `_${prod.tagline}_\n\n` +
    `💰 *Precio de Oferta:* ${prod.dealPrice} ~(${prod.regularPrice})~ *[${prod.discountPct}]*\n` +
    `🛡️ *Garantía:* ${prod.guaranteeDays} días de reembolso asegurado\n\n` +
    `*Lo más destacado:*\n${benefitsList}\n\n` +
    `🔗 *Enlace directo con descuento:* [Haz clic aquí para comprar en JVZoo](${prod.affiliateUrl})\n\n` +
    `¿Tienes alguna duda sobre si te sirve para tu nicho? Pregúntame lo que sea.`
  );
}
