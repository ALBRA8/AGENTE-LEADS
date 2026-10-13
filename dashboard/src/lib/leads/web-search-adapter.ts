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
import type { ProviderErrorCode, ProviderResult } from "./envelope";
import { providerFail, providerMeta, providerOk } from "./envelope";
import { getAIClient } from "@/lib/ai/client";

// P1 · Contrato 7: nombre de proveedor ESTABLE para el envelope/meta
// (adapter.name se conserva como etiqueta legible para la UI).
const PROVIDER = "web_search";

// P1: el adapter no tenía timeout → 15s por llamada al SDK (contrato 7).
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Corre `p` contra un temporizador: si `p` no se resuelve en `ms`, la
 * promesa resultante rechaza con un Error nombrado "TimeoutError".
 * El SDK (getAIClient) no expone AbortSignal, así que la carrera con el
 * temporizador es la única forma de acotar la latencia de web_search/
 * page_reader (la llamada subyacente puede seguir en curso, pero el
 * adapter deja de esperarla y clasifica el resultado como TIMEOUT).
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`${label}: timeout tras ${ms}ms`);
      err.name = "TimeoutError";
      reject(err);
    }, ms);
    if (typeof timer.unref === "function") timer.unref();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Clasifica un error desconocido en la taxonomía del contrato 7.
 * - AbortError/TimeoutError/"timeout" en el mensaje → TIMEOUT
 * - TypeError de fetch / ENOTFOUND / ECONNREFUSED…  → UNAVAILABLE
 * - cualquier otro                                  → UNKNOWN
 */
export function classifySdkError(e: unknown): {
  code: ProviderErrorCode;
  message: string;
} {
  if (e instanceof Error) {
    const msg = e.message || e.name || String(e);
    if (
      e.name === "AbortError" ||
      e.name === "TimeoutError" ||
      /timeout|timed out/i.test(msg)
    ) {
      return { code: "TIMEOUT", message: msg };
    }
    if (
      e instanceof TypeError ||
      /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network/i.test(
        msg
      )
    ) {
      return { code: "UNAVAILABLE", message: msg };
    }
    return { code: "UNKNOWN", message: msg };
  }
  return { code: "UNKNOWN", message: String(e) };
}

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
 * Returns the FULL matched value (e.g. "+57 601 123 4567"), never a
 * single character — callers must persist this value as-is or via
 * normalizePhone(), never via match[0].
 */
export function extractPhone(text?: string): string | undefined {
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

// ============================================================
// Normalization & validation helpers (exported for testing).
// P0-C: the adapter used to persist `match[0]` (first char: "+" for
// phones, "c" for emails). These helpers keep contact data clean and
// give the enrichment pass a validity gate so corrupted values are
// refilled instead of trusted.
// ============================================================

/**
 * Normalize a phone string to E.164-ish form:
 * - trim
 * - keep the leading "+" only when it starts the value
 * - strip every non-digit character (spaces, dashes, dots, parens)
 * e.g. "+57 601 123 4567" -> "+576011234567"
 * Returns undefined when no digits remain (e.g. "+", "").
 */
export function normalizePhone(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return undefined;
  return plus ? `+${digits}` : digits;
}

/**
 * A phone is valid when, normalized, it has 7-15 digits (E.164 range).
 * Explicitly rejects the corrupted 1-char values ("+") persisted by the
 * pre-P0-C version of this adapter.
 */
export function isValidPhone(raw?: string | null): boolean {
  const norm = normalizePhone(raw);
  if (!norm) return false;
  const digits = norm.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * Normalize an email: trim + lowercase.
 * Returns undefined when nothing remains after trim.
 */
export function normalizeEmail(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  return trimmed || undefined;
}

/**
 * An email is valid when normalized it is local@domain with a dotted
 * domain and exactly one "@". Explicitly rejects the corrupted 1-char
 * values ("c") persisted by the pre-P0-C version of this adapter.
 */
export function isValidEmail(raw?: string | null): boolean {
  const norm = normalizeEmail(raw);
  if (!norm) return false;
  const parts = norm.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  return domain.includes(".");
}

/**
 * Extract a plausible email from text.
 * Filters out: emails ending in image/css/js extensions, emails that
 * start with common asset prefixes (bg-, icon-, logo-).
 * Returns the FULL matched value (e.g. "contacto@clinica.com.co"),
 * never a single character — callers must persist this value as-is or
 * via normalizeEmail(), never via match[0].
 */
export function extractEmail(text?: string): string | undefined {
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

  async search(input: SearchInput): Promise<ProviderResult<RawProspect[]>> {
    const startedAt = Date.now();
    let calls = 0; // nº de llamadas al SDK (web_search + page_reader)
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
      // Run web search (P1: acotada a 15s — antes podía colgar indefinidamente)
      calls++;
      const searchResults = (await withTimeout(
        client.functions.invoke("web_search", {
          query,
          num: 20,
        }),
        DEFAULT_TIMEOUT_MS,
        "web_search"
      )) as unknown as WebSearchResult[];

      // P1 · Contrato 7: payload malformado del proveedor es un FALLO
      // (no "0 resultados": ese caso es un array vacío válido).
      if (!Array.isArray(searchResults)) {
        return providerFail(
          PROVIDER,
          "UNKNOWN",
          "web_search devolvió una respuesta que no es un array",
          { meta: providerMeta(PROVIDER, calls, Date.now() - startedAt) }
        );
      }

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
          // P0-C: extractPhone/extractEmail already return the FULL value —
          // never index it with [0] (that persisted "+" / "c"). Normalize +
          // validate before persisting.
          phone: isValidPhone(phoneMatch) ? normalizePhone(phoneMatch) : undefined,
          email: isValidEmail(emailMatch) ? normalizeEmail(emailMatch) : undefined,
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
          // P1: cada page_reader también se acota a 15s; el enriquecimiento
          // sigue siendo best-effort (timeout/error → se omite esa página).
          calls++;
          const pageResult = (await withTimeout(
            client.functions.invoke("page_reader", {
              url: p.website,
            }),
            DEFAULT_TIMEOUT_MS,
            "page_reader"
          )) as any;

          const html = pageResult?.data?.html || "";
          // Extract email and phone from page HTML (strict).
          // P0-C: fill when the existing value is EMPTY *or INVALID*
          // (phone with <7 digits, email without "@") so corrupted rows
          // are repaired instead of kept.
          if (!isValidEmail(p.email)) {
            const filled = normalizeEmail(extractEmail(html));
            if (filled && isValidEmail(filled)) p.email = filled;
          }
          if (!isValidPhone(p.phone)) {
            const filled = normalizePhone(extractPhone(html));
            if (filled && isValidPhone(filled)) p.phone = filled;
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

      // P1 · Contrato 7: éxito (incluye 0 resultados → ok con data:[])
      return providerOk(
        prospects,
        providerMeta(PROVIDER, calls, Date.now() - startedAt)
      );
    } catch (e) {
      // P1 · Contrato 7: NUNCA lanzar — todo error se clasifica en el envelope.
      const classified = classifySdkError(e);
      console.error("[WebSearchAdapter] error:", classified.message);
      return providerFail(PROVIDER, classified.code, classified.message, {
        meta: providerMeta(PROVIDER, calls, Date.now() - startedAt),
      });
    }
  },
};
