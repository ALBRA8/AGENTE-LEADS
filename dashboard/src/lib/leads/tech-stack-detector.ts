// ============================================================
// src/lib/leads/tech-stack-detector.ts
// Detects the technology stack of a prospect's website by
// analyzing HTML signatures fetched via z-ai-web-dev-sdk's
// page_reader function.
//
// Why this matters for AGENTE LEADS:
//   When selling design / marketing / web services, the
//   strongest "will-they-buy" signal is what the prospect
//   runs *today*. A WordPress + free-default-theme clinic
//   is a high-fit prospect for a redesign; a Shopify Plus
//   retailer is not.
//
// Identifies: CMS, JS framework, WP page builder, e-commerce
// platform, theme name, and DIY vs. Pro site inference.
//
// Never throws — on any error returns a result object with
// an empty `rawSignatures` array and `cms: "unknown"`.
// Total time boxed to ~5 seconds (page_reader usually 2-3s).
// ============================================================

import { getAIClient } from "@/lib/ai/client";

export interface TechStackResult {
  cms?:
    | "wordpress"
    | "shopify"
    | "wix"
    | "squarespace"
    | "webflow"
    | "drupal"
    | "joomla"
    | "ghost"
    | "custom_next"
    | "custom_nuxt"
    | "custom_angular"
    | "webnode"
    | "jimdo"
    | "carrd"
    | "unknown";
  framework?:
    | "next"
    | "nuxt"
    | "angular"
    | "react"
    | "vue"
    | "laravel"
    | "django"
    | "rails";
  builder?:
    | "elementor"
    | "divi"
    | "wpbakery"
    | "beaver_builder"
    | "brizy"
    | "bricks"
    | "native";
  ecommerce?:
    | "woocommerce"
    | "shopify"
    | "bigcommerce"
    | "magento"
    | "prestashop"
    | "opencart"
    | "vtex";
  themeName?: string;
  isFreeTheme?: boolean;
  isDiySite?: boolean;
  isProSite?: boolean;
  rawSignatures: string[];
  detectedAt: string;
}

interface Signature {
  /** Stable identifier recorded in rawSignatures */
  id: string;
  /** Substring to find, case-insensitive */
  match: string;
}

// ----------------------------------------------------------------
// CMS signatures. Iteration order matters: Shopify is checked
// first because its CDN signature is unambiguous and a Shopify
// store can also embed /wp-content/ links via a WP blog subpath.
// ----------------------------------------------------------------
const CMS_SIGNATURES: Record<string, Signature[]> = {
  shopify: [
    { id: "shopify-cdn", match: "cdn.shopify.com" },
    { id: "shopify-theme-obj", match: "Shopify.theme" },
    { id: "shopify-window", match: "window.Shopify" },
  ],
  wordpress: [
    { id: "wp-content-path", match: "/wp-content/" },
    { id: "wp-includes-path", match: "/wp-includes/" },
    {
      id: "wp-generator-meta",
      match: '<meta name="generator" content="WordPress',
    },
  ],
  wix: [
    { id: "wix-static", match: "static.wixstatic.com" },
    { id: "wix-parastorage", match: "static.parastorage.com" },
    { id: "wix-header", match: "X-Wix-" },
    { id: "wix-domain", match: "wix.com" },
  ],
  squarespace: [
    { id: "sq-static", match: "static1.squarespace.com" },
    { id: "sq-domain", match: "squarespace.com" },
  ],
  webflow: [
    { id: "wf-domain", match: "webflow.com" },
    { id: "wf-class-prefix", match: "wf-" },
    { id: "wf-uploads", match: "uploads-ssl.webflow.com" },
  ],
  drupal: [
    {
      id: "drupal-generator",
      match: '<meta name="generator" content="Drupal',
    },
    { id: "drupal-link", match: "drupal" },
  ],
  joomla: [
    {
      id: "joomla-generator",
      match: '<meta name="generator" content="Joomla',
    },
  ],
  ghost: [
    {
      id: "ghost-generator",
      match: '<meta name="generator" content="Ghost',
    },
  ],
  custom_next: [
    { id: "next-data", match: "__NEXT_DATA__" },
    { id: "next-static", match: "_next/static" },
    { id: "next-chunks", match: "__NEXT_LOADED_CHUNKS" },
  ],
  custom_nuxt: [
    { id: "nuxt-data", match: "__NUXT__" },
    { id: "nuxt-path", match: "_nuxt/" },
  ],
  custom_angular: [
    { id: "ng-version", match: "ng-version" },
    { id: "ng-path", match: "_ng" },
  ],
  webnode: [{ id: "webnode-domain", match: "webnode.com" }],
  jimdo: [{ id: "jimdo-domain", match: "jimdo.com" }],
  carrd: [{ id: "carrd-domain", match: "carrd.co" }],
};

// ----------------------------------------------------------------
// WordPress page builder signatures (only checked when CMS = WP)
// ----------------------------------------------------------------
const BUILDER_SIGNATURES: Record<string, Signature[]> = {
  elementor: [
    { id: "elementor", match: "elementor" },
    { id: "elementor-frontend", match: "elementor-frontend" },
    { id: "elementor-type", match: "data-elementor-type" },
  ],
  divi: [
    { id: "et-builder", match: "et_builder" },
    { id: "et-divi", match: "et_divi" },
  ],
  wpbakery: [
    { id: "wpb-js-composer", match: "wpb-js-composer" },
    { id: "vc-prefix", match: "vc_" },
  ],
  beaver_builder: [{ id: "fl-builder", match: "fl-builder" }],
  brizy: [{ id: "brizy", match: "brizy" }],
  bricks: [{ id: "bricks-prefix", match: "bricks-" }],
};

// ----------------------------------------------------------------
// E-commerce platform signatures (Shopify handled via CMS match)
// ----------------------------------------------------------------
const ECOMMERCE_SIGNATURES: Record<string, Signature[]> = {
  woocommerce: [
    { id: "woocommerce", match: "woocommerce" },
    { id: "wp-woocommerce", match: "wp-woocommerce" },
  ],
  bigcommerce: [
    { id: "bc-domain", match: "bigcommerce.com" },
    { id: "bc-cdn", match: "cdn11.bigcommerce.com" },
  ],
  magento: [
    { id: "mage-prefix", match: "Mage." },
    { id: "mage-path", match: "mage/" },
    { id: "mage-skin", match: "skin/frontend" },
  ],
  prestashop: [
    { id: "prestashop", match: "prestashop" },
    { id: "prestashop-var", match: "var prestashop" },
  ],
  opencart: [
    { id: "opencart", match: "opencart" },
    { id: "opencart-route", match: "index.php?route=" },
  ],
  vtex: [
    { id: "vtex-domain", match: "vtex.com" },
    { id: "vtex-img", match: "vteximg" },
  ],
};

// ----------------------------------------------------------------
// WordPress default (free, bundled) themes — checked by slug
// ----------------------------------------------------------------
const FREE_WP_THEMES = [
  "twentytwentyfive",
  "twentytwentyfour",
  "twentytwentythree",
  "twentytwentytwo",
  "twentytwentyone",
  "twentytwenty",
  "twentynineteen",
  "twentyeighteen",
  "twentyseventeen",
  "twentysixteen",
  "twentyfifteen",
];

// ----------------------------------------------------------------
// Premium WP theme slug -> display name. Order matters when
// multiple slugs could match (longest / more-specific first).
// ----------------------------------------------------------------
const PREMIUM_WP_THEMES: Record<string, string> = {
  et_divi: "Divi",
  "avada-child": "Avada Child",
  avada: "Avada",
  enfold: "Enfold",
  astra: "Astra",
  oceanwp: "OceanWP",
  generatepress: "GeneratePress",
  flatsome: "Flatsome",
  betheme: "Betheme",
  salient: "Salient",
  the7: "The7",
};

/**
 * Case-insensitive substring matcher. Returns the IDs of all
 * signatures that hit. Never throws.
 */
function findMatches(html: string, signatures: Signature[]): string[] {
  if (!html) return [];
  const lower = html.toLowerCase();
  const hits: string[] = [];
  for (const sig of signatures) {
    try {
      if (lower.includes(sig.match.toLowerCase())) {
        hits.push(sig.id);
      }
    } catch {
      /* ignore broken signature */
    }
  }
  return hits;
}

/**
 * Detect the WordPress theme name from raw HTML. Tries three
 * strategies in order: (1) theme path in asset URLs,
 * (2) <meta name="generator" content="<Name> <Version>">,
 * (3) premium theme slug match. Returns undefined when no
 * confident theme can be identified.
 */
function detectThemeName(
  html: string,
  rawSignatures: string[]
): string | undefined {
  const lower = html.toLowerCase();

  // 1. WordPress theme path: /wp-content/themes/<slug>/
  const themePathMatch = html.match(/wp-content\/themes\/([a-z0-9_-]+)/i);
  if (themePathMatch) {
    const slug = themePathMatch[1].toLowerCase();
    rawSignatures.push(`theme:path(${slug})`);
    return slug;
  }

  // 2. <meta name="generator" content="<Name> <Version>">
  //    Skip plain "WordPress X.Y" generator tags (those are the
  //    core generator, not a theme).
  const genMatch = html.match(
    /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i
  );
  if (genMatch) {
    const content = genMatch[1].trim();
    if (!/^wordpress\s+\d/i.test(content)) {
      const themeMatch = content.match(/^([A-Za-z0-9 _-]+?)\s+\d+\.\d+/);
      if (themeMatch && themeMatch[1].length > 1) {
        const name = themeMatch[1].trim();
        rawSignatures.push(`theme:generator(${name})`);
        return name;
      }
    }
  }

  // 3. Premium theme slug match (Divi, Avada, ...)
  for (const [slug, name] of Object.entries(PREMIUM_WP_THEMES)) {
    if (lower.includes(slug.toLowerCase())) {
      rawSignatures.push(`theme:premium(${slug})`);
      return name;
    }
  }

  return undefined;
}

/**
 * Returns true if themeName looks like a WordPress default
 * (free) theme, e.g. "twentytwentyone" or "Twenty Twenty-One".
 */
function looksFreeTheme(themeName?: string): boolean {
  if (!themeName) return false;
  const slug = themeName.toLowerCase().replace(/[\s_-]/g, "");
  return FREE_WP_THEMES.some((t) => t.replace(/[\s_-]/g, "") === slug);
}

/**
 * Detects the technology stack of a prospect's website.
 *
 * Fetches the website's HTML via z-ai-web-dev-sdk's page_reader
 * function and scans it for well-known signatures of CMSes,
 * JS frameworks, WP page builders, e-commerce platforms and
 * theme slugs.
 *
 * Behavior contract:
 *  - Never throws — on any error returns a result with empty
 *    `rawSignatures` and `cms: "unknown"`.
 *  - Total time boxed to ~5 seconds via Promise.race timeout.
 *  - Reads only the page_reader function from the existing
 *    z-ai SDK client — no new packages, no other files touched.
 */
export async function detectTechStack(
  website: string
): Promise<TechStackResult> {
  const detectedAt = new Date().toISOString();
  if (!website || typeof website !== "string") {
    return { detectedAt, rawSignatures: [] };
  }

  // Normalize URL — prepend https:// if no scheme present
  let url = website.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  // --- Fetch HTML via page_reader (hard 5s timeout) ---
  let html = "";
  try {
    const client = await getAIClient();
    const fetchPromise = client.functions.invoke("page_reader", { url });
    const timeoutPromise = new Promise<never>((_, reject) => {
      const t = setTimeout(
        () => reject(new Error("page_reader timeout (5s)")),
        5000
      );
      // Allow Node's event loop to exit even if the timer is pending
      if (typeof t.unref === "function") t.unref();
    });
    const pageResult = (await Promise.race([
      fetchPromise,
      timeoutPromise,
    ])) as { data?: { html?: string } } | undefined;
    html = pageResult?.data?.html || "";
  } catch (e) {
    console.warn(
      "[tech-stack-detector] page_reader failed:",
      (e as Error).message
    );
    return { detectedAt, rawSignatures: [] };
  }

  if (!html) {
    return { detectedAt, rawSignatures: [] };
  }

  const rawSignatures: string[] = [];
  const result: TechStackResult = {
    detectedAt,
    rawSignatures,
  };

  // --- 1. CMS detection (first hit wins; Shopify checked first) ---
  let cms: TechStackResult["cms"] = "unknown";
  for (const key of Object.keys(CMS_SIGNATURES)) {
    const hits = findMatches(html, CMS_SIGNATURES[key]);
    if (hits.length > 0) {
      rawSignatures.push(`cms:${key} (${hits.join(",")})`);
      cms = key as TechStackResult["cms"];
      break;
    }
  }
  result.cms = cms;

  // --- 2. JS framework detection (independent of CMS) ---
  // Next.js is checked even when CMS = wordpress because some WP
  // headless front-ends ship Next bundles alongside WP REST.
  const nextHits = findMatches(html, CMS_SIGNATURES.custom_next);
  const nuxtHits = findMatches(html, CMS_SIGNATURES.custom_nuxt);
  const angularHits = findMatches(html, CMS_SIGNATURES.custom_angular);

  if (nextHits.length) {
    result.framework = "next";
    rawSignatures.push(`framework:next (${nextHits.join(",")})`);
  } else if (nuxtHits.length) {
    result.framework = "nuxt";
    rawSignatures.push(`framework:nuxt (${nuxtHits.join(",")})`);
  } else if (angularHits.length) {
    result.framework = "angular";
    rawSignatures.push(`framework:angular (${angularHits.join(",")})`);
  } else if (/data-reactroot|data-reactid|react-dom/i.test(html)) {
    result.framework = "react";
    rawSignatures.push("framework:react (data-react*|react-dom)");
  } else if (/__vue__|vue\.runtime|\sv-if=|\sv-show=/i.test(html)) {
    result.framework = "vue";
    rawSignatures.push("framework:vue (vue runtime|v-directives)");
  }

  // --- 3. WordPress page builder detection ---
  if (cms === "wordpress") {
    let builder: TechStackResult["builder"] | undefined;
    for (const key of Object.keys(BUILDER_SIGNATURES)) {
      const hits = findMatches(html, BUILDER_SIGNATURES[key]);
      if (hits.length > 0) {
        rawSignatures.push(`builder:${key} (${hits.join(",")})`);
        builder = key as TechStackResult["builder"];
        break;
      }
    }
    if (!builder) {
      builder = "native";
      rawSignatures.push("builder:native (no plugin builder detected)");
    }
    result.builder = builder;
  }

  // --- 4. E-commerce platform detection ---
  let ecommerce: TechStackResult["ecommerce"] | undefined;
  if (cms === "shopify") {
    // Shopify is both CMS and e-commerce — record once
    ecommerce = "shopify";
    rawSignatures.push("ecommerce:shopify (matches CMS)");
  } else {
    for (const key of Object.keys(ECOMMERCE_SIGNATURES)) {
      const hits = findMatches(html, ECOMMERCE_SIGNATURES[key]);
      if (hits.length > 0) {
        rawSignatures.push(`ecommerce:${key} (${hits.join(",")})`);
        ecommerce = key as TechStackResult["ecommerce"];
        break;
      }
    }
  }
  if (ecommerce) {
    result.ecommerce = ecommerce;
  }

  // --- 5. Theme detection (WordPress primarily) ---
  const themeName = detectThemeName(html, rawSignatures);
  if (themeName) {
    result.themeName = themeName;
    result.isFreeTheme = looksFreeTheme(themeName);
    if (result.isFreeTheme) {
      rawSignatures.push(`theme:free (${themeName})`);
    }
  }

  // --- 6. DIY vs. Pro site inference ---
  // DIY = any free website builder (Wix/Squarespace/Webnode/Jimdo/Carrd),
  //       OR WordPress + a free default theme, OR WordPress + Elementor
  //       (the most common drag-and-drop DIY combo).
  // Pro  = Shopify / BigCommerce / Magento / VTEX / PrestaShop (paid SaaS
  //       e-commerce), OR a custom Next/Nuxt/Angular/Webflow build.
  const isFreeBuilder =
    cms === "wix" ||
    cms === "squarespace" ||
    cms === "webnode" ||
    cms === "jimdo" ||
    cms === "carrd";

  if (isFreeBuilder) {
    result.isDiySite = true;
  } else if (cms === "wordpress") {
    result.isDiySite =
      result.isFreeTheme === true || result.builder === "elementor";
  }

  const proEcommerce =
    ecommerce === "shopify" ||
    ecommerce === "bigcommerce" ||
    ecommerce === "magento" ||
    ecommerce === "vtex" ||
    ecommerce === "prestashop";

  if (
    cms === "custom_next" ||
    cms === "custom_nuxt" ||
    cms === "custom_angular" ||
    cms === "webflow" ||
    proEcommerce
  ) {
    result.isProSite = true;
  }

  return result;
}
