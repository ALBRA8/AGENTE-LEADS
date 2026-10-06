// ============================================================
// src/lib/leads/web-search-adapter.ts
// Uses z-ai-web-dev-sdk's built-in web_search function to find
// REAL businesses. No API key needed — the SDK routes through
// Z.ai's servers which have full internet access. Returns real
// business names, URLs and snippets from Google search results.
// Optionally uses page_reader to extract contact info from
// each business's website.
// ============================================================

import type { LeadSourceAdapter, RawProspect, SearchInput } from "./types";
import { getAIClient } from "@/lib/ai/client";

interface WebSearchResult {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  date?: string;
}

/**
 * Extract a plausible phone number from text.
 * Filters out: numeric IDs (>15 digits), CSS artifacts, version strings.
 * Prefers numbers that look like international or local phone formats.
 */
function extractPhone(text?: string): string | undefined {
  if (!text) return undefined;
  // Match candidate phone numbers: optional +, then 7-15 digits with separators
  const candidates = text.match(/\+?\d[\d\s().-]{6,}\d/g);
  if (!candidates) return undefined;

  for (const c of candidates) {
    // Count digits only
    const digits = c.replace(/\D/g, "");
    // Reject if too few (<7) or too many (>15) digits
    if (digits.length < 7 || digits.length > 15) continue;
    // Reject if all-zero or starts with 0000 (CSS artifact like "0 0 24 24")
    if (/^0+$/.test(digits) || digits.startsWith("0000")) continue;
    // Reject if mostly zeros
    const zeros = (digits.match(/0/g) || []).length;
    if (zeros > digits.length * 0.6) continue;
    // Reject if has too many consecutive same digits (like 9999999999)
    if (/(.)\1{5,}/.test(digits)) continue;
    // Looks like a phone
    return c.trim();
  }
  return undefined;
}

/**
 * Extract a plausible email from text.
 * Filters out: emails ending in image/css/js extensions, emails that
 * start with common asset prefixes (bg-, icon-, logo-).
 */
function extractEmail(text?: string): string | undefined {
  if (!text) return undefined;
  const candidates = text.match(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  );
  if (!candidates) return undefined;

  const badExtensions = [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".css",
    ".js",
    ".ico",
  ];
  const badPrefixes = ["bg-", "icon-", "logo-", "img-", "sprite-", "arrow-"];

  for (const c of candidates) {
    const lower = c.toLowerCase();
    if (badExtensions.some((ext) => lower.endsWith(ext))) continue;
    const userPart = lower.split("@")[0];
    if (badPrefixes.some((p) => userPart.startsWith(p))) continue;
    // Reject if local part is too long (often a CSS class artifact)
    if (userPart.length > 30) continue;
    return c;
  }
  return undefined;
}

export const WebSearchLeadSourceAdapter: LeadSourceAdapter = {
  name: "Web Search (z.ai)",
  description:
    "Búsqueda web real con Google vía z-ai-web-dev-sdk. GRATUITA, sin API key. Devuelve negocios reales de internet. Extrae teléfono/email/web de los resultados y de la página del negocio cuando es posible.",

  async isConfigured() {
    return true;
  },

  async search(input: SearchInput): Promise<RawProspect[]> {
    // Build a focused search query
    const parts = [
      input.category || "negocios",
      "en",
      input.city,
      input.country,
    ].filter(Boolean);
    if (input.keywords) parts.push(input.keywords);
    const query = parts.join(" ");

    try {
      const client = await getAIClient();
      // Run web search
      const searchResults = (await client.functions.invoke("web_search", {
        query,
        num: 20,
      })) as unknown as WebSearchResult[];

      if (!Array.isArray(searchResults)) return [];

      // Convert search results to RawProspect[]
      const prospects: RawProspect[] = [];
      const seen = new Set<string>();

      for (const r of searchResults) {
        // Skip generic aggregator sites (yelp, facebook, instagram, etc.)
        const skipHosts = [
          "facebook.com",
          "instagram.com",
          "twitter.com",
          "linkedin.com",
          "youtube.com",
          "tiktok.com",
          "yelp.",
          "tripadvisor.",
          "google.com",
          "wikipedia.org",
          "maps.google",
        ];
        if (skipHosts.some((h) => r.host_name?.includes(h))) continue;

        // Use domain as a dedup key
        const domain = r.host_name.replace(/^www\./, "");
        if (seen.has(domain)) continue;
        seen.add(domain);

        // Try to extract phone/email from snippet (with strict filters)
        const phoneMatch = extractPhone(r.snippet);
        const emailMatch = extractEmail(r.snippet);

        const name = r.name
          .split(" - ")[0] // take part before any " - " separator
          .split(" | ")[0]
          .split(" :: ")[0]
          .substring(0, 80);

        prospects.push({
          name,
          category: input.category,
          city: input.city,
          country: input.country,
          website: r.url,
          phone: phoneMatch?.[0],
          email: emailMatch?.[0],
          socialLinks: undefined,
          description: r.snippet || undefined,
          source: "web_search_zai",
          sourceUrl: r.url,
        });
      }

      // For the top 5 results, optionally fetch the page to extract
      // real phone/email. Skip if too slow.
      const topN = Math.min(5, prospects.length);
      for (let i = 0; i < topN; i++) {
        const p = prospects[i];
        if (!p.website) continue;
        try {
          const client = await getAIClient();
          const pageResult = (await client.functions.invoke("page_reader", {
            url: p.website,
          })) as any;

          const html = pageResult?.data?.html || "";
          // Extract email and phone from page HTML (strict)
          if (!p.email) {
            const m = extractEmail(html);
            if (m) p.email = m;
          }
          if (!p.phone) {
            const m = extractPhone(html);
            if (m) p.phone = m;
          }
          // Extract social links
          if (!p.socialLinks) {
            const social: any = {};
            const igMatch = html.match(
              /href=["'](https?:\/\/(?:www\.)?instagram\.com\/[^"'\s]+)/
            );
            if (igMatch) social.instagram = igMatch[1];
            const fbMatch = html.match(
              /href=["'](https?:\/\/(?:www\.)?facebook\.com\/[^"'\s]+)/
            );
            if (fbMatch) social.facebook = fbMatch[1];
            const twMatch = html.match(
              /href=["'](https?:\/\/(?:(?:www\.)?twitter|x)\.com\/[^"'\s]+)/
            );
            if (twMatch) social.twitter = twMatch[1];
            if (Object.keys(social).length) p.socialLinks = social;
          }
        } catch (e) {
          console.warn(
            `[WebSearchAdapter] page_reader failed for ${p.website}:`,
            (e as Error).message
          );
        }
      }

      return prospects;
    } catch (e) {
      console.error("[WebSearchAdapter] error:", e);
      return [];
    }
  },
};
