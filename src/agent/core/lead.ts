// ============================================================
// src/agent/core/lead.ts
// P0.1 — Canonical Lead model.
//
// Providers MUST produce normalized CandidateLead / Lead objects.
// The internal model is NOT coupled to Apify, Scrapling, Google
// Search or any provider.
// ============================================================

import type { EvidenceRecord } from "./evidence.js";

// ── CandidateLead (P0.3 output — discovered but not yet researched) ────
export interface CandidateLead {
  name: string;
  username?: string | null;
  platform?: string | null;       // "instagram" | "google_search" | "linkedin" | ...
  url?: string | null;
  location?: string | null;
  category?: string | null;
  niche?: string | null;
  description?: string | null;
  raw_data?: Record<string, unknown> | null;  // original payload from provider
  source: string;                   // provider name that discovered this candidate
  discovered_at: string;            // ISO 8601
}

// ── Lead (post-research, post-validation — the canonical entity) ──────
export interface Lead {
  /** Stable internal id (set after dedup/storage) */
  id?: string;
  /** Identity fields */
  name: string;
  username?: string | null;
  platform?: string | null;
  url?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  category?: string | null;
  niche?: string | null;
  description?: string | null;

  /** Where this lead came from (provider chain) */
  sources: string[];

  /** When the candidate was first discovered (ISO 8601) */
  discovered_at: string;

  /** Per-field evidence (P0.6) — the source of truth for every important value */
  evidence: EvidenceRecord[];

  /** Validation state (P0.5) — covers email/domain/url/profile */
  validation: ValidationState;

  /** Investigation progress */
  research_state: ResearchState;

  /** Dedup signature (P0.7) — pre-computed to speed up dedup */
  dedup_signature?: DedupSignature;

  /** P1.1: numeric Lead Score (0-100) — populated by runScoring */
  lead_score?: number;
}

export interface ValidationState {
  email?: ValidationResult;
  domain?: ValidationResult;
  url?: ValidationResult;
  profile?: ValidationResult;
  identity?: ValidationResult;
  cross_source_consistency?: ValidationResult;
}

export interface ValidationResult {
  status: "unverified" | "valid" | "invalid" | "unknown" | "conflict";
  confidence: "high" | "medium" | "low" | "none";
  checked_at: string;        // ISO 8601
  source: string;
  notes?: string;
}

export type ResearchState =
  | "DISCOVERED"   // candidate only
  | "RESEARCHING"  // research in progress
  | "RESEARCHED"   // research completed (may or may not have found data)
  | "VALIDATED"    // validation completed
  | "STORED"       // persisted after dedup
  | "FAILED";      // pipeline failed; see execution trace

// ── DedupSignature (P0.7) ────────────────────────────────────────────
export interface DedupSignature {
  email?: string | null;
  domain?: string | null;
  website?: string | null;
  instagram?: string | null;
  linkedin?: string | null;
  phone?: string | null;
  normalized_name_location?: string | null;
}

export type MatchLevel = "EXACT" | "STRONG" | "PROBABLE" | "NO_MATCH";

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Normalize a Lead's identity fields into a DedupSignature.
 * - email: lowercased, trimmed
 * - domain: extracted from website, lowercased
 * - website: stripped of protocol/www/trailing slash
 * - instagram: just the username (without @)
 * - linkedin: just the profile path
 * - phone: digits only (strip +, spaces, dashes, parens)
 * - normalized_name_location: name (lowercased, no punctuation) + "|" + location (lowercased)
 */
export function buildDedupSignature(lead: Partial<Lead>): DedupSignature {
  return {
    email: lead.email ? lead.email.toLowerCase().trim() : null,
    domain: lead.website ? extractDomain(lead.website) : null,
    website: lead.website ? normalizeUrl(lead.website) : null,
    instagram: extractHandle(lead.username, "instagram") || extractSocialFromUrl(lead.url, "instagram"),
    linkedin: extractSocialFromUrl(lead.url, "linkedin"),
    phone: lead.phone ? lead.phone.replace(/[^0-9]/g, "") : null,
    normalized_name_location: lead.name && lead.location
      ? `${normalizeName(lead.name)}|${normalizeName(lead.location)}`
      : (lead.name ? normalizeName(lead.name) : null),
  };
}

export function extractDomain(url: string): string | null {
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const u = new URL(normalized);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    // Reject values without a TLD (e.g. "not-a-url" → "not-a-url" without a dot)
    if (!host.includes(".") || host.split(".").pop()!.length < 2) return null;
    return host;
  } catch {
    return null;
  }
}

export function normalizeUrl(url: string): string | null {
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const u = new URL(normalized);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (!host.includes(".") || host.split(".").pop()!.length < 2) return null;
    return `${host}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return null;
  }
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i").replace(/[óòö]/g, "o").replace(/[úùü]/g, "u")
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9\s]/g, " ")   // convert punctuation to SPACE (not delete)
    .replace(/\s+/g, " ")
    .trim();
}

export function extractHandle(username: string | undefined | null, platform: string): string | null {
  if (!username) return null;
  const u = username.replace(/^@/, "").trim().toLowerCase();
  return u || null;
}

export function extractSocialFromUrl(url: string | undefined | null, platform: string): string | null {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (!lower.includes(platform)) return null;
  // Extract the path segments after the platform domain.
  // For LinkedIn: https://linkedin.com/in/juan-perez → "in/juan-perez"
  // For Instagram: https://instagram.com/veganheaven → "veganheaven"
  // We capture everything after platform.com/ up to the next ? or end.
  const m = lower.match(new RegExp(`${platform}\\.com/([^?]+)`));
  if (!m) return null;
  const path = m[1].replace(/\/$/, "");  // strip trailing slash
  if (platform === "linkedin") {
    // LinkedIn paths: /in/<slug>, /pub/<slug>, /company/<slug>
    // Return the full path so different profiles don't dedup to the same "in"
    return path;
  }
  // For other platforms, return the first path segment
  const firstSegment = path.split("/")[0];
  return firstSegment || path;
}
