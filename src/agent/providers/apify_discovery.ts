// ============================================================
// src/agent/providers/apify_discovery.ts
// P0.2 — DiscoveryProvider backed by Apify's `google-search-scraper` actor.
//
// Refactor of `src/agent/tools/scrape_instagram_leads.ts`:
//   - Same HTTP target (apify~google-search-scraper / run-sync-get-dataset-items)
//   - Same payload shape (queries / maxPagesPerQuery / resultsPerPage)
//   - Returns normalized `CandidateLead[]` instead of a raw JSON string
//
// The original tool remains available for the legacy agent loop; this
// provider is consumed by the new pipeline orchestrator.
// ============================================================

import type {
  DiscoveryProvider,
  DiscoveryInput,
  ProviderResult,
} from "./types.js";
import type { CandidateLead } from "../core/lead.js";
import { makeError, normalizeError } from "../core/errors.js";

const APIFY_BASE =
  "https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items";

export class ApifyDiscoveryProvider implements DiscoveryProvider {
  name = "ApifyGoogleSearch";

  async isConfigured(): Promise<boolean> {
    const token = process.env.APIFY_TOKEN;
    return Boolean(token && !token.includes("your_apify"));
  }

  async discover(
    input: DiscoveryInput
  ): Promise<ProviderResult<CandidateLead[]>> {
    const apiToken = process.env.APIFY_TOKEN;
    if (!apiToken) {
      return {
        ok: false,
        error: makeError("AUTH_FAILURE", "APIFY_TOKEN not set", {
          provider: this.name,
        }),
      };
    }

    const url = `${APIFY_BASE}?token=${apiToken}`;
    try {
      const platformHint = input.platform ?? "instagram";
      // Backward-compatible query format with the original tool:
      //   site:instagram.com + <query> + @gmail.com
      // When the caller passes a non-instagram platform hint, we forward the
      // raw query verbatim so the provider can also serve generic Google
      // discovery use cases.
      const query =
        platformHint === "instagram"
          ? `site:instagram.com + ${input.query} + @gmail.com`
          : input.query;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: query,
          maxPagesPerQuery: 1,
          resultsPerPage: 10,
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

      const data = (await res.json()) as Array<Record<string, unknown>>;
      const candidates: CandidateLead[] = (data ?? []).map(
        (item): CandidateLead => {
          const igUrl = String(item.url ?? item.link ?? "");
          const igMatch = igUrl.match(/instagram\.com\/([^/?]+)/);
          const username = igMatch ? igMatch[1] : null;
          const title = typeof item.title === "string" ? item.title : "";
          return {
            name: title.split(" - ")[0] || username || igUrl,
            username,
            platform: "instagram",
            url: igUrl,
            location: input.location ?? null,
            category: input.niche ?? null,
            niche: input.niche ?? null,
            description:
              (typeof item.description === "string" ? item.description : null) ??
              (typeof item.snippet === "string" ? item.snippet : null) ??
              null,
            raw_data: item,
            source: this.name,
            discovered_at: new Date().toISOString(),
          };
        }
      );

      if (candidates.length === 0) {
        return {
          ok: false,
          error: makeError("EMPTY_RESULT", "Apify returned 0 results", {
            provider: this.name,
          }),
        };
      }

      return { ok: true, data: candidates };
    } catch (err) {
      return { ok: false, error: normalizeError(err, this.name) };
    }
  }
}
