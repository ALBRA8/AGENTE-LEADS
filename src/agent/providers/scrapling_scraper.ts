// ============================================================
// src/agent/providers/scrapling_scraper.ts
// P0.2 — ScrapingProvider backed by the existing python_bridge.
//
// Reuses `src/agent/utils/python_bridge.ts` (NOT modified). The Python
// side (src/agent/scripts/stealth_scraper.py) uses Scrapling, which is
// a fetcher with stealth-like browser fingerprinting (real browser UA,
// TLS profile, optional adaptive waiting). It is NOT a CAPTCHA /
// Cloudflare / Akamai bypass tool — when a site is hard-blocked this
// provider will return a `TEMPORARY_FAILURE` error.
//
// Refactor of `src/agent/tools/scrape_stealth.ts`:
//   - Same bridge call (runStealthScraper)
//   - Returns normalized `ScrapeOutput` (status / text / emails / social)
//   - Errors flow through `normalizeError()` / `makeError()`
// ============================================================

import type {
  ScrapingProvider,
  ScrapeInput,
  ScrapeOutput,
  ProviderResult,
} from "./types.js";
import { makeError, normalizeError } from "../core/errors.js";
import { runStealthScraper } from "../utils/python_bridge.js";
import path from "path";
import fs from "fs";

export class ScraplingScrapingProvider implements ScrapingProvider {
  name = "Scrapling";

  async isConfigured(): Promise<boolean> {
    // Same venv location the python_bridge resolves to.
    const isWindows = process.platform === "win32";
    const pythonExe = path.resolve(
      process.cwd(),
      ".venv",
      isWindows ? "Scripts" : "bin",
      "python"
    );
    return fs.existsSync(pythonExe);
  }

  async scrape(input: ScrapeInput): Promise<ProviderResult<ScrapeOutput>> {
    if (!(await this.isConfigured())) {
      return {
        ok: false,
        error: makeError(
          "PROVIDER_UNAVAILABLE",
          "Python venv not found — Scrapling unavailable",
          { provider: this.name }
        ),
      };
    }
    try {
      // The bridge's third argument is `adaptive` (selective waiting). When the
      // caller asks for `network_idle`, we forward it as the adaptive flag.
      const result = await runStealthScraper(
        input.url,
        input.selector,
        input.network_idle
      );
      if (!result.success) {
        return {
          ok: false,
          error: makeError(
            "TEMPORARY_FAILURE",
            result.error || "Scrapling failed",
            { provider: this.name }
          ),
        };
      }
      const data = (result.result ?? {}) as {
        text?: string;
        emails_found?: string[];
        social_links?: string[];
      };
      return {
        ok: true,
        data: {
          url: input.url,
          status: 200,
          text: data.text,
          html: undefined,
          emails_found: data.emails_found ?? [],
          social_links: data.social_links ?? [],
        },
      };
    } catch (err) {
      return { ok: false, error: normalizeError(err, this.name) };
    }
  }
}
