// ============================================================
// src/lib/leads/freshness-checker.ts
// Website freshness checker — measures how stale a prospect's
// website is. The strongest pain signal for selling web services
// is "this site is from 2019 and never updated".
//
// Signals measured:
//   1. HTTP Last-Modified header  (native fetch HEAD)
//   2. Copyright year from HTML   (regex on footer patterns)
//   3. SSL certificate age         (tls.connect → cert.valid_from)
//   4. Mobile responsive           (viewport meta + @media + frameworks)
//   5. Structured data (Schema.org) (ld+json blocks, type extraction)
//   6. Booking system               (Calendly, Acuity, Bookly, Amelia, ...)
//   7. Days since last update       (derived metric)
//
// Native fetch to arbitrary external URLs may be BLOCKED from the
// sandbox; the z-ai SDK page_reader is NOT blocked because it routes
// through Z.ai servers. So page_reader is the primary HTML source,
// and native fetch is only attempted for header inspection.
// ============================================================

import * as tls from "tls";
import { getAIClient } from "@/lib/ai/client";

// ------------------------------------------------------------
// Public types
// ------------------------------------------------------------

export interface FreshnessResult {
  lastModifiedHeader?: string | null; // raw header value
  lastModifiedDate?: string | null; // ISO date parsed from header
  copyrightYear?: number | null;
  isHttps?: boolean;
  sslAgeDays?: number | null; // days since SSL cert issued (if obtainable)
  isMobileResponsive: boolean;
  hasStructuredData: boolean;
  structuredDataTypes: string[]; // ["LocalBusiness", "Physician"]
  hasBookingSystem: boolean;
  bookingSystemName?: string | null; // "calendly" | "acuity" | "bookly" | ...
  daysSinceLastUpdate?: number | null;
  freshnessScore: number; // 0-100 (100 = fresh, 0 = very stale)
  comprobableEvidence: string; // human-readable, in Spanish
  detectedAt: string; // ISO date
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function makeEmpty(evidence = "No se pudo verificar"): FreshnessResult {
  return {
    lastModifiedHeader: null,
    lastModifiedDate: null,
    copyrightYear: null,
    isHttps: false,
    sslAgeDays: null,
    isMobileResponsive: false,
    hasStructuredData: false,
    structuredDataTypes: [],
    hasBookingSystem: false,
    bookingSystemName: null,
    daysSinceLastUpdate: null,
    freshnessScore: 0,
    comprobableEvidence: evidence,
    detectedAt: new Date().toISOString(),
  };
}

/** Normalize user-supplied website string to a URL object. Returns null on failure. */
function normalizeUrl(website: string): URL | null {
  try {
    let s = (website || "").trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) {
      // Handle protocol-relative URLs and bare hosts
      s = `https://${s.replace(/^\/\//, "")}`;
    }
    return new URL(s);
  } catch {
    return null;
  }
}

/**
 * Parse copyright years out of HTML.
 * Matches: © 2019, © 2018-2020, Copyright 2017, © 2023 Brand, (c)2024
 * Returns the MOST RECENT year found, or null if none.
 */
function parseCopyrightYear(html: string): number | null {
  if (!html) return null;
  const years = new Set<number>();

  // Pattern 1: "© 2019" or "© 2018-2020" or "(c) 2017"
  const rangeRe =
    /(?:©|\(c\)|copyright)\s*(\d{4})(?:\s*[-–—]\s*(\d{4}))?/gi;
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(html)) !== null) {
    const start = parseInt(m[1], 10);
    if (!isNaN(start) && start >= 1990 && start <= new Date().getFullYear() + 1) {
      years.add(start);
    }
    if (m[2]) {
      const end = parseInt(m[2], 10);
      if (!isNaN(end) && end >= 1990 && end <= new Date().getFullYear() + 1) {
        years.add(end);
      }
    }
  }

  // Pattern 2: fallback — any 4-digit year near the word "copyright" or "©"
  if (years.size === 0) {
    const fallbackRe = /(?:copyright|©)[^\d]{0,15}(\d{4})/gi;
    while ((m = fallbackRe.exec(html)) !== null) {
      const y = parseInt(m[1], 10);
      if (!isNaN(y) && y >= 1990 && y <= new Date().getFullYear() + 1) {
        years.add(y);
      }
    }
  }

  if (years.size === 0) return null;
  return Math.max(...Array.from(years));
}

/**
 * Check mobile-responsiveness.
 * Required: viewport meta tag with width=device-width.
 * Strong signals: @media queries, framework signatures
 * (bootstrap, tailwind, bulma, foundation).
 *
 * Per spec: "If no viewport meta AND no media queries → not responsive".
 */
function checkMobileResponsive(html: string): {
  isResponsive: boolean;
  hasViewportMeta: boolean;
  mediaQueryCount: number;
  framework: string | null;
} {
  const lower = html.toLowerCase();
  const hasViewportMeta = /<meta\s+[^>]*name=["']viewport["'][^>]*content=["'][^"']*width=device-width/i.test(
    html
  );
  // Count @media occurrences (inline styles + embedded <style> blocks — external
  // stylesheets aren't visible in the HTML so this is a conservative count).
  const mediaMatches = lower.match(/@media\b/g);
  const mediaQueryCount = mediaMatches ? mediaMatches.length : 0;

  let framework: string | null = null;
  if (lower.includes("bootstrap")) framework = "bootstrap";
  else if (lower.includes("tailwind")) framework = "tailwind";
  else if (lower.includes("bulma")) framework = "bulma";
  else if (lower.includes("foundation")) framework = "foundation";

  // Spec rule: not responsive iff no viewport meta AND no media queries.
  // Framework signals also count as a positive signal (they bundle media
  // queries by default).
  const isResponsive =
    hasViewportMeta || mediaQueryCount > 0 || framework !== null;

  return { isResponsive, hasViewportMeta, mediaQueryCount, framework };
}

/**
 * Recursively walk a parsed JSON-LD payload collecting every "@type" value.
 * Handles: single objects, arrays, @graph wrappers, nested @type arrays.
 */
function collectLdJsonTypes(obj: unknown, types: Set<string>): void {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) collectLdJsonTypes(item, types);
    return;
  }
  const o = obj as Record<string, unknown>;
  const t = o["@type"];
  if (t !== undefined) {
    if (Array.isArray(t)) {
      for (const x of t) if (typeof x === "string") types.add(x);
    } else if (typeof t === "string") {
      types.add(t);
    }
  }
  if (o["@graph"] !== undefined) {
    collectLdJsonTypes(o["@graph"], types);
  }
  // Walk all other object-valued keys for nested types
  for (const k of Object.keys(o)) {
    if (k === "@type" || k === "@graph") continue;
    const v = o[k];
    if (v && typeof v === "object") collectLdJsonTypes(v, types);
  }
}

/**
 * Extract Schema.org structured-data types from <script type="application/ld+json">
 * blocks. Returns an array of unique @type strings.
 */
function extractStructuredDataTypes(html: string): string[] {
  if (!html) return [];
  const types = new Set<string>();
  const blockRe =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const raw = (m[1] || "").trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      collectLdJsonTypes(parsed, types);
    } catch {
      // Malformed JSON — try a regex fallback to salvage @type values
      const typeRe = /"@type"\s*:\s*"([^"]+)"/g;
      let mm: RegExpExecArray | null;
      while ((mm = typeRe.exec(raw)) !== null) {
        types.add(mm[1]);
      }
    }
  }
  return Array.from(types);
}

/**
 * Detect embedded booking systems.
 * Order matters: check specific embeds first, then generic custom forms.
 */
function detectBookingSystem(html: string): {
  found: boolean;
  name: string | null;
} {
  if (!html) return { found: false, name: null };
  const lower = html.toLowerCase();
  if (lower.includes("calendly.com")) return { found: true, name: "calendly" };
  if (lower.includes("acuityscheduling.com"))
    return { found: true, name: "acuity" };
  if (lower.includes("bookly")) return { found: true, name: "bookly" };
  if (lower.includes("ameliabooking")) return { found: true, name: "amelia" };
  if (lower.includes("setmore.com")) return { found: true, name: "setmore" };
  if (
    lower.includes("simplyscheduleappointments") ||
    /ssa[-_/]/.test(lower) // avoid matching "ssa" inside arbitrary words
  )
    return { found: true, name: "ssa" };
  // Custom booking form: <form action="...book|appointment|cita|reserva...">
  const formRe =
    /<form[^>]*action=["'][^"']*(?:book|appointment|cita|reserva|agendar|turno)[^"']*["']/i;
  if (formRe.test(html)) return { found: true, name: "custom_form" };
  return { found: false, name: null };
}

/**
 * Try a TLS handshake to fetch the SSL cert's valid_from date.
 * Native fetch can't expose cert info, so we use tls.connect directly.
 * Returns null if the sandbox blocks it or the cert lacks valid_from.
 */
function probeSslAge(hostname: string): Promise<{ validFrom: Date } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val: { validFrom: Date } | null) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* noop */
      }
      resolve(val);
    };

    const socket = tls.connect(
      {
        host: hostname,
        port: 443,
        servername: hostname,
        rejectUnauthorized: false, // we just want to read the cert, not validate
      },
      () => {
        try {
          const cert = socket.getCertificate() as
            | { valid_from?: string | Date }
            | null
            | undefined;
          if (cert && cert.valid_from) {
            const d = new Date(cert.valid_from as string);
            if (!isNaN(d.getTime())) {
              finish({ validFrom: d });
              return;
            }
          }
          finish(null);
        } catch {
          finish(null);
        }
      }
    );
    socket.setTimeout(3000);
    socket.on("timeout", () => finish(null));
    socket.on("error", () => finish(null));
  });
}

/**
 * Build the Spanish, comprobable-evidence string that the proposal
 * generator will use LITERALLY as the basis for the personalized proposal.
 *
 * Example output:
 *   "Sitio web sin certificado SSL, copyright 2019 (5 años sin actualizar),
 *    no es responsivo en móvil, sin datos estructurados Schema.org,
 *    sin sistema de reservas online."
 */
function buildEvidence(opts: {
  isHttps: boolean;
  sslAgeDays: number | null;
  copyrightYear: number | null;
  isMobileResponsive: boolean;
  hasStructuredData: boolean;
  structuredDataTypes: string[];
  hasBookingSystem: boolean;
  bookingSystemName: string | null;
  daysSinceLastUpdate: number | null;
}): string {
  const currentYear = new Date().getFullYear();
  const parts: string[] = [];

  if (opts.isHttps) {
    if (opts.sslAgeDays !== null) {
      const yrs = (opts.sslAgeDays / 365).toFixed(1);
      parts.push(`con certificado SSL (vigente hace ${yrs} años)`);
    } else {
      parts.push("con certificado SSL");
    }
  } else {
    parts.push("sin certificado SSL");
  }

  if (opts.copyrightYear) {
    const behind = currentYear - opts.copyrightYear;
    if (behind > 0) {
      parts.push(
        `copyright ${opts.copyrightYear} (${behind} año${
          behind === 1 ? "" : "s"
        } sin actualizar)`
      );
    } else if (behind === 0) {
      parts.push(`copyright ${opts.copyrightYear} (actualizado este año)`);
    } else {
      parts.push(`copyright ${opts.copyrightYear}`);
    }
  }

  parts.push(
    opts.isMobileResponsive
      ? "responsivo en móvil"
      : "no es responsivo en móvil"
  );

  if (opts.hasStructuredData && opts.structuredDataTypes.length > 0) {
    parts.push(
      `con datos estructurados Schema.org (${opts.structuredDataTypes.join(
        ", "
      )})`
    );
  } else if (opts.hasStructuredData) {
    parts.push("con datos estructurados Schema.org");
  } else {
    parts.push("sin datos estructurados Schema.org");
  }

  if (opts.hasBookingSystem && opts.bookingSystemName) {
    parts.push(`con sistema de reservas (${opts.bookingSystemName})`);
  } else {
    parts.push("sin sistema de reservas online");
  }

  if (opts.daysSinceLastUpdate !== null) {
    if (opts.daysSinceLastUpdate > 365) {
      const y = Math.floor(opts.daysSinceLastUpdate / 365);
      parts.push(`última actualización hace ~${y} año${y === 1 ? "" : "s"}`);
    } else if (opts.daysSinceLastUpdate > 30) {
      const mo = Math.floor(opts.daysSinceLastUpdate / 30);
      parts.push(`última actualización hace ~${mo} mes${mo === 1 ? "" : "es"}`);
    } else {
      parts.push(`última actualización hace ~${opts.daysSinceLastUpdate} días`);
    }
  }

  return parts.join(", ") + ".";
}

// ------------------------------------------------------------
// Main entry point
// ------------------------------------------------------------

/**
 * Check how "fresh" a prospect's website is.
 * Never throws — always returns a FreshnessResult (possibly with empty
 * signals on failure). Completes in under 8 seconds total.
 */
export async function checkFreshness(
  website: string
): Promise<FreshnessResult> {
  if (!website || typeof website !== "string") return makeEmpty();

  // Overall hard timeout — the function must complete in under 8 seconds.
  const HARD_TIMEOUT_MS = 8000;
  const timeoutPromise = new Promise<FreshnessResult>((resolve) => {
    setTimeout(
      () =>
        resolve(
          makeEmpty("Tiempo de verificación agotado (timeout 8s)")
        ),
      HARD_TIMEOUT_MS
    );
  });

  const workPromise = (async (): Promise<FreshnessResult> => {
    const detectedAt = new Date().toISOString();
    const currentYear = new Date().getFullYear();

    const url = normalizeUrl(website);
    if (!url) return makeEmpty("URL inválida");

    const isHttps = url.protocol === "https:";

    // ----------------------------------------------------------
    // 1. HTTP Last-Modified header — try native HEAD fetch.
    //    May be blocked by the sandbox — gracefully skip on failure.
    // ----------------------------------------------------------
    let lastModifiedHeader: string | null = null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(url.toString(), {
        method: "HEAD",
        signal: ctrl.signal,
        redirect: "follow",
      });
      clearTimeout(t);
      lastModifiedHeader = r.headers.get("last-modified");
    } catch {
      // sandbox likely blocked the request — fall through
    }

    let lastModifiedDate: Date | null = null;
    if (lastModifiedHeader) {
      const d = new Date(lastModifiedHeader);
      if (!isNaN(d.getTime())) lastModifiedDate = d;
    }

    // ----------------------------------------------------------
    // 3. SSL certificate age — try a TLS handshake (native fetch
    //    can't expose cert info). Skip if sandbox blocks it.
    // ----------------------------------------------------------
    let sslAgeDays: number | null = null;
    if (isHttps) {
      try {
        const cert = await probeSslAge(url.hostname);
        if (cert) {
          sslAgeDays = Math.floor(
            (Date.now() - cert.validFrom.getTime()) / 86_400_000
          );
        }
      } catch {
        // sandbox may block — skip
      }
    }

    // ----------------------------------------------------------
    // 2,4,5,6. Fetch the HTML via page_reader (always works —
    //    routed through Z.ai servers) and parse all in-page signals.
    // ----------------------------------------------------------
    let html = "";
    let publishedTime: string | undefined;
    try {
      const client = await getAIClient();
      // Wrap in Promise.race so a hung page_reader can't blow the 8s budget.
      const readerPromise = client.functions.invoke("page_reader", {
        url: website,
      });
      const innerTimeout = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 6000)
      );
      const pageResult = (await Promise.race([readerPromise, innerTimeout])) as
        | {
            data?: {
              html?: string;
              publishedTime?: string;
            };
          }
        | null;
      html = pageResult?.data?.html || "";
      publishedTime = pageResult?.data?.publishedTime;
    } catch (e) {
      console.warn(
        "[freshness-checker] page_reader failed:",
        (e as Error).message
      );
      // We may still have Last-Modified / SSL info — continue with what we have.
    }

    // -- 2. Copyright year -------------------------------------
    const copyrightYear = parseCopyrightYear(html);

    // -- 4. Mobile responsive ----------------------------------
    const responsiveInfo = checkMobileResponsive(html);

    // -- 5. Structured data (Schema.org) -----------------------
    const structuredDataTypes = extractStructuredDataTypes(html);
    const hasStructuredData = structuredDataTypes.length > 0;

    // -- 6. Booking system ------------------------------------
    const bookingInfo = detectBookingSystem(html);

    // ----------------------------------------------------------
    // 7. Days since last update — derived metric.
    //    Priority: Last-Modified header → copyright year (Jan 1)
    //    → publishedTime from page_reader → null
    // ----------------------------------------------------------
    let resolvedDate: Date | null = lastModifiedDate;
    if (!resolvedDate && copyrightYear) {
      // Assume updated on Jan 1 of copyright year.
      resolvedDate = new Date(copyrightYear, 0, 1);
    }
    if (!resolvedDate && publishedTime) {
      const d = new Date(publishedTime);
      if (!isNaN(d.getTime())) resolvedDate = d;
    }
    const daysSinceLastUpdate = resolvedDate
      ? Math.max(
          0,
          Math.floor((Date.now() - resolvedDate.getTime()) / 86_400_000)
        )
      : null;

    // ----------------------------------------------------------
    // Freshness score (0-100).
    //
    //   slot 1: Last-Modified header within 90d → 30, within 1y → 15, else 0
    //   slot 2: copyright == currentYear → 20, == currentYear-1 → 10, else 0
    //   slot 3: isMobileResponsive → 15
    //   slot 4: hasStructuredData → 15
    //   slot 5: hasBookingSystem → 20
    //
    // Max = 30+20+15+15+20 = 100. Below 30 = "very stale" pain signal.
    // ----------------------------------------------------------
    let score = 0;
    // Slot 1: strictly the HTTP Last-Modified header (per spec formula).
    if (lastModifiedDate) {
      const days = Math.floor(
        (Date.now() - lastModifiedDate.getTime()) / 86_400_000
      );
      if (days <= 90) score += 30;
      else if (days <= 365) score += 15;
    }
    // Slot 2: copyright year.
    if (copyrightYear === currentYear) score += 20;
    else if (copyrightYear === currentYear - 1) score += 10;
    // Slot 3-5: structural signals.
    if (responsiveInfo.isResponsive) score += 15;
    if (hasStructuredData) score += 15;
    if (bookingInfo.found) score += 20;

    const freshnessScore = Math.max(0, Math.min(100, score));

    const comprobableEvidence = buildEvidence({
      isHttps,
      sslAgeDays,
      copyrightYear,
      isMobileResponsive: responsiveInfo.isResponsive,
      hasStructuredData,
      structuredDataTypes,
      hasBookingSystem: bookingInfo.found,
      bookingSystemName: bookingInfo.name,
      daysSinceLastUpdate,
    });

    return {
      lastModifiedHeader: lastModifiedHeader ?? null,
      lastModifiedDate: lastModifiedDate ? lastModifiedDate.toISOString() : null,
      copyrightYear: copyrightYear ?? null,
      isHttps,
      sslAgeDays,
      isMobileResponsive: responsiveInfo.isResponsive,
      hasStructuredData,
      structuredDataTypes,
      hasBookingSystem: bookingInfo.found,
      bookingSystemName: bookingInfo.name,
      daysSinceLastUpdate,
      freshnessScore,
      comprobableEvidence,
      detectedAt,
    };
  })();

  return Promise.race([workPromise, timeoutPromise]);
}
