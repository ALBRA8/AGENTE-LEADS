// ============================================================
// src/lib/security/ssrf.ts
// Self-contained SSRF guard for the dashboard (server-side only).
//
// WHY (P0 defect — Task P0-E, hallazgo H3/H9 de la auditoría):
//   The enrichment modules (freshness-checker, tech-stack-detector,
//   web-scraper-adapter) fetch URLs that come from USER-EDITABLE
//   fields (PATCH /api/prospects → `website`). Without validation an
//   authenticated user can point server-side enrichment at:
//     - cloud metadata      → http://169.254.169.254/latest/meta-data/
//     - loopback services   → http://127.0.0.1:3000, http://localhost:5432
//     - private networks    → 10/8, 172.16/12, 192.168/16, CGNAT 100.64/10
//     - encoded IPv4 bypass → http://2130706433, http://0x7f000001,
//                             http://0177.0.0.1, http://127.1 (mixed radix)
//     - IPv6 bypass         → ::1, ::ffff:127.0.0.1, fc00::/7, fe80::/10
//
// This module is intentionally SEPARATE from the root bot guard
// (src/agent/core/ssrf_guard.ts), which has known bypasses
// (non-dotted IPv4 literals, ::ffff:-mapped IPv4, CGNAT 100.64/10,
// and no DNS resolution → DNS-rebinding TOCTOU). The dashboard must
// NOT import the bot guard; this file has zero internal dependencies.
//
// Pipeline used by ssrfSafeFetch (applied to EVERY redirect hop):
//   1. assertPublicUrl   — scheme, credentials, hostname/IP literal
//   2. resolvePublicHost — DNS must resolve to ONLY public IPs
//   3. fetch with redirect:"manual" + per-hop timeout (AbortSignal)
//
// DNS rebinding / TOCTOU: after DNS validation the platform fetch
// resolves DNS a second time. An attacker controlling a zone with a
// very short TTL could race that second resolution (residual window).
// Native fetch cannot pin IPs without adding dependencies (forbidden
// in this task). The TLS probe in freshness-checker DOES connect to
// the validated IP (pinned) with SNI = original hostname.
//
// PORTS: explicit ports are ALLOWED (http://example.com:8080). The
// primary control is scheme+IP+DNS validation, not a port blocklist;
// a port blocklist would break legitimate prospect sites and is an
// accepted, documented decision here.
//
// DNS CACHE: successful resolutions are cached per hostname for
// 60 s (DNS_CACHE_TTL_MS) to avoid a lookup on every enrichment call.
// Failures are never cached (fail-closed on each fresh attempt).
// ============================================================

import { lookup as dnsLookup } from "node:dns/promises";

// ------------------------------------------------------------
// Errors
// ------------------------------------------------------------

export type SsrfErrorCode =
  | "SSRF_INVALID_URL"
  | "SSRF_BAD_SCHEME"
  | "SSRF_CREDENTIALS"
  | "SSRF_LOCAL_HOSTNAME"
  | "SSRF_PRIVATE_IP_LITERAL"
  | "SSRF_DNS_LOOKUP_FAILED"
  | "SSRF_DNS_PRIVATE_IP"
  | "SSRF_BLOCKED";

export class SsrfError extends Error {
  readonly code: SsrfErrorCode;

  constructor(code: SsrfErrorCode, message: string) {
    super(message);
    this.name = "SsrfError";
    this.code = code;
  }
}

/**
 * Thrown by ssrfSafeFetch when ANY hop (initial URL or redirect
 * Location) fails SSRF validation. `.reason` carries the human
 * readable motive; `.url` the offending URL; `cause` the original
 * SsrfError when applicable.
 */
export class SsrfBlockedError extends SsrfError {
  readonly reason: string;
  readonly url: string;

  constructor(reason: string, url?: string, options?: { cause?: unknown }) {
    super("SSRF_BLOCKED", `SSRF blocked: ${reason}${url ? ` [${url}]` : ""}`);
    this.name = "SsrfBlockedError";
    this.reason = reason;
    this.url = url ?? "";
    if (options && options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

// ------------------------------------------------------------
// IPv4 — WHATWG-style parser that understands EVERY encoding:
// dotted decimal, pure decimal (2130706433), hex (0x7f000001),
// octal (0177.0.0.1) and mixed radix (0x7f.1, 127.0x1, 127.1).
// Returns the 32-bit unsigned value, or null if `host` is not an
// IPv4 literal in any encoding.
// ------------------------------------------------------------

function dottedQuadToInt(base: string): number {
  const p = base.split(".").map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

export function normalizeIpv4Value(host: string): number | null {
  let s = String(host ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  // WHATWG allows a single trailing dot ("127.0.0.1.")
  if (s.endsWith(".")) s = s.slice(0, -1);
  if (!s || s.includes("..")) return null;

  const parts = s.split(".");
  if (parts.length < 1 || parts.length > 4) return null;

  const nums: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "") return null;
    let v: number;
    if (p.startsWith("0x") || p.startsWith("0X")) {
      const hex = p.slice(2);
      if (!/^[0-9a-f]+$/.test(hex)) return null;
      v = parseInt(hex, 16);
    } else if (p.length > 1 && p.startsWith("0")) {
      // legacy octal — "08"/"09" are invalid encodings → not an IPv4
      if (!/^[0-7]+$/.test(p)) return null;
      v = parseInt(p, 8);
    } else {
      if (!/^[0-9]+$/.test(p)) return null; // rejects "1e3", "abc", "+"…
      v = parseInt(p, 10);
    }
    if (!Number.isFinite(v)) return null;
    nums.push(v);
  }

  // WHATWG: every part except the last must be ≤ 255; the last part
  // must fit in (5 - partCount) bytes.
  const n = nums.length;
  let value = 0;
  for (let i = 0; i < n - 1; i++) {
    if (nums[i] > 255) return null;
    value = value * 256 + nums[i];
  }
  const lastBytes = 5 - n; // 4 for a single part, 1 for a dotted quad
  if (nums[n - 1] >= Math.pow(256, lastBytes)) return null;
  value = value * Math.pow(256, lastBytes) + nums[n - 1];
  if (value > 0xffffffff) return null;
  return value >>> 0;
}

export function ipv4ToString(v: number): string {
  return `${(v >>> 24) & 255}.${(v >>> 16) & 255}.${(v >>> 8) & 255}.${v & 255}`;
}

// ------------------------------------------------------------
// Private / reserved IPv4 ranges (fail-closed list).
//   0.0.0.0/8       "this network" — includes 0.0.0.0
//   10.0.0.0/8      RFC1918 private
//   100.64.0.0/10   CGNAT (Tailscale, carrier NAT) — bot-guard bypass fix
//   127.0.0.0/8     loopback
//   169.254.0.0/16  link-local — includes AWS/GCP/Azure metadata 169.254.169.254
//   172.16.0.0/12   RFC1918 private
//   192.0.0.0/24    IETF protocol assignments
//   192.0.2.0/24    TEST-NET-1 (documentación)
//   192.168.0.0/16  RFC1918 private
//   198.18.0.0/15   benchmarking — bot-guard bypass fix
//   198.51.100.0/24 TEST-NET-2 (documentación)
//   203.0.113.0/24  TEST-NET-3 (documentación)
//   224.0.0.0/4     multicast
//   240.0.0.0/4     reservado + broadcast 255.255.255.255
// ------------------------------------------------------------

const IPV4_CIDR_BLOCKS: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const IPV4_PRIVATE_RANGES: ReadonlyArray<readonly [number, number]> =
  IPV4_CIDR_BLOCKS.map(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return [dottedQuadToInt(base), mask] as const;
  });

export function isPrivateIpv4Value(v: number): boolean {
  const u = v >>> 0;
  for (const [base, mask] of IPV4_PRIVATE_RANGES) {
    // NOTE: (u & mask) is a signed int32 in JS — normalize with >>> 0
    // before comparing against the unsigned base, or every range with
    // its high bit set (172/12, 169.254/16, 224/4, 240/4…) never matches.
    if (((u & mask) >>> 0) === base) return true;
  }
  return false;
}

// ------------------------------------------------------------
// IPv6 parser → 8 groups of 16 bits (or null).
// Handles :: compression, embedded dotted-quad tails, zone ids.
// ------------------------------------------------------------

export function parseIpv6Groups(input: string): number[] | null {
  let s = String(input ?? "")
    .trim()
    .toLowerCase();
  if (s.startsWith("[")) {
    if (!s.endsWith("]")) return null;
    s = s.slice(1, -1);
  }
  const pct = s.indexOf("%");
  if (pct !== -1) s = s.slice(0, pct); // zone id (::1%eth0)
  if (s === "") return null;

  const expandTokens = (tokens: string[]): number[] | null => {
    const out: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.includes(".")) {
        // dotted-quad IPv4 tail — only legal as the LAST token
        if (i !== tokens.length - 1) return null;
        const v = normalizeIpv4Value(t);
        if (v === null) return null;
        out.push((v >>> 16) & 0xffff, v & 0xffff);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(t)) return null;
        out.push(parseInt(t, 16));
      }
    }
    return out;
  };

  const dc = s.indexOf("::");
  if (dc !== -1) {
    if (s.indexOf("::", dc + 1) !== -1) return null; // more than one "::"
    let head: number[] = [];
    let tail: number[] = [];
    const headStr = s.slice(0, dc);
    const tailStr = s.slice(dc + 2);
    if (headStr !== "") {
      if (headStr.endsWith(":")) return null;
      const h = expandTokens(headStr.split(":"));
      if (!h) return null;
      head = h;
    }
    if (tailStr !== "") {
      if (tailStr.startsWith(":")) return null;
      const t = expandTokens(tailStr.split(":"));
      if (!t) return null;
      tail = t;
    }
    const total = head.length + tail.length;
    if (total > 7) return null; // "::" must compress ≥ 1 group
    const zeros = new Array<number>(8 - total).fill(0);
    return [...head, ...zeros, ...tail];
  }

  const all = expandTokens(s.split(":"));
  if (!all || all.length !== 8) return null;
  return all;
}

function embeddedIpv4(g6: number, g7: number): number {
  return ((g6 << 16) | g7) >>> 0;
}

export function isPrivateIpv6Groups(g: number[]): boolean {
  const [a, b, c, d, e, f, g6, h] = g;
  // :: (unspecified), ::1 (loopback) and deprecated IPv4-compatible
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0) {
    if (g6 === 0 && (h === 0 || h === 1)) return true;
    return isPrivateIpv4Value(embeddedIpv4(g6, h));
  }
  // IPv4-mapped ::ffff:0:0/96 — e.g. ::ffff:127.0.0.1, ::ffff:a00:1
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) {
    return isPrivateIpv4Value(embeddedIpv4(g6, h));
  }
  // ULA fc00::/7 (fc00…fdff)
  if ((a & 0xfe00) === 0xfc00) return true;
  // link-local fe80::/10 (fe80…febf)
  if ((a & 0xffc0) === 0xfe80) return true;
  // multicast ff00::/8
  if ((a & 0xff00) === 0xff00) return true;
  // NAT64 well-known prefix 64:ff9b::/96 → embedded IPv4 reachable
  if (a === 0x0064 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) {
    return isPrivateIpv4Value(embeddedIpv4(g6, h));
  }
  // 6to4 2002::/16 → embedded IPv4
  if (a === 0x2002) {
    return isPrivateIpv4Value(embeddedIpv4(b, c));
  }
  return false;
}

// ------------------------------------------------------------
// Public API — checks
// ------------------------------------------------------------

/**
 * True if `ip` is private/reserved/loopback/etc. Understands every
 * IPv4 encoding (dotted, decimal, hex, octal, mixed) and IPv6
 * (loopback, ULA, link-local, multicast, IPv4-mapped, NAT64, 6to4).
 * Returns false for unparseable inputs (they are hostnames, not IPs).
 */
export function isPrivateIp(ip: string): boolean {
  if (typeof ip !== "string") return false;
  const s = ip.trim();
  if (!s) return false;
  if (s.includes(":") || (s.startsWith("[") && s.endsWith("]"))) {
    const g = parseIpv6Groups(s);
    if (!g) return false;
    return isPrivateIpv6Groups(g);
  }
  const v = normalizeIpv4Value(s);
  if (v === null) return false;
  return isPrivateIpv4Value(v);
}

/** Classifies a hostname as an IP literal (in any encoding) or null. */
export function isIpLiteral(host: string): "ipv4" | "ipv6" | null {
  const h = String(host ?? "")
    .trim()
    .toLowerCase();
  if (!h) return null;
  if (h.includes(":") || (h.startsWith("[") && h.endsWith("]"))) return "ipv6";
  if (normalizeIpv4Value(h) !== null) return "ipv4";
  return null;
}

function normalizeHostname(hostname: string): string {
  return String(hostname ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

/**
 * Validates that `input` is a URL that is safe to fetch server-side.
 * Throws SsrfError (with a machine-readable `.code`) on any violation:
 *   - SSRF_INVALID_URL          unparseable / empty hostname
 *   - SSRF_BAD_SCHEME           anything other than http:/https:
 *   - SSRF_CREDENTIALS          user:pass@ in the URL
 *   - SSRF_LOCAL_HOSTNAME       localhost, *.localhost, *.local, *.internal
 *   - SSRF_PRIVATE_IP_LITERAL   private/reserved IP literal in ANY encoding
 * Explicit ports are allowed (documented decision — see header).
 * Returns the parsed URL.
 */
export function assertPublicUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : input;
  } catch {
    throw new SsrfError("SSRF_INVALID_URL", `invalid URL: ${String(input)}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(
      "SSRF_BAD_SCHEME",
      `non-http(s) scheme rejected: ${url.protocol}`
    );
  }

  if (url.username || url.password) {
    throw new SsrfError(
      "SSRF_CREDENTIALS",
      "URL credentials (user:pass@host) rejected"
    );
  }

  const host = normalizeHostname(url.hostname);
  if (!host) {
    throw new SsrfError("SSRF_INVALID_URL", "URL has an empty hostname");
  }

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new SsrfError(
      "SSRF_LOCAL_HOSTNAME",
      `internal hostname rejected: ${url.hostname}`
    );
  }

  const kind = isIpLiteral(host);
  if (kind === "ipv4") {
    const v = normalizeIpv4Value(host);
    if (v === null || isPrivateIpv4Value(v)) {
      throw new SsrfError(
        "SSRF_PRIVATE_IP_LITERAL",
        `private/reserved IP literal rejected: ${url.hostname}`
      );
    }
  } else if (kind === "ipv6") {
    const g = parseIpv6Groups(host);
    if (!g) {
      // Unparseable IPv6 → fail closed
      throw new SsrfError(
        "SSRF_INVALID_URL",
        `unparseable IPv6 literal rejected: ${url.hostname}`
      );
    }
    if (isPrivateIpv6Groups(g)) {
      throw new SsrfError(
        "SSRF_PRIVATE_IP_LITERAL",
        `private/reserved IPv6 literal rejected: ${url.hostname}`
      );
    }
  } else if (/^[0-9.]+$/.test(host)) {
    // All digits-and-dots but not a valid IPv4 → suspicious → fail closed
    throw new SsrfError(
      "SSRF_INVALID_URL",
      `ambiguous numeric hostname rejected: ${url.hostname}`
    );
  }

  return url;
}

// ------------------------------------------------------------
// DNS resolution + validation (with 60 s TTL cache)
// ------------------------------------------------------------

export const DNS_CACHE_TTL_MS = 60_000;

const dnsCache = new Map<string, { ips: string[]; expires: number }>();

/** Clears the DNS cache (exposed for tests and cache invalidation). */
export function clearDnsCache(): void {
  dnsCache.clear();
}

/**
 * Resolves `hostname` and validates that EVERY returned IP is public.
 * - If the hostname is already an IP literal (any encoding), validates
 *   it directly and returns it — no DNS query is made.
 * - Otherwise uses dns.promises.lookup({all:true, verbatim:true}) and
 *   FAILS CLOSED if any resolved address is private/reserved (mixed
 *   public+private results are rejected too).
 * Returns the list of validated IPs. Throws SsrfError:
 *   - SSRF_PRIVATE_IP_LITERAL  literal is private
 *   - SSRF_DNS_LOOKUP_FAILED   DNS failure / no addresses
 *   - SSRF_DNS_PRIVATE_IP      any resolved address is private
 */
export async function resolvePublicHost(hostname: string): Promise<string[]> {
  const host = normalizeHostname(hostname);
  if (!host) {
    throw new SsrfError("SSRF_INVALID_URL", "empty hostname to resolve");
  }

  // IP literals never hit DNS
  const kind = isIpLiteral(host);
  if (kind === "ipv4") {
    const v = normalizeIpv4Value(host);
    if (v === null || isPrivateIpv4Value(v)) {
      throw new SsrfError(
        "SSRF_PRIVATE_IP_LITERAL",
        `private/reserved IP literal rejected: ${hostname}`
      );
    }
    return [ipv4ToString(v)];
  }
  if (kind === "ipv6") {
    const g = parseIpv6Groups(host);
    if (!g || isPrivateIpv6Groups(g)) {
      throw new SsrfError(
        "SSRF_PRIVATE_IP_LITERAL",
        `private/reserved IPv6 literal rejected: ${hostname}`
      );
    }
    return [g.map((x) => x.toString(16)).join(":")];
  }

  const cached = dnsCache.get(host);
  if (cached && cached.expires > Date.now()) {
    return cached.ips.slice();
  }

  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = (await dnsLookup(host, {
      all: true,
      verbatim: true,
    })) as Array<{ address: string; family: number }>;
  } catch (e) {
    throw new SsrfError(
      "SSRF_DNS_LOOKUP_FAILED",
      `DNS lookup failed for "${host}": ${(e as Error)?.message ?? String(e)}`
    );
  }

  if (!addrs || addrs.length === 0) {
    throw new SsrfError(
      "SSRF_DNS_LOOKUP_FAILED",
      `DNS returned no addresses for "${host}"`
    );
  }

  for (const addr of addrs) {
    if (isPrivateIp(addr.address)) {
      throw new SsrfError(
        "SSRF_DNS_PRIVATE_IP",
        `DNS for "${host}" resolves to private/reserved IP ${addr.address} — blocked (fail-closed)`
      );
    }
  }

  const ips = addrs.map((a) => a.address);
  dnsCache.set(host, { ips, expires: Date.now() + DNS_CACHE_TTL_MS });
  return ips.slice();
}

// ------------------------------------------------------------
// ssrfSafeFetch — validate + fetch with controlled redirects
// ------------------------------------------------------------

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SsrfFetchOptions {
  /** Maximum redirects followed. Every hop is fully re-validated. Default 3. */
  maxRedirects?: number;
  /** Timeout per hop in ms (AbortSignal-based). Default 8000. */
  timeoutMs?: number;
}

/**
 * SSRF-safe fetch. Validates scheme + IP literal + DNS for the initial
 * URL AND for every redirect Location (redirect: "manual", N=3 by
 * default). Non-security errors (network failures, aborts/timeouts)
 * propagate unchanged so callers can distinguish them from blocks —
 * security blocks always throw SsrfBlockedError (a SsrfError subclass).
 */
export async function ssrfSafeFetch(
  url: string | URL,
  init?: RequestInit,
  opts?: SsrfFetchOptions
): Promise<Response> {
  const maxRedirects = Math.max(0, opts?.maxRedirects ?? 3);
  const timeoutMs = opts?.timeoutMs ?? 8000;

  // Respect a pre-aborted external signal immediately.
  const external = init?.signal ?? null;
  if (external?.aborted) {
    throw (
      external.reason ??
      new DOMException("The operation was aborted.", "AbortError")
    );
  }

  let current = typeof url === "string" ? url : url.toString();
  let redirectsFollowed = 0;

  for (;;) {
    // 1. Scheme + credentials + hostname/IP-literal validation
    let parsed: URL;
    try {
      parsed = assertPublicUrl(current);
    } catch (e) {
      if (e instanceof SsrfError) {
        throw new SsrfBlockedError(e.message, current, { cause: e });
      }
      throw e;
    }

    // 2. DNS: every resolved IP must be public (cached 60 s per host)
    try {
      await resolvePublicHost(parsed.hostname);
    } catch (e) {
      if (e instanceof SsrfError) {
        throw new SsrfBlockedError(e.message, current, { cause: e });
      }
      throw e;
    }

    // 3. Fetch this hop (per-hop timeout + external signal propagation)
    const res = await fetchHop(current, init, timeoutMs);

    // 4. Manual redirect handling — each Location re-enters the pipeline
    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get("location");
      if (!location) return res;
      if (redirectsFollowed >= maxRedirects) {
        cancelBody(res);
        throw new SsrfBlockedError(
          `too many redirects (max ${maxRedirects})`,
          current
        );
      }
      let next: URL;
      try {
        next = new URL(location, parsed);
      } catch {
        cancelBody(res);
        throw new SsrfBlockedError(
          `invalid redirect Location: ${location}`,
          current
        );
      }
      redirectsFollowed++;
      cancelBody(res);
      current = next.toString();
      continue;
    }

    return res;
  }
}

function cancelBody(res: Response): void {
  try {
    res.body?.cancel();
  } catch {
    /* noop */
  }
}

async function fetchHop(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<Response> {
  const ctrl = new AbortController();
  const external = init?.signal ?? null;
  const onAbort = () => ctrl.abort(external?.reason);
  if (external) {
    if (external.aborted) ctrl.abort(external.reason);
    else external.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(
    () =>
      ctrl.abort(new Error(`ssrfSafeFetch: hop timeout after ${timeoutMs}ms`)),
    timeoutMs
  );
  if (typeof timer.unref === "function") timer.unref();
  try {
    return await fetch(url, {
      ...init,
      redirect: "manual",
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener("abort", onAbort);
  }
}
