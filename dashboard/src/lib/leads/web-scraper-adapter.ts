// ============================================================
// src/lib/leads/web-scraper-adapter.ts
// Compliant web scraper using node-fetch with rotating user agents.
// Searches Google public results (no CAPTCHA bypass) and extracts
// business info from public pages. Respects rate limits.
// ============================================================

import type { LeadSourceAdapter, RawProspect, SearchInput } from "./types";
import type { ProviderResult } from "./envelope";
import { classifyHttpError, providerFail, providerMeta, providerOk } from "./envelope";
import { assertPublicUrl, ssrfSafeFetch } from "@/lib/security/ssrf";

// P1 · Contrato 7: nombre de proveedor ESTABLE para el envelope/meta
// (adapter.name se conserva como etiqueta legible para la UI).
const PROVIDER = "web_scraper";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const WebScraperLeadSourceAdapter: LeadSourceAdapter = {
  name: "Web Scraper",
  description:
    "Scraper web compliant que busca en Google público y extrae info de negocios. Sin evasión de CAPTCHAs. Útil como fuente alternativa cuando no hay Google Places API key.",
  async isConfigured() {
    return true;
  },
  async search(input: SearchInput): Promise<ProviderResult<RawProspect[]>> {
    const startedAt = Date.now();
    const meta = () => providerMeta(PROVIDER, 1, Date.now() - startedAt);
    // Build Google search query
    const q = [
      input.category || "clínica estética",
      input.city,
      input.country,
      input.keywords,
    ]
      .filter(Boolean)
      .join(" ");

    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(
      q
    )}&num=20&hl=es&gl=co`;

    try {
      // P0-E (SSRF): ssrfSafeFetch validates scheme + IP literal + DNS
      // before fetching and re-validates every redirect hop. The target
      // here is a fixed google.com URL, but the guard is applied
      // uniformly to any server-side fetch.
      // P1 · Contrato 7: se respeta el timeout existente de ssrfSafeFetch
      // (8s por hop, AbortSignal) — no se añade otro.
      const res = await ssrfSafeFetch(googleUrl, {
        headers: {
          "User-Agent": randomUA(),
          "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (!res.ok) {
        // P1 · Contrato 7: error HTTP clasificado (no excepción).
        const body = await res.text().catch(() => undefined);
        const err = classifyHttpError(PROVIDER, res.status, body);
        console.error("[WebScraperAdapter]", err.message);
        return providerFail(PROVIDER, err.code, err.message, {
          httpStatus: err.httpStatus,
          meta: meta(),
        });
      }
      const html = await res.text();

      // Extract business names and URLs from Google results
      // This is a simplified parser — production-grade would use a proper HTML parser
      const prospects: RawProspect[] = [];
      const linkRegex = /<a[^>]+href="\/url\?q=([^"&]+)/g;
      let match;
      let count = 0;
      while ((match = linkRegex.exec(html)) !== null && count < 15) {
        const url = decodeURIComponent(match[1]);
        if (
          url.startsWith("http") &&
          !url.includes("google.") &&
          !url.includes("youtube.")
        ) {
          // P0-E (SSRF): drop results whose URL is not public (private
          // IP literals, localhost, credentials, non-http schemes…).
          // This prevents poisoned result URLs from entering the
          // prospect pipeline (they would be fetched later by the
          // enrichment layer, which also re-validates — defense in
          // depth). Blocked results are skipped, never thrown.
          try {
            assertPublicUrl(url);
          } catch {
            continue;
          }
          // Build a minimal prospect from URL — real implementation would fetch the page
          const domain = new URL(url).hostname.replace("www.", "");
          prospects.push({
            name: domain
              .split(".")[0]
              .replace(/[-_]/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase()),
            category: input.category,
            city: input.city,
            country: input.country,
            website: url,
            source: "web_scraper",
            sourceUrl: url,
            description: `Negocio encontrado vía Google. Dominio: ${domain}`,
          });
          count++;
        }
      }
      // Rate limit: pause between searches
      await sleep(1500);
      // P1 · Contrato 7: éxito (200 sin resultados parseables → data:[])
      return providerOk(prospects, meta());
    } catch (e: unknown) {
      // P1 · Contrato 7: NUNCA lanzar — todo error se clasifica en el envelope.
      // ssrfSafeFetch ya acota cada hop a 8s (abort → TIMEOUT); errores de red
      // (TypeError/ENOTFOUND/ECONNREFUSED) → UNAVAILABLE; resto → UNKNOWN.
      let code: "TIMEOUT" | "UNAVAILABLE" | "UNKNOWN" = "UNKNOWN";
      let message = String(e);
      if (e instanceof Error) {
        message = e.message || e.name;
        if (
          e.name === "AbortError" ||
          e.name === "TimeoutError" ||
          /timeout|timed out/i.test(message)
        ) {
          code = "TIMEOUT";
        } else if (
          e instanceof TypeError ||
          /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network/i.test(
            message
          )
        ) {
          code = "UNAVAILABLE";
        }
      }
      console.error("[WebScraperAdapter]", message);
      return providerFail(PROVIDER, code, message, { meta: meta() });
    }
  },
};
