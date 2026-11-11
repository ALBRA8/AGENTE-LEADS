// ============================================================
// src/agent/core/ssrf_guard.ts
// SSRF protection — validates URLs before the server fetches them.
//
// Rejects:
//   - Non-http(s) schemes (file://, ftp://, etc.)
//   - Private IP ranges (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
//   - Link-local (169.254.0.0/16) — includes cloud metadata endpoints
//   - IPv6 loopback (::1) and ULA (fc00::/7)
//   - Localhost hostnames
// ============================================================

import { makeError, type ProviderError } from "./errors.js";

/**
 * Returns true if the URL is safe to fetch server-side.
 * Returns false (and an error message) for SSRF-risky URLs.
 */
export function assertPublicUrl(url: string): { ok: true } | { ok: false; error: ProviderError } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: makeError("INVALID_INPUT", `invalid URL: ${url}`) };
  }

  // Must be http or https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: makeError("INVALID_INPUT", `non-http(s) scheme rejected: ${parsed.protocol}`) };
  }

  const host = parsed.hostname.toLowerCase();

  // Reject localhost / loopback
  if (host === "localhost" || host === "::1" || host === "[::1]") {
    return { ok: false, error: makeError("INVALID_INPUT", `localhost rejected: ${host}`) };
  }

  // Check if it's an IP (IPv4 or IPv6)
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isIpv6 = host.includes(":") || host.startsWith("[");
  if (isIpv4 || isIpv6) {
    const ip = host.replace(/^\[|\]$/g, "");
    if (isPrivateIp(ip)) {
      return { ok: false, error: makeError("INVALID_INPUT", `private IP rejected: ${ip}`) };
    }
  }

  // Reject hostnames that look like internal names (heuristic: no dot = likely internal)
  // But allow single-label hostnames in dev environments
  // (we don't want to break "localhost" — already caught above)

  return { ok: true };
}

function isPrivateIp(ip: string): boolean {
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split(".").map(Number);
    // 127.0.0.0/8 — loopback
    if (parts[0] === 127) return true;
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 — link-local (includes AWS metadata 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.0.0.0/8
    if (parts[0] === 0) return true;
    return false;
  }
  // IPv6 — reject loopback, ULA, link-local
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;  // ULA fc00::/7
  if (lower.startsWith("fe80")) return true;  // link-local
  if (lower.startsWith("ff")) return true;  // multicast
  return false;
}
