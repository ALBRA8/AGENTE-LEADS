// ============================================================
// src/agent/providers/types.ts
// P0.2 — Provider abstraction interfaces.
//
// Every external integration (Apify, Scrapling, email verifier,
// future scrapers / search APIs) implements one of these interfaces
// and returns normalized `ProviderResult<T>`. The orchestrator never
// imports provider-specific SDKs and never catches provider-specific
// exceptions: a provider either returns `ok(data)` or `fail(error)`.
//
// All errors flow through `makeError()` / `normalizeError()` from
// `../core/errors.js` so retry / fallback decisions are uniform.
// ============================================================

import type { ProviderError } from "../core/errors.js";
import type { CandidateLead } from "../core/lead.js";

// ── Result envelope ────────────────────────────────────────────────
export interface ProviderResult<T> {
  ok: boolean;
  data?: T;
  error?: ProviderError;
}

export function ok<T>(data: T): ProviderResult<T> {
  return { ok: true, data };
}

export function fail<T>(error: ProviderError): ProviderResult<T> {
  return { ok: false, error };
}

// ── DiscoveryProvider (P0.3 input) ─────────────────────────────────
export interface DiscoveryProvider {
  /** Stable provider id e.g. "ApifyGoogleSearch", "MockDiscovery" */
  name: string;
  /** Cheap check — can this provider run in the current environment? */
  isConfigured(): Promise<boolean>;
  /** Returns normalized CandidateLead[] (no research, no validation). */
  discover(input: DiscoveryInput): Promise<ProviderResult<CandidateLead[]>>;
}

export interface DiscoveryInput {
  /** Free-text query (niche, keywords, business type, ...). */
  query: string;
  /** Optional geo filter (city, region, country). */
  location?: string;
  /** Optional niche/category hint for the provider. */
  niche?: string;
  /**
   * Platform hint for the provider: "instagram" | "google_search" | ...
   * Providers MAY ignore this field if they don't support per-platform
   * specialization.
   */
  platform?: string;
  /** Optional audience-size floor (e.g. min Instagram followers). */
  min_followers?: number;
}

// ── ResearchProvider (P0.4 input) ──────────────────────────────────
export interface ResearchProvider {
  name: string;
  isConfigured(): Promise<boolean>;
  /**
   * Fetches raw signals about a CandidateLead from external sources.
   * The pipeline (not the provider) turns `ResearchOutput` into a
   * structured `Lead` with `EvidenceRecord`s.
   */
  research(input: ResearchInput): Promise<ProviderResult<ResearchOutput>>;
}

export interface ResearchInput {
  candidate: CandidateLead;
  /** Fields the pipeline is interested in (the provider MAY use these hints). */
  look_for: Array<
    | "website"
    | "instagram"
    | "linkedin"
    | "email"
    | "phone"
    | "location"
    | "activity"
    | "services"
  >;
}

export interface ResearchOutput {
  raw_text?: string;
  raw_html?: string;
  social_links?: string[];
  emails?: string[];
  phones?: string[];
  websites?: string[];
  // The provider returns RAW data — the pipeline turns it into a structured Lead.
}

// ── VerificationProvider (P0.5 input) ──────────────────────────────
export interface VerificationProvider {
  name: string;
  isConfigured(): Promise<boolean>;
  verifyEmail(email: string): Promise<ProviderResult<EmailVerificationResult>>;
  verifyDomain(domain: string): Promise<ProviderResult<DomainVerificationResult>>;
  verifyUrl(url: string): Promise<ProviderResult<UrlVerificationResult>>;
}

export interface EmailVerificationResult {
  email: string;
  valid: boolean;
  reason?: string;
  mx_record?: boolean;
  smtp_check?: boolean;
}

export interface DomainVerificationResult {
  domain: string;
  resolves: boolean;
  http_status?: number;
  https_enabled?: boolean;
}

export interface UrlVerificationResult {
  url: string;
  reachable: boolean;
  http_status?: number;
  final_url?: string;
}

// ── ScrapingProvider (P0.x — stealth-fetch layer) ──────────────────
export interface ScrapingProvider {
  name: string;
  isConfigured(): Promise<boolean>;
  scrape(input: ScrapeInput): Promise<ProviderResult<ScrapeOutput>>;
}

export interface ScrapeInput {
  url: string;
  selector?: string;
  /** Wait for network idle (useful for SPAs). */
  network_idle?: boolean;
  timeout_ms?: number;
}

export interface ScrapeOutput {
  url: string;
  status: number;
  text?: string;
  html?: string;
  emails_found: string[];
  social_links: string[];
}
