// ============================================================
// src/agent/providers/google_search_research.ts
// P0.2 — ResearchProvider backed by Apify's `google-search-scraper` actor.
//
// Refactor of `src/agent/tools/enrich_lead_profile.ts`:
//   - Same HTTP target (apify~google-search-scraper / run-sync-get-dataset-items)
//   - Same query template: "<username>" <niche> contact email OR website OR linkedin
//   - Returns raw `ResearchOutput` (snippets + extracted emails/phones/...
//     deduped). The pipeline is responsible for turning this raw signal
//     into a structured `Lead` with `EvidenceRecord`s.
//
// Notes on the query construction:
//   - We add the `look_for` array joined by `OR` so the search surfaces
//     whichever signal type is requested.
//   - We keep the original `contact email OR website OR linkedin` tail
//     for backward compatibility with the legacy tool's query intent.
// ============================================================

import type {
  ResearchProvider,
  ResearchInput,
  ResearchOutput,
  ProviderResult,
} from "./types.js";
import { makeError, normalizeError } from "../core/errors.js";

const APIFY_BASE =
  "https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;
const SOCIAL_RE =
  /instagram\.com|linkedin\.com|facebook\.com|twitter\.com|x\.com/i;

export class GoogleSearchResearchProvider implements ResearchProvider {
  name = "GoogleSearch";

  async isConfigured(): Promise<boolean> {
    const token = process.env.APIFY_TOKEN;
    return Boolean(token && !token.includes("your_apify"));
  }

  async research(
    input: ResearchInput
  ): Promise<ProviderResult<ResearchOutput>> {
    const apiToken = process.env.APIFY_TOKEN;
    if (!apiToken) {
      return {
        ok: false,
        error: makeError("AUTH_FAILURE", "APIFY_TOKEN not set", {
          provider: this.name,
        }),
      };
    }

    const c = input.candidate;
    const subject = c.username ?? c.name;
    const niche = c.niche ?? "";
    const lookFor = input.look_for.join(" OR ");
    const query = `"${subject}" ${niche} ${lookFor} contact email OR website OR linkedin`;

    try {
      const res = await fetch(`${APIFY_BASE}?token=${apiToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: query,
          maxPagesPerQuery: 1,
          resultsPerPage: 5,
        }),
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

      const results = (await res.json()) as Array<{
        title?: string;
        description?: string;
        url?: string;
      }>;

      const emails: string[] = [];
      const phones: string[] = [];
      const websites: string[] = [];
      const social_links: string[] = [];
      const snippets: string[] = [];

      for (const r of results ?? []) {
        const text = `${r.title ?? ""} ${r.description ?? ""} ${r.url ?? ""}`;
        snippets.push(text);

        const emailMatches = text.match(EMAIL_RE);
        if (emailMatches) emails.push(...emailMatches);

        const phoneMatches = text.match(PHONE_RE);
        if (phoneMatches) phones.push(...phoneMatches);

        if (r.url) websites.push(r.url);
        if (r.url && SOCIAL_RE.test(r.url)) {
          social_links.push(r.url);
        }
      }

      return {
        ok: true,
        data: {
          raw_text: snippets.join("\n\n"),
          emails: [...new Set(emails)],
          phones: [...new Set(phones)],
          websites: [...new Set(websites)],
          social_links: [...new Set(social_links)],
        },
      };
    } catch (err) {
      return { ok: false, error: normalizeError(err, this.name) };
    }
  }
}
