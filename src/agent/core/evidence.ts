// ============================================================
// src/agent/core/evidence.ts
// P0.6 — Evidence engine.
//
// Rule: a system inference must NOT be presented as an observed fact.
//
// Status hierarchy:
//   FOUND              — the value was observed in a public source
//   NOT_FOUND          — search attempted, value did not appear
//   CONFIRMED_ABSENT   — multiple sources confirm it does not exist
//   INFERRED           — value derived by the system (not directly observed)
//
// Examples:
//   website: NOT_FOUND     ≠  website: no tiene website  (do not say "no tiene")
//   email:    FOUND        + source: "Instagram bio"
//   niche:    INFERRED     + reason: "posts mention 'restaurant vegano' 12x"
// ============================================================

export type ObservationStatus =
  | "FOUND"
  | "NOT_FOUND"
  | "CONFIRMED_ABSENT"
  | "INFERRED";

export type ConfidenceLevel =
  | "high"     // multiple sources agree
  | "medium"   // one source, plausible
  | "low"      // one source, noisy
  | "none";    // INFERRED or no confidence

export interface EvidenceRecord<T = string> {
  /** Field name this evidence refers to ("email", "website", "instagram", ...) */
  field: string;
  /** The observed/inferred value */
  value: T | null;
  /** Status of the observation */
  status: ObservationStatus;
  /** Where the value came from ("Apify Google Search", "Scrapling fetch", ...) */
  source: string;
  /** When the evidence was collected (ISO 8601) */
  retrieved_at: string;
  /** Confidence level — high/medium/low/none */
  confidence: ConfidenceLevel;
  /** Free-form evidence supporting the claim (URLs, snippets, ...) */
  evidence: string;
  /** For INFERRED values: reasoning chain */
  inferred_from?: string[];
}

/**
 * Helper: build evidence for a value we actually observed in a source.
 */
export function found<T>(
  field: string,
  value: T,
  source: string,
  evidence: string,
  confidence: ConfidenceLevel = "medium"
): EvidenceRecord<T> {
  return {
    field,
    value,
    status: "FOUND",
    source,
    retrieved_at: new Date().toISOString(),
    confidence,
    evidence,
  };
}

/**
 * Helper: build evidence for a value that we searched for but did not find.
 *
 * IMPORTANT: NOT_FOUND ≠ CONFIRMED_ABSENT.
 * NOT_FOUND: we looked, it didn't appear. We don't know if it exists.
 * CONFIRMED_ABSENT: multiple sources indicate it doesn't exist.
 */
export function notFound(
  field: string,
  source: string,
  evidence: string = "Searched, value did not appear"
): EvidenceRecord {
  return {
    field,
    value: null,
    status: "NOT_FOUND",
    source,
    retrieved_at: new Date().toISOString(),
    confidence: "low",
    evidence,
  };
}

export function confirmedAbsent(
  field: string,
  source: string,
  evidence: string
): EvidenceRecord {
  return {
    field,
    value: null,
    status: "CONFIRMED_ABSENT",
    source,
    retrieved_at: new Date().toISOString(),
    confidence: "high",
    evidence,
  };
}

export function inferred<T>(
  field: string,
  value: T,
  reason: string,
  inferred_from: string[] = []
): EvidenceRecord<T> {
  return {
    field,
    value,
    status: "INFERRED",
    source: "system-inference",
    retrieved_at: new Date().toISOString(),
    confidence: "none",
    evidence: reason,
    inferred_from,
  };
}

/**
 * Human-readable representation for reports. Uses:
 *   "encontrado"     → FOUND
 *   "no encontrado"  → NOT_FOUND  (NOT "no tiene"!)
 *   "ausente confirmado" → CONFIRMED_ABSENT
 *   "inferido"       → INFERRED
 */
export function statusLabel(s: ObservationStatus): string {
  switch (s) {
    case "FOUND": return "encontrado";
    case "NOT_FOUND": return "no encontrado";
    case "CONFIRMED_ABSENT": return "ausente confirmado";
    case "INFERRED": return "inferido";
  }
}

export function confidenceLabel(c: ConfidenceLevel): string {
  switch (c) {
    case "high": return "alta";
    case "medium": return "media";
    case "low": return "baja";
    case "none": return "ninguna";
  }
}
