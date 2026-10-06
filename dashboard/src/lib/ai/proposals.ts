// ============================================================
// src/lib/ai/proposals.ts — Proposal generation with 4 styles
// ============================================================

import { aiChat } from "./client";
import type { OfferContext, ProspectContext } from "./qualification";

export type ProposalStyle =
  | "professional"
  | "friendly"
  | "direct"
  | "persuasive";

export interface ProposalInput {
  offer: OfferContext;
  prospect: ProspectContext;
  style: ProposalStyle;
  painType?: string | null;
  painEvidence?: string | null;
}

const STYLE_GUIDE: Record<ProposalStyle, string> = {
  professional: `Tono profesional y respetuoso. Usa "usted". Estructura formal: saludo, presentación, identificación de oportunidad, propuesta, llamada a la acción. Sin emojis.`,
  friendly: `Tono cálido y cercano pero profesional. Usa "tú" con cuidado. Estructura relajada: saludo, presentación empática, identificación de necesidad, propuesta, cierre amigable. Sin emojis excesivos.`,
  direct: `Tono directo y conciso. Frases cortas. Estructura: saludo, problema detectado, solución propuesta, llamada a la acción clara. Sin rodeos. Sin emojis.`,
  persuasive: `Tono persuasivo pero no agresivo. Estructura: saludo, hook con dato impactante, identificación de oportunidad, propuesta con beneficios concretos, llamada a la acción con urgencia moderada. Sin emojis.`,
};

export async function generateProposal(input: ProposalInput): Promise<string> {
  const { offer, prospect, style, painType, painEvidence } = input;
  let social: any = undefined;
  try {
    if (prospect.socialLinks) social = JSON.parse(prospect.socialLinks);
  } catch {}

  const system = `Eres un copywriter comercial experto en B2B. Generas propuestas comerciales personalizadas para prospectos basándote en su información pública.

REGLAS OBLIGATORIAS:
1. Menciona SIEMPRE el nombre del negocio (${prospect.name}) en los primeros 2 párrafos.
2. Identifica una posible necesidad u oportunidad ESPECÍFICA basándote en la evidencia pública disponible.
3. Explica cómo el producto/servicio del usuario puede ayudar CONCRETAMENTE.
4. Propón una solución específica, no genérica.
5. Incluye UNA llamada a la acción clara al final.
6. Tono: ${STYLE_GUIDE[style]}
7. NO menciones que la información fue obtenida mediante scraping o análisis automático.
8. NO inventes datos del prospecto que no están en la información pública proporcionada.
9. Si hay pain evidence detectado (${painEvidence || "ninguno"}), úsalo como base concreta de la propuesta.
10. Longitud: 150-250 palabras. Ni más ni menos.

${painEvidence ? `PAIN EVIDENCE DETECTADO POR EL SISTEMA: ${painEvidence}
Utiliza esta evidencia como base concreta de por qué el prospecto necesita el servicio.` : `No se detectó pain específico. Identifica una oportunidad razonable basándote en la información pública del prospecto.`}

Devuelve ÚNICAMENTE el texto de la propuesta, sin asunto, sin comentarios, sin markdown, sin prefacios.`;

  const userMsg = `OFERTA DEL USUARIO:
- Producto/servicio: ${offer.name}
- Descripción: ${offer.description}
- Precio: ${offer.priceRange || "a conversar"}
- Cliente ideal: ${offer.idealCustomer || "negocios del sector"}

PROSPECTO:
- Nombre del negocio: ${prospect.name}
- Categoría: ${prospect.category || "n/a"}
- Ciudad: ${prospect.city || "n/a"}
- Sitio web: ${prospect.website || "no tiene"}
- Redes sociales: ${social ? JSON.stringify(social) : "no tiene"}
- Descripción pública: ${prospect.description || "no disponible"}
- Pain detectado: ${painType || "ninguno específico"}
- Evidencia del pain: ${painEvidence || "no se detectó evidencia específica"}

Genera la propuesta en estilo ${style}.`;

  try {
    const text = await aiChat([
      { role: "system", content: system },
      { role: "user", content: userMsg },
    ]);
    return text.trim();
  } catch (e: any) {
    console.error("[proposals] AI error:", e.message);
    return `(No se pudo generar la propuesta automáticamente. Error: ${e.message})`;
  }
}
