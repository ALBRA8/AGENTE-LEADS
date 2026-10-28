// ============================================================
// src/agent/providers/clonakit/investigation-provider.ts
// Port of ClonaKit's investigation capability.
//
// Investigates a lead's website to understand:
//   - What tech stack it uses (frameworks, libraries, CMS)
//   - What capabilities it has (forms, payments, booking, etc.)
//   - How it's built (static, SPA, SSR, etc.)
//
// Uses two strategies:
//   1. If REA (Reverse Engineering Anything) is available → full investigation
//   2. If not → fallback to page_reader (z-ai SDK) + HTML analysis
//
// The investigation result becomes EvidenceRecord in the lead's record,
// feeding the Intelligence layer for commercial fit analysis.
// ============================================================

import type { EvidenceRecord } from "../../core/evidence.js";
import { found, inferred, notFound } from "../../core/evidence.js";
import { assertPublicUrl } from "../../core/ssrf_guard.js";

export interface InvestigationResult {
  techStack: {
    cms?: string;
    framework?: string;
    builder?: string;
    ecommerce?: string;
    analytics?: string[];
    plugins?: string[];
    isStaticHTML?: boolean;
    isWordPress?: boolean;
    isShopify?: boolean;
    isCustomReact?: boolean;
    isWix?: boolean;
    isWebflow?: boolean;
    isSquarespace?: boolean;
  };
  capabilities: {
    hasContactForm?: boolean;
    hasOnlineBooking?: boolean;
    hasPaymentGateway?: boolean;
    hasLiveChat?: boolean;
    hasNewsletterSignup?: boolean;
    hasSocialLinks?: string[];
    hasStructuredData?: boolean;
    isMobileResponsive?: boolean;
    hasSSL?: boolean;
    pageLoadSpeed?: "fast" | "medium" | "slow";
  };
  contentAnalysis: {
    language?: string;
    hasBlog?: boolean;
    hasFAQ?: boolean;
    hasTestimonials?: boolean;
    hasPricingPage?: boolean;
    lastUpdatedEstimate?: string;
    wordCount?: number;
  };
  commercialFit: {
    digitalMaturity: "low" | "medium" | "high";
    painPoints: string[];
    opportunities: string[];
  };
  rawHtml?: string;
  investigationDate: string;
}

export interface InvestigationInput {
  url: string;
  leadName: string;
  leadCategory?: string;
}

/**
 * InvestigationProvider — investigates a lead's website.
 * Uses ClonaKit's approach (tech stack detection + capability analysis)
 * adapted for the AGENTE-LEADS pipeline.
 */
export class ClonaKitInvestigationProvider {
  name = "ClonaKitInvestigation";

  async isConfigured(): Promise<boolean> {
    return true; // always available — uses page_reader or direct fetch
  }

  async investigate(input: InvestigationInput): Promise<InvestigationResult> {
    // SSRF guard
    const urlCheck = assertPublicUrl(input.url);
    if (!urlCheck.ok) {
      return this.emptyResult(`SSRF rejected: ${urlCheck.error.message}`);
    }

    let html = "";
    let publishedTime: string | undefined;

    // Strategy 1: Try direct fetch (the page_reader SDK is in the dashboard project)
    // For the bot project, we use direct fetch with proper user agent
    try {
      const res = await fetch(input.url, {
        headers: { "User-Agent": "AGENTE-LEADS-Investigation/1.0 (ClonaKit-compatible)" },
        signal: AbortSignal.timeout(15_000),
        redirect: "follow",
      });
      if (res.ok) {
        html = await res.text();
      }
    } catch (e: any) {
      console.warn("[ClonaKitInvestigation] fetch failed:", e.message);
    }

    // Strategy 2: If no HTML from page_reader, try direct fetch
    if (!html) {
      try {
        const res = await fetch(input.url, {
          headers: { "User-Agent": "AGENTE-LEADS-Investigation/1.0" },
          signal: AbortSignal.timeout(15_000),
          redirect: "follow",
        });
        if (res.ok) {
          html = await res.text();
        }
      } catch (e: any) {
        console.warn("[ClonaKitInvestigation] direct fetch failed:", e.message);
        return this.emptyResult(`Could not fetch ${input.url}: ${e.message}`);
      }
    }

    if (!html) {
      return this.emptyResult("No HTML content retrieved");
    }

    // Analyze the HTML
    const techStack = this.detectTechStack(html, input.url);
    const capabilities = this.detectCapabilities(html, input.url);
    const contentAnalysis = this.analyzeContent(html, publishedTime);
    const commercialFit = this.analyzeCommercialFit(techStack, capabilities);

    return {
      techStack,
      capabilities,
      contentAnalysis,
      commercialFit,
      rawHtml: html.substring(0, 5000), // keep first 5K for debugging
      investigationDate: new Date().toISOString(),
    };
  }

  /**
   * Convert investigation result to EvidenceRecord[] for the lead.
   * Each finding becomes an evidence record with FOUND/NOT_FOUND status.
   */
  toEvidence(result: InvestigationResult, sourceUrl: string): EvidenceRecord[] {
    const evidence: EvidenceRecord[] = [];
    const ts = result.techStack;
    const caps = result.capabilities;
    const fit = result.commercialFit;

    // Tech stack evidence
    if (ts.cms) {
      evidence.push(found("tech_cms", ts.cms, this.name, `CMS detected: ${ts.cms}`, "high"));
    } else {
      evidence.push(notFound("tech_cms", this.name, "No CMS detected"));
    }

    if (ts.isWordPress) {
      evidence.push(found("tech_wordpress", "true", this.name, "WordPress detected (wp-content, wp-includes)", "high"));
    }
    if (ts.isShopify) {
      evidence.push(found("tech_shopify", "true", this.name, "Shopify detected (cdn.shopify.com)", "high"));
    }
    if (ts.isWix) {
      evidence.push(found("tech_wix", "true", this.name, "Wix detected", "high"));
    }
    if (ts.isWebflow) {
      evidence.push(found("tech_webflow", "true", this.name, "Webflow detected", "high"));
    }
    if (ts.isCustomReact) {
      evidence.push(found("tech_custom_react", "true", this.name, "Custom React/Next.js detected", "high"));
    }

    // Capabilities evidence
    if (caps.hasOnlineBooking) {
      evidence.push(found("capability_booking", "true", this.name, "Online booking system detected", "high"));
    } else {
      evidence.push(notFound("capability_booking", this.name, "No online booking detected"));
    }

    if (caps.hasPaymentGateway) {
      evidence.push(found("capability_payments", "true", this.name, "Payment gateway detected", "medium"));
    }

    if (caps.hasLiveChat) {
      evidence.push(found("capability_livechat", "true", this.name, "Live chat detected", "medium"));
    }

    if (caps.isMobileResponsive === false) {
      evidence.push(found("capability_not_responsive", "true", this.name, "Website is NOT mobile responsive", "high"));
    }

    if (caps.hasSSL === false) {
      evidence.push(found("capability_no_ssl", "true", this.name, "Website has NO SSL (http://)", "high"));
    }

    // Commercial fit (inferred)
    evidence.push(inferred(
      "digital_maturity",
      fit.digitalMaturity,
      `Digital maturity assessed as ${fit.digitalMaturity} based on tech stack and capabilities`,
      ["tech_stack", "capabilities"],
    ));

    for (const pain of fit.painPoints) {
      evidence.push(inferred(
        "pain_point",
        pain,
        `Pain point identified: ${pain}`,
        ["tech_stack", "capabilities"],
      ));
    }

    for (const opp of fit.opportunities) {
      evidence.push(inferred(
        "opportunity",
        opp,
        `Opportunity identified: ${opp}`,
        ["tech_stack", "capabilities"],
      ));
    }

    return evidence;
  }

  // ── Tech stack detection (ported from ClonaKit's approach) ──────

  private detectTechStack(html: string, url: string): InvestigationResult["techStack"] {
    const lower = html.toLowerCase();
    const result: InvestigationResult["techStack"] = {
      analytics: [],
      plugins: [],
    };

    // WordPress
    if (lower.includes("wp-content") || lower.includes("wp-includes") || lower.includes('name="generator" content="wordpress')) {
      result.isWordPress = true;
      result.cms = "wordpress";

      // WordPress page builders
      if (lower.includes("elementor")) result.builder = "elementor";
      else if (lower.includes("divi")) result.builder = "divi";
      else if (lower.includes("wpbakery") || lower.includes("vc_")) result.builder = "wpbakery";
      else if (lower.includes("beaver-builder") || lower.includes("fl-builder")) result.builder = "beaver_builder";
      else if (lower.includes("brizy")) result.builder = "brizy";
      else if (lower.includes("bricks-")) result.builder = "bricks";

      // WordPress e-commerce
      if (lower.includes("woocommerce")) result.ecommerce = "woocommerce";

      // WordPress plugins
      if (lower.includes("yoast")) result.plugins!.push("yoast-seo");
      if (lower.includes("contact-form-7") || lower.includes("wpcf7")) result.plugins!.push("contact-form-7");
      if (lower.includes("wpml")) result.plugins!.push("wpml");
    }

    // Shopify
    if (lower.includes("cdn.shopify.com") || lower.includes("shopify.theme")) {
      result.isShopify = true;
      result.cms = "shopify";
      result.ecommerce = "shopify";
    }

    // Wix
    if (lower.includes("wix.com") || lower.includes("static.wixstatic.com") || lower.includes("x-wix")) {
      result.isWix = true;
      result.cms = "wix";
    }

    // Squarespace
    if (lower.includes("squarespace.com") || lower.includes("static1.squarespace.com")) {
      result.isSquarespace = true;
      result.cms = "squarespace";
    }

    // Webflow
    if (lower.includes("webflow.com") || lower.includes("wf-") || lower.includes("data-wf-")) {
      result.isWebflow = true;
      result.cms = "webflow";
    }

    // Custom React/Next.js
    if (lower.includes("__next_data__") || lower.includes("_next/static") || lower.includes("__next_loaded_chunks")) {
      result.isCustomReact = true;
      result.framework = "next.js";
    } else if (lower.includes("__nuxt__") || lower.includes("_nuxt/")) {
      result.isCustomReact = true;
      result.framework = "nuxt";
    } else if (lower.includes("ng-version") || lower.includes("_ng")) {
      result.isCustomReact = true;
      result.framework = "angular";
    }

    // BigCommerce
    if (lower.includes("bigcommerce.com") || lower.includes("cdn11.bigcommerce.com")) {
      result.ecommerce = "bigcommerce";
    }

    // Magento
    if (lower.includes("mage/") || lower.includes("magento")) {
      result.ecommerce = "magento";
    }

    // Analytics
    if (lower.includes("google-analytics.com") || lower.includes("gtag(")) result.analytics!.push("google-analytics");
    if (lower.includes("facebook.net") || lower.includes("fbq(")) result.analytics!.push("facebook-pixel");
    if (lower.includes("hotjar")) result.analytics!.push("hotjar");
    if (lower.includes("clarity.ms")) result.analytics!.push("microsoft-clarity");
    if (lower.includes("tag-manager")) result.analytics!.push("google-tag-manager");

    // Static HTML (no CMS detected)
    if (!result.cms && !result.framework) {
      result.isStaticHTML = true;
    }

    return result;
  }

  // ── Capability detection ─────────────────────────────────────────

  private detectCapabilities(html: string, url: string): InvestigationResult["capabilities"] {
    const lower = html.toLowerCase();
    const result: InvestigationResult["capabilities"] = {
      hasSocialLinks: [],
    };

    // SSL
    result.hasSSL = url.startsWith("https://");

    // Mobile responsive
    result.isMobileResponsive = lower.includes('name="viewport"') &&
      lower.includes("width=device-width");

    // Contact form
    result.hasContactForm = lower.includes("<form") && (
      lower.includes("contact") || lower.includes("mensaje") || lower.includes("consulta")
    );

    // Online booking (Calendly, Bookly, Acuity, etc.)
    result.hasOnlineBooking =
      lower.includes("calendly.com") ||
      lower.includes("acuityscheduling") ||
      lower.includes("bookly") ||
      lower.includes("ameliabooking") ||
      lower.includes("setmore.com") ||
      lower.includes('class="booking"') ||
      lower.includes("reservar") || lower.includes("agendar") || lower.includes("book-appointment");

    // Payment gateway
    result.hasPaymentGateway =
      lower.includes("stripe.com") ||
      lower.includes("paypal.com") ||
      lower.includes("mercadopago") ||
      lower.includes("checkout.com") ||
      lower.includes("shopify-checkout");

    // Live chat
    result.hasLiveChat =
      lower.includes("intercom") ||
      lower.includes("tawk.to") ||
      lower.includes("crisp.chat") ||
      lower.includes("drift.com") ||
      lower.includes("hubspot.com/live-chat") ||
      lower.includes("olark.com");

    // Newsletter signup
    result.hasNewsletterSignup =
      lower.includes("mailchimp") ||
      lower.includes("newsletter") ||
      lower.includes("suscrib") ||
      lower.includes("subscribe");

    // Social links
    const socialPatterns: Array<[string, RegExp]> = [
      ["instagram", /instagram\.com\/([^"'\s]+)/gi],
      ["facebook", /facebook\.com\/([^"'\s]+)/gi],
      ["linkedin", /linkedin\.com\/([^"'\s]+)/gi],
      ["twitter", /(?:twitter|x)\.com\/([^"'\s]+)/gi],
      ["tiktok", /tiktok\.com\/@([^"'\s]+)/gi],
      ["youtube", /youtube\.com\/(@|channel\/|c\/)?([^"'\s]+)/gi],
    ];
    for (const [platform, regex] of socialPatterns) {
      const matches = html.match(regex);
      if (matches && matches.length > 0) {
        if (result.hasSocialLinks) result.hasSocialLinks.push(platform);;
      }
    }

    // Structured data (Schema.org JSON-LD)
    result.hasStructuredData = lower.includes('type="application/ld+json"');

    return result;
  }

  // ── Content analysis ─────────────────────────────────────────────

  private analyzeContent(html: string, publishedTime?: string): InvestigationResult["contentAnalysis"] {
    const lower = html.toLowerCase();
    const result: InvestigationResult["contentAnalysis"] = {};

    // Language
    const langMatch = html.match(/<html[^>]*lang=["']([^"']+)/i);
    result.language = langMatch ? langMatch[1] : undefined;

    // Blog
    result.hasBlog = lower.includes("/blog") || lower.includes("article") || lower.includes("post-");

    // FAQ
    result.hasFAQ = lower.includes("faq") || lower.includes("pregunta") && lower.includes("respuesta");

    // Testimonials
    result.hasTestimonials = lower.includes("testimonial") || lower.includes("reseña") || lower.includes("opinion");

    // Pricing
    result.hasPricingPage = lower.includes("pricing") || lower.includes("precio") || lower.includes("plan") && lower.includes("$");

    // Last updated (from copyright year)
    const copyrightMatch = html.match(/©\s*(\d{4})/i);
    if (copyrightMatch) {
      const year = parseInt(copyrightMatch[1]);
      if (year > 2000 && year <= new Date().getFullYear()) {
        result.lastUpdatedEstimate = `Copyright ${year}`;
      }
    }

    if (publishedTime) {
      result.lastUpdatedEstimate = publishedTime;
    }

    // Word count (rough)
    const text = html.replace(/<[^>]+>/g, " ").trim();
    result.wordCount = text.split(/\s+/).length;

    return result;
  }

  // ── Commercial fit analysis ──────────────────────────────────────

  private analyzeCommercialFit(
    techStack: InvestigationResult["techStack"],
    capabilities: InvestigationResult["capabilities"]
  ): InvestigationResult["commercialFit"] {
    const painPoints: string[] = [];
    const opportunities: string[] = [];

    // Digital maturity
    let maturity: "low" | "medium" | "high" = "medium";

    if (techStack.isWordPress && (techStack.builder === "elementor" || !techStack.builder)) {
      maturity = "low";
      painPoints.push("WordPress sin builder profesional o con Elementor básico");
      opportunities.push("Sitio DIY — alta propensión a comprar servicios de diseño profesional");
    }

    if (techStack.isWix || techStack.isSquarespace) {
      maturity = "low";
      painPoints.push("Website builder gratuito — limitaciones de personalización");
      opportunities.push("Negocio listo para migrar a solución profesional");
    }

    if (techStack.isCustomReact) {
      maturity = "high";
      opportunities.push("Sitio profesional custom — ya invierten en digital");
    }

    if (techStack.isShopify) {
      maturity = "high";
      opportunities.push("E-commerce maduro — ya pagan por infraestructura digital");
    }

    if (capabilities.isMobileResponsive === false) {
      painPoints.push("Sitio NO responsivo en móvil — pierde tráfico móvil");
    }

    if (capabilities.hasSSL === false) {
      painPoints.push("Sin certificado SSL — Google penaliza en SEO");
    }

    if (capabilities.hasOnlineBooking === false) {
      painPoints.push("Sin sistema de reservas online — pierde citas fuera de horario");
    }

    if (capabilities.hasStructuredData === false) {
      painPoints.push("Sin datos estructurados (Schema.org) — SEO local débil");
    }

    if (!capabilities.hasLiveChat) {
      opportunities.push("Sin live chat — oportunidad de añadir atención automatizada");
    }

    const socialCount = capabilities.hasSocialLinks?.length ?? 0;
    if (socialCount > 0 && socialCount < 2) {
      painPoints.push(`Solo ${socialCount} red(es) social(es) — presencia digital limitada`);
    }

    return {
      digitalMaturity: maturity,
      painPoints,
      opportunities,
    };
  }

  private emptyResult(reason: string): InvestigationResult {
    return {
      techStack: { analytics: [], plugins: [] },
      capabilities: { hasSocialLinks: [] },
      contentAnalysis: {},
      commercialFit: { digitalMaturity: "low", painPoints: [], opportunities: [] },
      investigationDate: new Date().toISOString(),
    };
  }
}
