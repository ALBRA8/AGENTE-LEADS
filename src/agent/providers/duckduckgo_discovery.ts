// ============================================================
// src/agent/providers/duckduckgo_discovery.ts
// P3 — DuckDuckGo HTML search DiscoveryProvider.
//
// Returns REAL businesses via DuckDuckGo's public HTML search
// endpoint. No API key required. Filters out aggregator sites
// (Yelp, TripAdvisor, Facebook, Instagram, LinkedIn, YouTube,
// TikTok, Google, Wikipedia) so the pipeline receives actual
// business homepages rather than directory listings. Deduplicates
// by domain so the same business doesn't appear twice.
//
// Error taxonomy (P0.10):
//   - HTTP 429                  -> RATE_LIMIT
//   - HTTP 5xx                  -> PROVIDER_UNAVAILABLE
//   - ECONNREFUSED / ENOTFOUND  -> PROVIDER_UNAVAILABLE
//   - Zero results parsed      -> EMPTY_RESULT (legitimate outcome)
//   - All filtered out          -> EMPTY_RESULT
//   - Network timeout           -> TIMEOUT
// ============================================================

import type {
  DiscoveryProvider,
  DiscoveryInput,
  ProviderResult,
} from "./types.js";
import type { CandidateLead } from "../core/lead.js";
import { makeError, normalizeError } from "../core/errors.js";

const DDG_URL = "https://html.duckduckgo.com/html/";
const FETCH_TIMEOUT_MS = 5_000;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
];

const AGGREGATOR_DOMAINS = new Set([
  "yelp.com",
  "tripadvisor.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "google.com",
  "wikipedia.org",
  "duckduckgo.com",
]);

// Inline extractors (mirrors google_search_research.ts but kept local
// per the task constraint — do NOT import from other providers).
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;

type DuckDuckGoInput = DiscoveryInput & {
  city?: string;
  country?: string;
  category?: string;
  keywords?: string;
};

interface DdgResult {
  url: string;
  title: string;
  snippet: string;
}

/**
 * Surface the underlying syscall error (ENOTFOUND / ECONNREFUSED)
 * when Node fetch wraps it as `TypeError: fetch failed` — the
 * wrapped cause is what maps cleanly to PROVIDER_UNAVAILABLE.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { message?: string } | null }).cause;
    if (
      cause &&
      typeof cause === "object" &&
      "message" in cause &&
      typeof cause.message === "string"
    ) {
      return `${err.message}: ${cause.message}`;
    }
    return err.message;
  }
  return String(err);
}

export class DuckDuckGoDiscoveryProvider implements DiscoveryProvider {
  name = "DuckDuckGo";

  async isConfigured(): Promise<boolean> {
    // Public DDG HTML endpoint. No API key needed.
    return true;
  }

  async discover(
    input: DuckDuckGoInput
  ): Promise<ProviderResult<CandidateLead[]>> {
    const query = this.buildQuery(input);
    if (!query) {
      return {
        ok: false,
        error: makeError(
          "INVALID_INPUT",
          "DuckDuckGo discovery requires a non-empty query",
          { provider: this.name }
        ),
      };
    }

    const url = `${DDG_URL}?q=${encodeURIComponent(query)}`;
    const userAgent =
      USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": userAgent,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        return {
          ok: false,
          error: normalizeError(
            { status: res.status, statusText: res.statusText },
            this.name
          ),
        };
      }
      const html = await res.text();
      const results = this.parseHtml(html);
      if (results.length === 0) {
        return {
          ok: false,
          error: makeError("EMPTY_RESULT", "DuckDuckGo returned 0 results", {
            provider: this.name,
          }),
        };
      }

      const candidates = this.normalizeResults(results, input);
      if (candidates.length === 0) {
        return {
          ok: false,
          error: makeError(
            "EMPTY_RESULT",
            "All DDG results were aggregator sites or had no usable URL",
            { provider: this.name }
          ),
        };
      }
      return { ok: true, data: candidates };
    } catch (err) {
      return { ok: false, error: normalizeError(describeError(err), this.name) };
    }
  }

  // ── Query construction ───────────────────────────────────────────
  // `category + "in" + city + country + keywords` per the spec.
  // Falls back to `query` (or `niche`) if category is missing, so the
  // query is never empty when the caller provided *some* signal.
  private buildQuery(input: DuckDuckGoInput): string {
    const parts: string[] = [];
    const lead = input.category ?? input.niche ?? input.query;
    if (lead) parts.push(lead);
    const city = input.city ?? input.location;
    if (city) parts.push("in", city);
    if (input.country) parts.push(input.country);
    if (input.keywords) parts.push(input.keywords);
    return parts.join(" ").trim();
  }

  // ── HTML parsing ─────────────────────────────────────────────────
  // DDG's html.duckduckgo.com endpoint returns a server-rendered page
  // with a stable structure:
  //   <a class="result__a" href="//duckduckgo.com/l/?uddg=<encoded>...">Title</a>
  //   <a class="result__snippet" ...>Snippet text</a>
  // We use regex intentionally — no DOM library is available.
  private parseHtml(html: string): DdgResult[] {
    const results: DdgResult[] = [];

    const linkRe =
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRe =
      /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

    const links: Array<{ url: string; title: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null) {
      const rawUrl = m[1];
      const title = this.stripTags(m[2]).trim();
      const actualUrl = this.unwrapDdgRedirect(rawUrl);
      if (actualUrl && title) {
        links.push({ url: actualUrl, title });
      }
    }

    const snippets: string[] = [];
    while ((m = snippetRe.exec(html)) !== null) {
      snippets.push(this.stripTags(m[1]).trim());
    }

    for (let i = 0; i < links.length; i++) {
      results.push({
        url: links[i].url,
        title: links[i].title,
        snippet: snippets[i] ?? "",
      });
    }
    return results;
  }

  private stripTags(s: string): string {
    return s
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .trim();
  }

  // DDG wraps external URLs in /l/?uddg=<encoded>. Unwrap to the real
  // destination so we can filter aggregators by their actual domain.
  private unwrapDdgRedirect(rawUrl: string): string | null {
    const m = rawUrl.match(/uddg=([^&]+)/);
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return null;
      }
    }
    if (rawUrl.startsWith("//")) return `https:${rawUrl}`;
    if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
    return null;
  }

  private domainOf(url: string): string | null {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return null;
    }
  }

  private isAggregator(domain: string): boolean {
    if (AGGREGATOR_DOMAINS.has(domain)) return true;
    // Also catch subdomains: en.wikipedia.org, m.facebook.com, etc.
    for (const a of AGGREGATOR_DOMAINS) {
      if (domain.endsWith("." + a)) return true;
    }
    return false;
  }

  private normalizeResults(
    results: DdgResult[],
    input: DuckDuckGoInput
  ): CandidateLead[] {
    const seenDomains = new Set<string>();
    const out: CandidateLead[] = [];

    for (const r of results) {
      const domain = this.domainOf(r.url);
      if (!domain) continue;
      if (this.isAggregator(domain)) continue;
      if (seenDomains.has(domain)) continue; // dedup by domain
      seenDomains.add(domain);

      // Extract emails and phones from the snippet.
      const emailMatches = r.snippet.match(EMAIL_RE) ?? [];
      const phoneMatches = r.snippet.match(PHONE_RE) ?? [];
      const emails = [...new Set(emailMatches)];
      const phones = [...new Set(phoneMatches)];

      out.push({
        name: r.title,
        username: null,
        platform: "web",
        url: r.url,
        location: input.city ?? input.location ?? null,
        category: input.category ?? input.niche ?? null,
        niche: input.niche ?? null,
        description: r.snippet || null,
        raw_data: {
          domain,
          snippet: r.snippet,
          ...(emails.length > 0 ? { emails } : {}),
          ...(phones.length > 0 ? { phones } : {}),
        },
        source: "DuckDuckGo",
        discovered_at: new Date().toISOString(),
      });
    }
    return out;
  }
}
