// ============================================================
// src/lib/leads/dedup.ts — P1 · Dedup multi-señal (funciones puras)
// Espejo del pipeline dedup del bot raíz: 3 señales EXACT/STRONG/
// PROBABLE con claves canónicas. Sin dependencias de DB ni red.
// RADAR_DE_CLIENTES_PLAN.md — fase P1 "dedup multi-señal".
// ============================================================

import type { RawProspect } from "./types";

/** Señales de matching, de más fuerte a más débil. */
export type DedupSignal = "EXACT" | "STRONG" | "PROBABLE";

export interface DedupCandidate {
  signal: DedupSignal;
  key: string;
}

/**
 * Resultado de comparar dos prospectos.
 * `match:false` se representa con `null` (no hay objeto).
 */
export interface DedupMatch {
  match: boolean;
  signal: DedupSignal;
  key: string;
}

/** Fuerza relativa de cada señal (mayor = más fuerte). */
const SIGNAL_RANK: Record<DedupSignal, number> = {
  EXACT: 3,
  STRONG: 2,
  PROBABLE: 1,
};

/**
 * Normaliza un nombre para comparación:
 * minúsculas → sin diacríticos (NFD + rango combinante) →
 * solo alfanuméricos y espacios → espacios colapsados → trim.
 * Devuelve "" si la entrada es vacía/undefined.
 */
export function normName(s?: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita diacríticos combinantes (á→a, ñ→n, …)
    .replace(/[^a-z0-9\s]/g, "") // quita todo lo no alfanumérico salvo espacios
    .replace(/\s+/g, " ") // colapsa espacios
    .trim();
}

/**
 * Normaliza un teléfono a dígitos puros.
 * Quita ceros iniciales redundantes (y el "+" cae con el filtro \D).
 * Devuelve "" si tras normalizar quedan <7 dígitos (evita falsos
 * positivos con códigos cortos o basura tipo "911").
 */
export function normPhone(s?: string): string {
  if (!s) return "";
  const digits = s
    .replace(/\D/g, "") // solo dígitos (descarta "+", espacios, paréntesis, guiones)
    .replace(/^0+/, ""); // quita ceros iniciales redundantes
  return digits.length < 7 ? "" : digits;
}

/**
 * Normaliza un sitio web a su host canónico:
 * minúsculas, sin protocolo (http/https), sin "www.", solo host
 * (sin path/query/fragmento) y sin slash final. "" si vacío.
 */
export function normSite(s?: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "") // quitar protocolo
    .replace(/^www\./, "") // quitar subdominio www.
    .split(/[/?#]/)[0] ?? ""; // conservar solo host (corta en path/query/fragmento)
}

/**
 * Construye las claves de dedup de un prospecto, ordenadas
 * EXACT → STRONG → PROBABLE y sin duplicados.
 *
 * - EXACT: placeId, teléfono normalizado, website normalizado
 *   (el website es identidad fuerte de negocio).
 * - STRONG: nombre normalizado + ciudad normalizada.
 * - PROBABLE: solo nombre normalizado.
 */
export function buildDedupCandidates(rp: RawProspect): DedupCandidate[] {
  const candidates: DedupCandidate[] = [];
  const seen = new Set<string>();
  const push = (signal: DedupSignal, key: string): void => {
    if (!key || seen.has(key)) return; // sin claves duplicadas
    seen.add(key);
    candidates.push({ signal, key });
  };

  // ── EXACT: identidad fuerte de negocio ─────────────────────
  if (rp.placeId) push("EXACT", `place:${rp.placeId}`);
  const tel = normPhone(rp.phone);
  if (tel) push("EXACT", `tel:${tel}`);
  const web = normSite(rp.website);
  if (web) push("EXACT", `web:${web}`);

  const name = normName(rp.name);
  const city = normName(rp.city);

  // ── STRONG: nombre + ciudad (ambos no vacíos) ──────────────
  if (name && city) push("STRONG", `nc:${name}|${city}`);

  // ── PROBABLE: solo nombre (no vacío) ───────────────────────
  if (name) push("PROBABLE", `n:${name}`);

  return candidates;
}

/**
 * Compara dos prospectos por intersección de claves de dedup y
 * devuelve el match de señal MÁS fuerte (EXACT > STRONG > PROBABLE).
 * Devuelve null si no hay intersección (representa match:false).
 */
export function sameBusiness(a: RawProspect, b: RawProspect): DedupMatch | null {
  const keysOfB = new Set(buildDedupCandidates(b).map((c) => c.key));

  let best: DedupMatch | null = null;
  for (const candidate of buildDedupCandidates(a)) {
    if (!keysOfB.has(candidate.key)) continue;
    if (!best || SIGNAL_RANK[candidate.signal] > SIGNAL_RANK[best.signal]) {
      best = { match: true, signal: candidate.signal, key: candidate.key };
    }
    if (best.signal === "EXACT") break; // no existe señal más fuerte
  }
  return best;
}
