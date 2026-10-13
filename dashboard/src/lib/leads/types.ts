// ============================================================
// src/lib/leads/types.ts — Shared types for lead source layer
// P1: campos enriquecidos de Places, marcado estructural DEMO y
// presencia digital (contratos 1, 3 y 10 de RADAR_DE_CLIENTES_PLAN.md).
// ============================================================

import type { ProviderResult } from "./envelope";

/** Contrato 3 — clasificación de presencia digital (4 estados). */
export type DigitalPresence =
  | "WEB_PROPIA_CONFIRMADA" // website propio verificado por fetch
  | "SOLO_RED_SOCIAL_O_DIRECTORIO" // sin website propio, pero con red social o ficha de directorio
  | "SIN_WEB_CONFIRMADA" // sin website ni redes/directorio detectados
  | "WEB_PENDIENTE_DE_VERIFICAR"; // website declarado por la fuente, aún sin verificar

export interface RawProspect {
  name: string;
  category?: string;
  city?: string;
  country?: string;
  address?: string;
  website?: string;
  phone?: string;
  email?: string;
  socialLinks?: {
    instagram?: string;
    facebook?: string;
    linkedin?: string;
    twitter?: string;
    tiktok?: string;
  };
  description?: string;
  source: string;
  sourceUrl?: string;
  // ── P1 · Contrato 1: Places enriquecido ──────────────────────
  placeId?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  ratingCount?: number;
  /** OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY (Google) */
  businessStatus?: string;
  // ── P1 · Contrato 10: marcado estructural DEMO/MOCK ─────────
  /** true ⇒ datos de demostración; bloquea outreach; sourceUrl debe ser null. */
  isMock?: boolean;
}

export interface SearchInput {
  city: string;
  country?: string;
  category?: string;
  keywords?: string;
  radius?: number;
  // optional user-provided context
  offerDescription?: string;
}

export interface LeadSourceAdapter {
  name: string;
  description: string;
  /** Returns true if the adapter is configured (has API keys etc.) */
  isConfigured(): Promise<boolean>;
  /**
   * P1 · Contrato 7: toda fuente devuelve envelope clasificado.
   * — 200 con resultados → {ok:true, data:[...], meta}
   * — 200 sin resultados → {ok:true, data:[], meta} (el orquestador lo trata como EMPTY)
   * — cualquier fallo → {ok:false, error:{code, message, httpStatus?, retryable}}
   * Nunca lanzar: los errores se devuelven en el envelope.
   */
  search(input: SearchInput): Promise<ProviderResult<RawProspect[]>>;
}
