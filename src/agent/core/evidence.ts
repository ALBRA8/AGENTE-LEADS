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
  | "INFERRED"
  // Production closure (§9): an explicit contradiction between sources.
  | "CONTRADICTED";

/**
 * §9 Truth levels — how close a piece of evidence is to ground truth.
 * Mapping from ObservationStatus (+ confidence for VERIFIED):
 *   FOUND + (high|medium)            → VERIFIED
 *   FOUND + (low|none)               → UNVERIFIED
 *   NOT_FOUND                        → UNKNOWN
 *   CONFIRMED_ABSENT                 → VERIFIED (absence is verified)
 *   INFERRED                         → INFERRED
 *   CONTRADICTED                     → CONTRADICTED
 *   ESTIMATED is reserved for quantified guesses (ranges, counts)
 *   produced by deterministic estimation logic (never by the LLM).
 */
export type TruthLevel =
  | "VERIFIED"
  | "INFERRED"
  | "ESTIMATED"
  | "UNVERIFIED"
  | "CONTRADICTED"
  | "UNKNOWN";

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
  /** §9 truth level — optional for backwards compatibility; new records always set it */
  truth_level?: TruthLevel;
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
    truth_level: truthLevelOf("FOUND", confidence),
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
    truth_level: "UNKNOWN",
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
    truth_level: "VERIFIED",
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
    truth_level: "INFERRED",
  };
}

/**
 * §9: evidence for a value where two sources disagree.
 * A CONTRADICTED record must NEVER be presented as a fact.
 */
export function contradicted<T>(
  field: string,
  values: [T | null, T | null],
  sources: [string, string],
  evidence: string
): EvidenceRecord<T> {
  return {
    field,
    value: (values[0] ?? values[1] ?? null) as T | null,
    status: "CONTRADICTED",
    source: sources.join(" vs "),
    retrieved_at: new Date().toISOString(),
    confidence: "low",
    evidence,
    truth_level: "CONTRADICTED",
  };
}

/**
 * §9: derive the truth level of an evidence record from its status + confidence.
 * Deterministic mapping — see TruthLevel doc.
 */
export function truthLevelOf(
  status: ObservationStatus,
  confidence: ConfidenceLevel = "low"
): TruthLevel {
  switch (status) {
    case "FOUND":
      return confidence === "high" || confidence === "medium" ? "VERIFIED" : "UNVERIFIED";
    case "CONFIRMED_ABSENT":
      return "VERIFIED";
    case "INFERRED":
      return "INFERRED";
    case "NOT_FOUND":
      return "UNKNOWN";
    case "CONTRADICTED":
      return "CONTRADICTED";
  }
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
    case "CONTRADICTED": return "contradicho";
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
