// ============================================================
// src/lib/leads/digital-presence.ts — P1 · Contrato 3
// Clasificación de presencia digital en 4 estados, a partir solo
// de datos ya presentes en el prospecto (sin red ni DB).
// RADAR_DE_CLIENTES_PLAN.md contrato 3:
//   WEB_PROPIA_CONFIRMADA | SOLO_RED_SOCIAL_O_DIRECTORIO |
//   SIN_WEB_CONFIRMADA | WEB_PENDIENTE_DE_VERIFICAR
// ============================================================

import type { DigitalPresence, RawProspect } from "./types";

/** Subconjunto de campos de RawProspect necesarios para clasificar. */
export type DigitalPresenceInput = Pick<
  RawProspect,
  "website" | "socialLinks" | "sourceUrl" | "source"
>;

/**
 * Clasifica la presencia digital de un prospecto:
 * - website truthy → WEB_PENDIENTE_DE_VERIFICAR (la fuente lo declara,
 *   aún sin verificar por fetch; la confirmación la hace confirmWeb).
 * - si no: alguna red social con valor (instagram/facebook/linkedin/
 *   twitter/tiktok) O sourceUrl truthy con source !== "mock"
 *   → SOLO_RED_SOCIAL_O_DIRECTORIO.
 *   (Contrato 10: los mocks no cuentan como presencia real.)
 * - resto → SIN_WEB_CONFIRMADA.
 */
export function classifyDigitalPresence(rp: DigitalPresenceInput): DigitalPresence {
  if (rp.website) return "WEB_PENDIENTE_DE_VERIFICAR";

  const links = rp.socialLinks ?? {};
  const hasSocial = Boolean(
    links.instagram?.trim() ||
      links.facebook?.trim() ||
      links.linkedin?.trim() ||
      links.twitter?.trim() ||
      links.tiktok?.trim()
  );
  // sourceUrl de un mock no es presencia digital auditable (contrato 10).
  const hasDirectory = Boolean(rp.sourceUrl && rp.source !== "mock");

  if (hasSocial || hasDirectory) return "SOLO_RED_SOCIAL_O_DIRECTORIO";
  return "SIN_WEB_CONFIRMADA";
}

/**
 * Promueve WEB_PENDIENTE_DE_VERIFICAR → WEB_PROPIA_CONFIRMADA
 * (p. ej. tras un fetch exitoso de la web). Cualquier otro estado
 * se devuelve sin cambio: no se puede "confirmar" lo que no existe.
 */
export function confirmWeb(presence: DigitalPresence): DigitalPresence {
  return presence === "WEB_PENDIENTE_DE_VERIFICAR"
    ? "WEB_PROPIA_CONFIRMADA"
    : presence;
}

/** Etiquetas en español listas para UI (badges de la ficha). */
export const DIGITAL_PRESENCE_LABELS: Record<DigitalPresence, string> = {
  WEB_PROPIA_CONFIRMADA: "Web propia confirmada",
  SOLO_RED_SOCIAL_O_DIRECTORIO: "Solo red social o directorio",
  SIN_WEB_CONFIRMADA: "Sin web confirmada",
  WEB_PENDIENTE_DE_VERIFICAR: "Web por verificar",
};
