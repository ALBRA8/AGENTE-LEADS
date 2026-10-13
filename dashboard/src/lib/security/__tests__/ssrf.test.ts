// ============================================================
// src/lib/security/__tests__/ssrf.test.ts
// Tests for the dashboard SSRF guard. NO real network is used:
//   - node:dns/promises is mocked via vi.mock
//   - global fetch is stubbed via vi.stubGlobal
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
  default: { lookup: lookupMock },
}));

import {
  assertPublicUrl,
  clearDnsCache,
  isIpLiteral,
  isPrivateIp,
  normalizeIpv4Value,
  resolvePublicHost,
  ssrfSafeFetch,
  SsrfBlockedError,
  SsrfError,
} from "@/lib/security/ssrf";

const PUBLIC_IP = "93.184.216.34";

const dnsPublic = (ip: string = PUBLIC_IP) => [
  { address: ip, family: ip.includes(":") ? 6 : 4 },
];

const jsonResponse = (status: number, headers: Record<string, string> = {}) =>
  new Response(null, { status, headers });

const fetchMock = vi.fn();

beforeEach(() => {
  // resetAllMocks (not clearAllMocks): leftover mockResolvedValueOnce
  // queues from a previous test must never leak into the next one.
  vi.resetAllMocks();
  clearDnsCache();
  vi.stubGlobal("fetch", fetchMock);
  // default DNS: every host resolves to a public IP
  lookupMock.mockImplementation(async (_host: string) => dnsPublic());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------
// isPrivateIp — full table (incl. every known bot-guard bypass)
// ------------------------------------------------------------

describe("isPrivateIp", () => {
  const PRIVATE = [
    // loopback + dotted encodings
    "127.0.0.1",
    "127.8.8.8",
    "127.0.0.1.",
    // RFC1918
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    // link-local + AWS metadata
    "169.254.169.254",
    "169.254.0.1",
    // 0.0.0.0/8
    "0.0.0.0",
    "0.1.2.3",
    // CGNAT 100.64/10 (bot-guard bypass)
    "100.64.0.1",
    "100.127.255.255",
    // benchmarking 198.18/15 (bot-guard bypass)
    "198.18.0.5",
    "198.19.255.255",
    // 192.0.0.0/24, TEST-NETs
    "192.0.0.5",
    "192.0.2.9",
    "198.51.100.7",
    "203.0.113.9",
    // multicast + reserved
    "224.0.0.1",
    "239.1.1.1",
    "240.0.0.1",
    "255.255.255.255",
    // NON-DOTTED IPv4 literals (bot-guard bypasses)
    "2130706433", // decimal → 127.0.0.1
    "0x7f000001", // hex → 127.0.0.1
    "0177.0.0.1", // octal → 127.0.0.1
    "0x7f.1", // mixed → 127.0.0.1
    "127.1", // partial dotted → 127.0.0.1
    "0x7f.0.0.1", // mixed radix
    // IPv6
    "::1",
    "[::1]",
    "::", // unspecified
    "::ffff:127.0.0.1", // IPv4-mapped loopback (bot-guard bypass)
    "::ffff:a00:1", // IPv4-mapped 10.0.0.1
    "::ffff:10.0.0.5", // IPv4-mapped dotted
    "fc00::1",
    "fd12:3456::1", // ULA fc00::/7
    "fe80::1",
    "febf::1", // link-local fe80::/10
    "ff02::1", // multicast
    "64:ff9b::7f00:1", // NAT64 → 127.0.0.1
    "2002:7f00:1::", // 6to4 → 127.0.0.1
  ];

  const PUBLIC = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "3.4.5.6",
    "172.15.255.255", // just below 172.16/12
    "172.32.0.1", // just above 172.16/12
    "100.63.255.255", // just below CGNAT
    "100.128.0.1", // just above CGNAT
    "198.17.0.1", // below 198.18/15
    "198.20.0.1", // above 198.18/15
    "169.253.1.1", // below link-local
    "169.255.1.1", // above link-local
    "2606:4700::1111",
    "2001:4860:4860::8888",
    "2002:0808:0808::", // 6to4 → 8.8.8.8 (public embedded)
    "64:ff9b::808:808", // NAT64 → 8.8.8.8 (public embedded)
    // hostnames are NOT IPs → false
    "example.com",
    "municipio.gov.co",
    "999.1.1.1", // invalid IPv4 (part > 255) → not an IP
    "1.2.3.4.5", // 5 parts → not an IP
  ];

  it.each(PRIVATE)("flags private/reserved: %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(PUBLIC)("does not flag public: %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

// ------------------------------------------------------------
// normalizeIpv4Value — every encoding collapses to the same value
// ------------------------------------------------------------

describe("normalizeIpv4Value", () => {
  it("decodes non-dotted encodings to the 32-bit value", () => {
    expect(normalizeIpv4Value("127.0.0.1")).toBe(0x7f000001);
    expect(normalizeIpv4Value("2130706433")).toBe(0x7f000001);
    expect(normalizeIpv4Value("0x7f000001")).toBe(0x7f000001);
    expect(normalizeIpv4Value("0177.0.0.1")).toBe(0x7f000001);
    expect(normalizeIpv4Value("0x7f.1")).toBe(0x7f000001);
    expect(normalizeIpv4Value("127.1")).toBe(0x7f000001);
  });

  it("rejects invalid encodings", () => {
    expect(normalizeIpv4Value("example.com")).toBeNull();
    expect(normalizeIpv4Value("1.2.3.4.5")).toBeNull();
    expect(normalizeIpv4Value("999.1.1.1")).toBeNull();
    expect(normalizeIpv4Value("09.1.1.1")).toBeNull(); // invalid octal
    expect(normalizeIpv4Value("1e3")).toBeNull(); // no scientific notation
    expect(normalizeIpv4Value("")).toBeNull();
  });
});

// ------------------------------------------------------------
// isIpLiteral
// ------------------------------------------------------------

describe("isIpLiteral", () => {
  it("classifies literals", () => {
    expect(isIpLiteral("8.8.8.8")).toBe("ipv4");
    expect(isIpLiteral("2130706433")).toBe("ipv4");
    expect(isIpLiteral("0x7f000001")).toBe("ipv4");
    expect(isIpLiteral("::1")).toBe("ipv6");
    expect(isIpLiteral("[2606:4700::1111]")).toBe("ipv6");
    expect(isIpLiteral("example.com")).toBeNull();
  });
});

// ------------------------------------------------------------
// assertPublicUrl
// ------------------------------------------------------------

describe("assertPublicUrl", () => {
  const REJECTED: Array<[string, SsrfError["code"]]> = [
    ["file:///etc/passwd", "SSRF_BAD_SCHEME"],
    ["ftp://example.com/file", "SSRF_BAD_SCHEME"],
    ["gopher://example.com", "SSRF_BAD_SCHEME"],
    ["http://user:pass@example.com/", "SSRF_CREDENTIALS"],
    ["https://admin:secret@example.com/", "SSRF_CREDENTIALS"],
    ["http://localhost/", "SSRF_LOCAL_HOSTNAME"],
    ["http://LOCALHOST:3000/", "SSRF_LOCAL_HOSTNAME"],
    ["http://api.localhost/", "SSRF_LOCAL_HOSTNAME"],
    ["http://foo.local/", "SSRF_LOCAL_HOSTNAME"],
    ["http://service.internal/", "SSRF_LOCAL_HOSTNAME"],
    ["http://127.0.0.1:3000/", "SSRF_PRIVATE_IP_LITERAL"],
    ["http://10.0.0.1/", "SSRF_PRIVATE_IP_LITERAL"],
    ["http://172.16.1.1/", "SSRF_PRIVATE_IP_LITERAL"],
    ["http://192.168.1.1/", "SSRF_PRIVATE_IP_LITERAL"],
    [
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      "SSRF_PRIVATE_IP_LITERAL",
    ],
    ["http://100.64.0.1/", "SSRF_PRIVATE_IP_LITERAL"],
    ["http://198.18.0.5/", "SSRF_PRIVATE_IP_LITERAL"],
    ["http://0.0.0.0:8080/", "SSRF_PRIVATE_IP_LITERAL"],
    // non-dotted / encoded IPv4 literals (bot-guard bypasses)
    ["http://2130706433/", "SSRF_PRIVATE_IP_LITERAL"],
    ["http://0x7f000001/", "SSRF_PRIVATE_IP_LITERAL"],
    ["http://0177.0.0.1/", "SSRF_PRIVATE_IP_LITERAL"],
    ["http://0x7f.1/", "SSRF_PRIVATE_IP_LITERAL"],
    // IPv6
    ["http://[::1]/", "SSRF_PRIVATE_IP_LITERAL"],
    ["http://[::ffff:127.0.0.1]/", "SSRF_PRIVATE_IP_LITERAL"],
    ["http://[fc00::1]/", "SSRF_PRIVATE_IP_LITERAL"],
    ["http://[fe80::1]/", "SSRF_PRIVATE_IP_LITERAL"],
  ];

  it.each(REJECTED)("rejects %s with code %s", (url, code) => {
    let err: unknown;
    try {
      assertPublicUrl(url);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SsrfError);
    expect((err as SsrfError).code).toBe(code);
  });

  it("rejects unparseable URLs", () => {
    expect(() => assertPublicUrl("not a url at all")).toThrow(SsrfError);
  });

  const ACCEPTED = [
    "https://example.com/",
    "http://example.com/",
    "https://municipio.gov.co/pagina?q=1",
    "https://8.8.8.8/", // public IP literal is fine
    "https://[2606:4700::1111]/", // public IPv6 literal is fine
  ];

  it.each(ACCEPTED)("accepts %s and returns the parsed URL", (url) => {
    const parsed = assertPublicUrl(url);
    expect(parsed).toBeInstanceOf(URL);
  });

  it("allows explicit ports (documented decision)", () => {
    const parsed = assertPublicUrl("http://example.com:8080/path");
    expect(parsed.port).toBe("8080");
    expect(parsed.hostname).toBe("example.com");
  });
});

// ------------------------------------------------------------
// resolvePublicHost — mocked DNS
// ------------------------------------------------------------

describe("resolvePublicHost", () => {
  it("resolves a public host and validates the IPs", async () => {
    lookupMock.mockResolvedValueOnce(dnsPublic("8.8.4.4"));
    const ips = await resolvePublicHost("ok.example.com");
    expect(ips).toEqual(["8.8.4.4"]);
    expect(lookupMock).toHaveBeenCalledWith("ok.example.com", {
      all: true,
      verbatim: true,
    });
  });

  it("fails closed when ALL resolved IPs are private", async () => {
    lookupMock.mockResolvedValueOnce(dnsPublic("192.168.1.10"));
    await expect(resolvePublicHost("private.example.com")).rejects.toMatchObject(
      { code: "SSRF_DNS_PRIVATE_IP" }
    );
  });

  it("fails closed on MIXED public+private DNS answers", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    await expect(resolvePublicHost("mixed.example.com")).rejects.toMatchObject(
      { code: "SSRF_DNS_PRIVATE_IP" }
    );
  });

  it("maps DNS failures to SSRF_DNS_LOOKUP_FAILED", async () => {
    lookupMock.mockRejectedValueOnce(
      Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" })
    );
    await expect(resolvePublicHost("nope.example.com")).rejects.toMatchObject({
      code: "SSRF_DNS_LOOKUP_FAILED",
    });
  });

  it("caches resolutions for 60s (one lookup per host)", async () => {
    lookupMock.mockClear();
    lookupMock.mockResolvedValue(dnsPublic("8.8.4.4"));
    await resolvePublicHost("cached.example.com");
    await resolvePublicHost("cached.example.com");
    await resolvePublicHost("cached.example.com");
    expect(lookupMock).toHaveBeenCalledTimes(1);
    clearDnsCache();
    await resolvePublicHost("cached.example.com");
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  it("validates IP literals without hitting DNS", async () => {
    lookupMock.mockClear();
    await expect(resolvePublicHost("127.0.0.1")).rejects.toMatchObject({
      code: "SSRF_PRIVATE_IP_LITERAL",
    });
    await expect(resolvePublicHost("2130706433")).rejects.toMatchObject({
      code: "SSRF_PRIVATE_IP_LITERAL",
    });
    const ips = await resolvePublicHost("8.8.8.8");
    expect(ips).toEqual(["8.8.8.8"]);
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
// ssrfSafeFetch — stubbed global fetch
// ------------------------------------------------------------

describe("ssrfSafeFetch", () => {
  it("fetches a public URL (200 OK)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { "x-test": "1" }));
    const res = await ssrfSafeFetch("https://ok.example.com/page");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-test")).toBe("1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://ok.example.com/page");
    // fetch must be called with manual redirects
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  });

  it("fetches a public IP-literal URL without DNS", async () => {
    lookupMock.mockClear();
    fetchMock.mockResolvedValueOnce(jsonResponse(200));
    const res = await ssrfSafeFetch("https://8.8.8.8/dns-query");
    expect(res.status).toBe(200);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("follows a public redirect (re-validating each hop)", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(302, { Location: "https://cdn.example.com/final" })
      )
      .mockResolvedValueOnce(jsonResponse(200));
    const res = await ssrfSafeFetch("https://ok.example.com/r");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://cdn.example.com/final");
  });

  it("BLOCKS a redirect to 127.0.0.1 without fetching it", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(302, { Location: "http://127.0.0.1:8080/admin" })
      )
      .mockResolvedValueOnce(jsonResponse(200)); // must never be used

    const err = await ssrfSafeFetch("https://ok.example.com/").then(
      () => null,
      (e) => e
    );
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect(err).toBeInstanceOf(SsrfError);
    expect(err.reason).toMatch(/127\.0\.0\.1/);
    // the second fetch to the private destination must NOT happen
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("BLOCKS a redirect whose host resolves to a private IP (rebinding)", async () => {
    lookupMock.mockImplementation(async (host: string) => {
      if (host === "ok.example.com") return dnsPublic(PUBLIC_IP);
      if (host === "rebind.example.com") return dnsPublic("10.0.0.5");
      return dnsPublic();
    });
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(302, { Location: "http://rebind.example.com/" })
      )
      .mockResolvedValueOnce(jsonResponse(200)); // must never be used

    const err = await ssrfSafeFetch("https://ok.example.com/").then(
      () => null,
      (e) => e
    );
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect(err.reason).toMatch(/10\.0\.0\.5/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("BLOCKS non-http schemes before any fetch", async () => {
    const err = await ssrfSafeFetch("file:///etc/passwd").then(
      () => null,
      (e) => e
    );
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect(err.reason).toMatch(/scheme/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("BLOCKS private IP literals (metadata endpoint) before any fetch", async () => {
    const err = await ssrfSafeFetch(
      "http://169.254.169.254/latest/meta-data/"
    ).then(
      () => null,
      (e) => e
    );
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("BLOCKS encoded non-dotted IPv4 literals (bot-guard bypass)", async () => {
    for (const u of [
      "http://2130706433/",
      "http://0x7f000001/",
      "http://0177.0.0.1/",
    ]) {
      fetchMock.mockClear();
      const err = await ssrfSafeFetch(u).then(
        () => null,
        (e) => e
      );
      expect(err).toBeInstanceOf(SsrfBlockedError);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("BLOCKS URLs with credentials before any fetch", async () => {
    const err = await ssrfSafeFetch("http://user:pass@example.com/").then(
      () => null,
      (e) => e
    );
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("BLOCKS when DNS mixes public and private answers", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "8.8.8.8", family: 4 },
      { address: "192.168.0.10", family: 4 },
    ]);
    const err = await ssrfSafeFetch("https://mixed.example.com/").then(
      () => null,
      (e) => e
    );
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect(err.reason).toMatch(/192\.168\.0\.10/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces maxRedirects", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(302, { Location: "https://ok.example.com/loop" })
    );
    const err = await ssrfSafeFetch("https://ok.example.com/start", undefined, {
      maxRedirects: 2,
    }).then(
      () => null,
      (e) => e
    );
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect(err.reason).toMatch(/too many redirects/i);
    // initial fetch + 2 followed redirects = 3
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("applies the per-hop timeout via AbortSignal", async () => {
    fetchMock.mockImplementation(
      (_url: string, i: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          i.signal!.addEventListener("abort", () => reject(i.signal!.reason));
        })
    );
    await expect(
      ssrfSafeFetch("https://slow.example.com/", undefined, { timeoutMs: 25 })
    ).rejects.toThrow(/timeout/i);
  });

  it("rejects immediately when the external signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort(new Error("aborted before start"));
    await expect(
      ssrfSafeFetch("https://ok.example.com/", { signal: ctrl.signal })
    ).rejects.toThrow(/aborted before start/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates an external abort mid-flight", async () => {
    fetchMock.mockImplementation(
      (_url: string, i: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          i.signal!.addEventListener("abort", () => reject(i.signal!.reason));
        })
    );
    const ctrl = new AbortController();
    const pending = ssrfSafeFetch("https://ok.example.com/", {
      signal: ctrl.signal,
    });
    setTimeout(() => ctrl.abort(new Error("aborted mid-flight")), 10);
    await expect(pending).rejects.toThrow(/aborted mid-flight/i);
  });

  it("passes through method/headers/body init", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200));
    await ssrfSafeFetch("https://ok.example.com/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.redirect).toBe("manual");
  });
});
