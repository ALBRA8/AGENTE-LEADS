// ============================================================
// src/lib/leads/evidence-builder.ts — P1 · Contrato 2
// Evidencia por campo, espejo del EvidenceRecord del bot raíz
// (FOUND/NOT_FOUND/CONFIRMED_ABSENT/INFERRED + confidence + source).
// Funciones puras: construye los borradores que luego persiste la
// tabla Evidence (prospectId, field, value, status, source, …).
// RADAR_DE_CLIENTES_PLAN.md contrato 2.
// ============================================================

import type { RawProspect } from "./types";

export type EvidenceStatus =
  | "FOUND" // dato presente, aportado por la fuente
  | "NOT_FOUND" // dato ausente en la fuente (ausencia auditable)
  | "CONFIRMED_ABSENT" // ausencia verificada activamente (p. ej. fetch 404)
  | "INFERRED"; // deducido por el sistema, no declarado por la fuente

export interface EvidenceDraft {
  field: string;
  value?: string;
  status: EvidenceStatus;
  source: string;
  sourceUrl?: string;
  confidence: number;
}

/**
 * Confianza base por fuente (0–1). Cualquier fuente no catalogada
 * cae al valor neutro 0.5.
 */
const SOURCE_CONFIDENCE: Record<string, number> = {
  mock: 0.4, // datos de demostración (contrato 10)
  google_places: 0.95,
  overpass: 0.8,
  web_search: 0.7,
  web_scraper: 0.6,
  manual: 1.0,
};

export function sourceConfidence(source: string): number {
  return SOURCE_CONFIDENCE[source] ?? 0.5;
}

/**
 * Construye la evidencia de descubrimiento de un prospecto.
 *
 * - Campos presentes → FOUND con value=String(valor): website, phone,
 *   email, address, rating (si rating != null) y placeId (si presente).
 * - website/phone/email AUSENTES → entrada NOT_FOUND (sin value) para
 *   que la ausencia sea auditable. Ningún otro campo genera NOT_FOUND.
 * - Contrato 10: si isMock, la fuente se fuerza a "mock" (confidence
 *   0.4) y sourceUrl se anula aunque viniera informada.
 * - Orden estable para tests: primero FOUND, luego NOT_FOUND.
 */
export function buildDiscoveryEvidence(rp: RawProspect): EvidenceDraft[] {
  const source = rp.isMock ? "mock" : rp.source;
  const sourceUrl = rp.isMock ? undefined : rp.sourceUrl;
  const confidence = sourceConfidence(source);

  const found: EvidenceDraft[] = [];
  const notFound: EvidenceDraft[] = [];

  const markFound = (field: string, raw: string | number | undefined | null): void => {
    if (raw === undefined || raw === null || raw === "") return;
    const entry: EvidenceDraft = {
      field,
      value: String(raw),
      status: "FOUND",
      source,
      confidence,
    };
    if (sourceUrl !== undefined) entry.sourceUrl = sourceUrl;
    found.push(entry);
  };

  const markNotFound = (field: string): void => {
    const entry: EvidenceDraft = {
      field,
      status: "NOT_FOUND",
      source,
      confidence,
    };
    if (sourceUrl !== undefined) entry.sourceUrl = sourceUrl;
    notFound.push(entry);
  };

  // ── FOUND: solo campos presentes (orden estable) ───────────
  markFound("website", rp.website);
  markFound("phone", rp.phone);
  markFound("email", rp.email);
  markFound("address", rp.address);
  if (rp.rating != null) markFound("rating", rp.rating); // != null ⇒ incluye 0
  if (rp.placeId) markFound("placeId", rp.placeId);

  // ── NOT_FOUND: solo website/phone/email (ausencia auditable) ──
  if (!rp.website) markNotFound("website");
  if (!rp.phone) markNotFound("phone");
  if (!rp.email) markNotFound("email");

  return [...found, ...notFound];
}
