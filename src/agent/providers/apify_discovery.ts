// ============================================================
// src/agent/providers/apify_discovery.ts
// P0.2 + UPGRADE — DiscoveryProvider backed by Apify's
// `instagram-scraper` actor (direct extraction, no Google dorks).
//
// This is the same approach as MailerFind but self-hosted:
//   - Extracts followers of a competitor's account
//   - Extracts users who posted on a hashtag
//   - Extracts users who posted at a location
//   - Extracts public emails, phones, bios, websites
//   - No Instagram login required (Apify's infrastructure)
//   - No ban risk
//   - GDPR-compliant (only public data)
//
// Falls back to Google Search scraper if platform != "instagram".
// ============================================================

import type {
  DiscoveryProvider,
  DiscoveryInput,
  ProviderResult,
} from "./types.js";
import type { CandidateLead } from "../core/lead.js";
import { makeError, normalizeError } from "../core/errors.js";

const APIFY_IG_ACTOR =
  "https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items";
const APIFY_GOOGLE_ACTOR =
  "https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items";

export class ApifyDiscoveryProvider implements DiscoveryProvider {
  name = "ApifyInstagram";

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

    const platformHint = input.platform ?? "instagram";

    // If Instagram → use the instagram-scraper actor (direct extraction)
    // If other → fall back to Google search
    if (platformHint === "instagram") {
      return await this.discoverInstagram(input, apiToken);
    } else {
      return await this.discoverGoogle(input, apiToken);
    }
  }

  /**
   * Direct Instagram extraction via Apify instagram-scraper actor.
   * Supports: hashtag search, user followers, location search.
   * Same data MailerFind extracts, but via Apify (pay-per-use).
   */
  private async discoverInstagram(
    input: DiscoveryInput,
    apiToken: string
  ): Promise<ProviderResult<CandidateLead[]>> {
    const url = `${APIFY_IG_ACTOR}?token=${apiToken}`;

    // Determine search type from the input
    const query = input.query ?? "";
    let searchType: string;
    let searchValue: string;
    let resultsType: string;

    if (query.startsWith("@") || query.startsWith("user_followers:")) {
      // "@competitor" or "user_followers:competitor" → extract followers
      searchType = "user";
      searchValue = query.replace(/^@|^user_followers:/, "").trim();
      resultsType = "followers";
    } else if (query.startsWith("#") || query.startsWith("hashtag:")) {
      // "#vegano" or "hashtag:vegano" → extract users who posted on hashtag
      searchType = "hashtag";
      searchValue = query.replace(/^#|^hashtag:/, "").trim();
      resultsType = "posts";
    } else if (query.startsWith("location:")) {
      // "location:medellin" → extract users who posted at location
      searchType = "location";
      searchValue = query.replace(/^location:/, "").trim();
      resultsType = "posts";
    } else {
      // Default: treat as hashtag search (most common for lead discovery)
      searchType = "hashtag";
      searchValue = (input.niche ?? query).replace(/\s+/g, "");
      resultsType = "posts";
    }

    // Build the Apify instagram-scraper payload
    const payload: any = {
      searchType,
      search: searchValue,
      resultsType,
      resultsLimit: 50, // cap at 50 profiles per search
      addParentInfo: false,
      scrapeUserData: true, // extract email, phone, bio, website from profile
    };

    // Add location filter if provided
    if (input.location) {
      payload.country = input.location;
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000), // Apify IG scraper can take 1-2 min
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          ok: false,
          error: normalizeError(
            { status: res.status, statusText: errText || res.statusText },
            this.name
          ),
        };
      }

      const data = (await res.json()) as any[];

      // Map Apify Instagram results → CandidateLead[]
      const candidates: CandidateLead[] = (data ?? [])
        .filter((item) => item && (item.username || item.fullName))
        .map((item): CandidateLead => {
          const username = item.username ?? "";
          const fullName = item.fullName ?? item.name ?? "";
          const bio = item.biography ?? item.bio ?? "";
          const email = item.publicEmail ?? item.email ?? extractEmailFromBio(bio);
          const phone = item.publicPhoneNumber ?? item.phoneNumber ?? extractPhoneFromBio(bio);
          const website = item.externalUrl ?? item.externalLink ?? item.website ?? null;
          const followersCount = item.followersCount ?? item.followers ?? 0;
          const followingCount = item.followingCount ?? item.following ?? 0;
          const postsCount = item.postsCount ?? item.posts ?? 0;
          const isVerified = item.verified ?? false;
          const profileUrl = `https://instagram.com/${username}`;
          const location = item.location ?? item.address ?? input.location ?? null;
          const category = item.category ?? input.niche ?? null;
          const description = bio
            ? `${bio}. ${followersCount} seguidores, ${postsCount} posts.`
            : `${fullName}. ${followersCount} seguidores.`;

          return {
            name: fullName || username,
            username: username || null,
            platform: "instagram",
            url: profileUrl,
            location: location,
            category: category,
            niche: input.niche ?? null,
            description,
            email: email ?? null,
            phone: phone ?? null,
            website: website ?? null,
            raw_data: {
              ...item,
              _followers: followersCount,
              _following: followingCount,
              _posts: postsCount,
              _verified: isVerified,
            },
            source: this.name,
            discovered_at: new Date().toISOString(),
          };
        });

      // Apply min_followers filter if provided
      let filtered = candidates;
      if (input.min_followers && input.min_followers > 0) {
        filtered = candidates.filter(
          (c) => Number(c.raw_data?._followers ?? 0) >= input.min_followers!
        );
      }

      if (filtered.length === 0) {
        return {
          ok: false,
          error: makeError(
            "EMPTY_RESULT",
            `Apify Instagram returned 0 results for ${searchType}:${searchValue}`,
            { provider: this.name }
          ),
        };
      }

      return { ok: true, data: filtered };
    } catch (err: any) {
      return {
        ok: false,
        error: normalizeError(err, this.name),
      };
    }
  }

  /**
   * Fallback: Google Search scraper for non-Instagram queries.
   * Uses the old approach (Google dork) but only when platform != instagram.
   */
  private async discoverGoogle(
    input: DiscoveryInput,
    apiToken: string
  ): Promise<ProviderResult<CandidateLead[]>> {
    const url = `${APIFY_GOOGLE_ACTOR}?token=${apiToken}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: input.query,
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

      const data = (await res.json()) as any[];
      const candidates: CandidateLead[] = (data ?? []).map((item): CandidateLead => ({
        name: String(item.title ?? item.url ?? "Unknown").split(" - ")[0],
        url: String(item.url ?? item.link ?? ""),
        category: input.niche ?? null,
        niche: input.niche ?? null,
        location: input.location ?? null,
        description: item.description ?? item.snippet ?? null,
        raw_data: item,
        source: this.name,
        discovered_at: new Date().toISOString(),
      }));

      if (candidates.length === 0) {
        return {
          ok: false,
          error: makeError("EMPTY_RESULT", "Google returned 0 results", {
            provider: this.name,
          }),
        };
      }

      return { ok: true, data: candidates };
    } catch (err: any) {
      return { ok: false, error: normalizeError(err, this.name) };
    }
  }
}

/**
 * Extract email from Instagram bio text.
 * Instagram bios often have: "📧 email@domain.com" or "Contact: email@domain.com"
 */
function extractEmailFromBio(bio: string): string | null {
  if (!bio) return null;
  const match = bio.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

/**
 * Extract phone from Instagram bio text.
 * Matches: +57 300 123 4567, 3001234567, etc.
 */
function extractPhoneFromBio(bio: string): string | null {
  if (!bio) return null;
  const match = bio.match(/\+?\d[\d\s().-]{7,}\d/);
  return match ? match[0].trim() : null;
}
