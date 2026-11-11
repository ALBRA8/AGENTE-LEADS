// ============================================================
// src/lib/leads/dedup.ts — Deduplicación multi-señal de prospectos
// ------------------------------------------------------------
// Módulo 100% puro: sin imports de Next/Prisma para poder testearlo
// directamente desde la raíz (node --test --import tsx).
//
// Problema que resuelve: dos negocios DISTINTOS no deben fusionarse
// por tener el mismo nombre, y el orden de llegada no debe decidir
// cuál registro sobrevive.
//
// Señales (de más fuerte a más débil):
//   EXACT    — misma website normalizada O mismo teléfono normalizado
//              (ambos valores presentes).
//   STRONG   — mismo nombre normalizado + misma ciudad normalizada,
//              SIN conflicto de identificadores fuertes.
//   PROBABLE — solo mismo nombre normalizado (ciudad distinta o
//              desconocida). NUNCA fusiona por sí solo.
//   NONE     — sin señal de coincidencia.
//
// Conflictos (negativo decisivo, se evalúan ANTES que cualquier señal
// positiva, en este orden):
//   1. Ambas websites presentes y normalizadas difieren → distintos,
//      aunque el nombre y el teléfono coincidan.
//   2. Ambos teléfonos presentes y normalizados difieren → distintos.
//
// Solo se fusiona cuando hay señal EXACT o STRONG sin conflicto.
// ============================================================

export type DedupStrength = "EXACT" | "STRONG" | "PROBABLE" | "NONE";

export type DedupConflict = "website" | "phone";

export interface DedupVerdict {
  /** true solo cuando se puede fusionar (EXACT o STRONG, sin conflicto) */
  same: boolean;
  strength: DedupStrength;
  /** presente solo cuando hay negativo decisivo por señal en conflicto */
  conflict?: DedupConflict;
}

/** Campos usados para comparar y para puntuar completitud. */
export interface DedupIdentity {
  name: string;
  city?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  description?: string | null;
}

// ── Normalizadores ─────────────────────────────────────────────

/**
 * Normaliza un nombre de negocio:
 * minúsculas, sin tildes/diacríticos (NFD + eliminación de marcas de
 * combinación), espacios colapsados y trim.
 * "Café Pepe" → "cafe pepe"; "CAFE  PEPE" → "cafe pepe".
 */
export function normName(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normaliza una ciudad igual que normName (misma regla: es texto libre
 * con tildes y variantes de caso/espacios).
 */
export function normCity(s: string | null | undefined): string {
  return normName(s);
}

/**
 * Máximo de dígitos que se conservan de un teléfono. Los números locales
 * (Colombia) tienen 10 dígitos; si la representación trae prefijo de país
 * ("57...") este queda truncado al conservar los últimos 10 dígitos.
 */
export const PHONE_MAX_LOCAL_DIGITS = 10;

/**
 * Normaliza un teléfono. Regla SIMPLE y determinista:
 *  1. Conserva solo los dígitos (ignora "+", espacios, guiones, paréntesis).
 *  2. Descarta ceros a la izquierda.
 *  3. Si quedan más de PHONE_MAX_LOCAL_DIGITS dígitos, conserva los ÚLTIMOS
 *     10 (el prefijo de país es redundante para comparar).
 * Así "+57 300 111 22 33", "+573001112233" y "3001112233" canonicalizan al
 * mismo valor. Números más cortos se comparan tal cual: en el peor caso
 * producen un falso NEGATIVO (no se fusionan), nunca una fusión incorrecta.
 */
export function normPhone(s: string | null | undefined): string {
  if (!s) return "";
  let digits = s.replace(/\D+/g, "");
  digits = digits.replace(/^0+/, "");
  if (digits.length > PHONE_MAX_LOCAL_DIGITS) {
    digits = digits.slice(-PHONE_MAX_LOCAL_DIGITS);
  }
  return digits;
}

/**
 * Normaliza un sitio web:
 * minúsculas, sin protocolo http/https, sin "www." inicial, sin query ni
 * fragmento (?.../#...) y sin "/" final.
 * "https://www.CafePepe.com/contacto?utm=x" → "cafepepe.com/contacto".
 */
export function normSite(s: string | null | undefined): string {
  if (!s) return "";
  let out = s.trim().toLowerCase();
  out = out.replace(/^https?:\/\//, "");
  out = out.split(/[?#]/)[0];
  out = out.replace(/^www\./, "");
  out = out.replace(/\/+$/, "");
  return out;
}

// ── Decisión de identidad ──────────────────────────────────────

/**
 * Decide si dos identidades representan el mismo negocio.
 * Orden de evaluación (determinista):
 *  1. Conflicto de website (ambas presentes, normalizadas distintas) → false.
 *  2. Conflicto de teléfono (ambos presentes, normalizados distintos) → false.
 *  3. EXACT: misma website o mismo teléfono (ambos no vacíos e iguales).
 *  4. STRONG: mismo normName + misma ciudad normalizada (ambas no vacías).
 *  5. PROBABLE: solo mismo normName (ciudad distinta o desconocida) →
 *     same=false: nunca fusiona por sí solo.
 *  6. NONE.
 */
export function decideSameBusiness(a: DedupIdentity, b: DedupIdentity): DedupVerdict {
  const wa = normSite(a.website);
  const wb = normSite(b.website);
  if (wa && wb && wa !== wb) {
    // Negativo decisivo: dominios distintos, aunque el nombre coincida.
    return { same: false, strength: "NONE", conflict: "website" };
  }

  const pa = normPhone(a.phone);
  const pb = normPhone(b.phone);
  if (pa && pb && pa !== pb) {
    // Negativo decisivo: teléfonos distintos.
    return { same: false, strength: "NONE", conflict: "phone" };
  }

  if ((wa && wb && wa === wb) || (pa && pb && pa === pb)) {
    return { same: true, strength: "EXACT" };
  }

  const na = normName(a.name);
  const nb = normName(b.name);
  const ca = normCity(a.city);
  const cb = normCity(b.city);
  if (na && nb && na === nb && ca && cb && ca === cb) {
    // Sin conflicto de identificadores fuertes (ya descartado arriba).
    return { same: true, strength: "STRONG" };
  }
  if (na && nb && na === nb) {
    // Ciudad distinta o desconocida: ambiguo, nunca fusiona solo.
    return { same: false, strength: "PROBABLE" };
  }
  return { same: false, strength: "NONE" };
}

/** Un veredicto permite fusionar solo si es EXACT o STRONG sin conflicto. */
export function canMerge(v: DedupVerdict): boolean {
  return v.same && (v.strength === "EXACT" || v.strength === "STRONG");
}

// ── Selección de sobreviviente determinista ────────────────────

/** Campos que puntúan completitud (presence-based, 1 punto cada uno). */
export const COMPLETENESS_FIELDS: (keyof DedupIdentity)[] = [
  "website",
  "phone",
  "email",
  "address",
  "description",
];

/** Cuenta cuántos campos informativos tiene el registro (0-5). */
export function completenessScore(x: DedupIdentity): number {
  let score = 0;
  for (const field of COMPLETENESS_FIELDS) {
    const v = x[field];
    if (v !== null && v !== undefined && String(v).trim() !== "") score++;
  }
  return score;
}

/** Clave de desempate lexicográfica: nombre normalizado + ciudad normalizada. */
export function survivorKey(x: DedupIdentity): string {
  return `${normName(x.name)}|${normCity(x.city)}`;
}

/**
 * Elige el sobreviviente de un grupo de duplicados de forma DETERMINISTA:
 * gana el más completo (más campos presentes); en empate gana el que tenga
 * la clave lexicográficamente menor (normName + normCity).
 * El orden de llegada NO influye en el resultado.
 */
export function pickSurvivor<T extends DedupIdentity>(candidates: T[]): T {
  if (candidates.length === 0) {
    throw new Error("pickSurvivor: se requiere al menos un candidato");
  }
  let best = candidates[0];
  let bestScore = completenessScore(best);
  let bestKey = survivorKey(best);
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const score = completenessScore(c);
    const key = survivorKey(c);
    if (score > bestScore || (score === bestScore && key < bestKey)) {
      best = c;
      bestScore = score;
      bestKey = key;
    }
  }
  return best;
}

// ── Funciones de alto nivel para las rutas ─────────────────────

/**
 * Deduplica una lista de resultados crudos (varias queries / proveedores).
 * Solo fusiona pares con señal EXACT o STRONG sin conflicto; los ambiguos
 * (PROBABLE) se mantienen como registros separados.
 * El sobreviviente de cada grupo se elige con pickSurvivor (determinista).
 * Conservador: no combina campos entre duplicados, solo escoge el ganador.
 */
export function dedupProspects<T extends DedupIdentity>(
  items: T[]
): { unique: T[]; duplicatesRemoved: number } {
  const clusters: T[] = [];
  for (const item of items) {
    let merged = false;
    for (let i = 0; i < clusters.length; i++) {
      if (canMerge(decideSameBusiness(item, clusters[i]))) {
        clusters[i] = pickSurvivor([clusters[i], item]);
        merged = true;
        break;
      }
    }
    if (!merged) clusters.push(item);
  }
  return { unique: clusters, duplicatesRemoved: items.length - clusters.length };
}

/**
 * Dado un prospecto crudo y una lista de candidatos de la BD, devuelve el
 * registro existente con el que se puede fusionar (señal EXACT o STRONG
 * sin conflicto de website/teléfono), o null si ninguno califica.
 * Si solo coincide por nombre con conflicto de identificadores fuertes →
 * null (el llamador debe crear un registro nuevo). Si varios califican,
 * el sobreviviente se elige con pickSurvivor (independiente del orden de
 * las filas). El registro devuelto es el objeto existente SIN MUTAR: el
 * llamador nunca debe sobreescribirlo.
 */
export function matchExistingProspect<T extends DedupIdentity>(
  rp: DedupIdentity,
  candidates: T[]
): T | null {
  const qualifying = candidates.filter((c) =>
    canMerge(decideSameBusiness(rp, c))
  );
  if (qualifying.length === 0) return null;
  return pickSurvivor(qualifying);
}
