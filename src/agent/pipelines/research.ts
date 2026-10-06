// ============================================================
// src/agent/pipelines/research.ts
// P0.4 — Research pipeline.
//
// Goal: investigate a discovered candidate and turn it into a Lead
// with evidence (P0.6). The scraper is treated as INFRASTRUCTURE
// (data extraction), NOT as intelligence. The output is converted
// into structured fields with provenance.
//
// Input:  CandidateLead
// Output: Lead (research_state = "RESEARCHED") with EvidenceRecord[]
//
// Each important field (website, email, phone, instagram, linkedin)
// gets an EvidenceRecord that records:
//   - value
//   - status: FOUND | NOT_FOUND | CONFIRMED_ABSENT | INFERRED
//   - source (provider name)
//   - retrieved_at
//   - confidence
//   - evidence (free-form supporting text)
// ============================================================

import type { ResearchProvider, ScrapingProvider } from "../providers/types.js";
import type { CandidateLead, Lead } from "../core/lead.js";
import type { EvidenceRecord } from "../core/evidence.js";
import { found, notFound, inferred } from "../core/evidence.js";
import { buildDedupSignature } from "../core/lead.js";
import type { ExecutionRecorder } from "../core/execution.js";

export interface ResearchInput {
  candidate: CandidateLead;
  /** Hint: which fields to look for */
  look_for?: Array<"website" | "instagram" | "linkedin" | "email" | "phone" | "location" | "activity" | "services">;
}

export interface ResearchOutput {
  lead: Lead;
}

const DEFAULT_LOOK_FOR = ["website", "instagram", "linkedin", "email", "phone", "location"] as const;

/**
 * Research a candidate: combine research provider data + scraping provider data
 * into a structured Lead with evidence for each important field.
 */
export async function runResearch(
  researchProvider: ResearchProvider | null,
  scrapingProvider: ScrapingProvider | null,
  input: ResearchInput,
  trace?: ExecutionRecorder
): Promise<ResearchOutput> {
  const c = input.candidate;
  const look_for = input.look_for ?? Array.from(DEFAULT_LOOK_FOR);
  const evidence: EvidenceRecord[] = [];
  const sources: string[] = [c.source];

  // Aggregate raw data from research provider (Google search etc.)
  let rawEmails: string[] = [];
  let rawPhones: string[] = [];
  let rawWebsites: string[] = [];
  let rawSocials: string[] = [];
  let rawText = "";

  if (researchProvider && (await researchProvider.isConfigured().catch(() => false))) {
    const end = trace?.start(`research.${researchProvider.name}`, {
      provider: researchProvider.name,
      intent: `research candidate: ${c.name}`,
    });
    try {
      const result = await researchProvider.research({ candidate: c, look_for });
      if (result.ok && result.data) {
        rawEmails = result.data.emails ?? [];
        rawPhones = result.data.phones ?? [];
        rawWebsites = result.data.websites ?? [];
        rawSocials = result.data.social_links ?? [];
        rawText = result.data.raw_text ?? "";
        sources.push(researchProvider.name);
        end?.({ output: `${rawEmails.length} emails, ${rawWebsites.length} websites, ${rawSocials.length} socials` });
      } else if (result.error) {
        end?.({ error: result.error });
      }
    } catch (e) {
      end?.({ error: e });
    }
  } else {
    trace?.skip(`research.none`, "research provider not configured");
  }

  // Add data from scraping provider (only if the candidate has a URL)
  if (scrapingProvider && (await scrapingProvider.isConfigured().catch(() => false)) && c.url) {
    const end = trace?.start(`research.scrape.${scrapingProvider.name}`, {
      provider: scrapingProvider.name,
      intent: `scrape candidate URL: ${c.url}`,
    });
    try {
      const result = await scrapingProvider.scrape({ url: c.url, network_idle: true });
      if (result.ok && result.data) {
        if (result.data.emails_found?.length) rawEmails.push(...result.data.emails_found);
        if (result.data.social_links?.length) rawSocials.push(...result.data.social_links);
        if (result.data.text) rawText = rawText ? `${rawText}\n\n${result.data.text}` : result.data.text;
        sources.push(scrapingProvider.name);
        end?.({ output: `scrape OK, ${result.data.emails_found?.length ?? 0} emails found` });
      } else if (result.error) {
        end?.({ error: result.error });
      }
    } catch (e) {
      end?.({ error: e });
    }
  }

  // Deduplicate raw signals
  rawEmails = [...new Set(rawEmails)];
  rawPhones = [...new Set(rawPhones)];
  rawWebsites = [...new Set(rawWebsites)];
  rawSocials = [...new Set(rawSocials)];

  // Build evidence per field
  // WEBSITE
  if (look_for.includes("website")) {
    const candidateWebsite = rawWebsites.find((w) => !w.includes(c.platform ?? "instagram") && !w.includes("instagram.com"));
    if (candidateWebsite) {
      evidence.push(found("website", candidateWebsite, sources.join(","), `Found in ${sources.join(", ")}`, "medium"));
    } else {
      evidence.push(notFound("website", sources.join(","), "Searched in research + scraping — value did not appear"));
    }
  }

  // EMAIL
  if (look_for.includes("email")) {
    if (rawEmails.length > 0) {
      const email = rawEmails[0]; // first found
      evidence.push(found("email", email, sources.join(","), `Found via ${sources.join(", ")}: also saw ${rawEmails.length - 1} others`, "medium"));
    } else {
      evidence.push(notFound("email", sources.join(","), "Searched in research + scraping — value did not appear"));
    }
  }

  // PHONE
  if (look_for.includes("phone")) {
    if (rawPhones.length > 0) {
      evidence.push(found("phone", rawPhones[0], sources.join(","), `Found via ${sources.join(", ")}`, "low"));
    } else {
      evidence.push(notFound("phone", sources.join(","), "Searched — value did not appear"));
    }
  }

  // INSTAGRAM
  if (look_for.includes("instagram")) {
    if (c.platform === "instagram" && c.username) {
      evidence.push(found("instagram", c.username, c.source, `Discovered via ${c.source}`, "high"));
    } else {
      const igLink = rawSocials.find((s) => s.includes("instagram.com"));
      if (igLink) {
        evidence.push(found("instagram", igLink, sources.join(","), "Found in scraped socials", "medium"));
      } else {
        evidence.push(notFound("instagram", sources.join(","), "Searched — value did not appear"));
      }
    }
  }

  // LINKEDIN
  if (look_for.includes("linkedin")) {
    const liLink = rawSocials.find((s) => s.includes("linkedin.com"));
    if (liLink) {
      evidence.push(found("linkedin", liLink, sources.join(","), "Found in scraped socials", "medium"));
    } else {
      evidence.push(notFound("linkedin", sources.join(","), "Searched — value did not appear"));
    }
  }

  // LOCATION — usually inferred from candidate or raw text
  if (look_for.includes("location")) {
    if (c.location) {
      evidence.push(found("location", c.location, c.source, `From candidate's discovered location`, "high"));
    } else if (rawText) {
      // Very simple heuristic: look for "Medellín" / "Bogotá" / etc. in text
      const cities = ["Medellín", "Bogotá", "Cali", "Barranquilla", "Cartagena", "Bucaramanga"];
      const match = cities.find((city) => rawText.includes(city));
      if (match) {
        evidence.push(inferred("location", match, `Found "${match}" mentioned in scraped text`, [sources.join(",")]));
      } else {
        evidence.push(notFound("location", sources.join(","), "Searched in candidate + raw text — value did not appear"));
      }
    } else {
      evidence.push(notFound("location", sources.join(","), "No location data available"));
    }
  }

  // Build the structured Lead
  const websiteEvidence = evidence.find((e) => e.field === "website" && e.status === "FOUND");
  const emailEvidence = evidence.find((e) => e.field === "email" && e.status === "FOUND");
  const phoneEvidence = evidence.find((e) => e.field === "phone" && e.status === "FOUND");

  const lead: Lead = {
    name: c.name,
    username: c.username,
    platform: c.platform,
    url: c.url,
    website: websiteEvidence?.value as string | undefined,
    email: emailEvidence?.value as string | undefined,
    phone: phoneEvidence?.value as string | undefined,
    location: c.location,
    category: c.category,
    niche: c.niche,
    description: c.description,
    sources,
    discovered_at: c.discovered_at,
    evidence,
    validation: {}, // filled in validation.ts
    research_state: "RESEARCHED",
    dedup_signature: undefined, // filled in dedup.ts
  };

  // Compute dedup signature now
  lead.dedup_signature = buildDedupSignature(lead);

  return { lead };
}
