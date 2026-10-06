// ============================================================
// src/app/api/search/route.ts — Run a search via Lead Source Adapter
// Pipeline:
//   1. (optional) Multi-query expansion via LLM
//   2. Lead source adapter fetch (per query if expanded)
//   3. Persist prospects with dedup
//   4. Tech stack detection (layer 6)
//   5. Website freshness check (layer 7)
//   6. AI qualification 5 layers (with enriched context)
//   7. Look-alike score (from closed-loop learning)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server";
import { db } from "@/lib/db";
import { getLeadSources } from "@/lib/leads";
import { qualifyProspect } from "@/lib/ai/qualification";
import { detectTechStack } from "@/lib/leads/tech-stack-detector";
import { checkFreshness } from "@/lib/leads/freshness-checker";
import { expandQueries } from "@/lib/leads/query-expander";
import { computeLookAlikeScore } from "@/lib/ai/closed-loop";
import { scoreLead } from "@/lib/ai/scoring";
import { generateIntelligence } from "@/lib/ai/intelligence";

// Allow up to 5 minutes (expanded searches can take a while)
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const user = await requireUser();
  const body = await req.json();
  const {
    offerId,
    city,
    country,
    category,
    keywords,
    radius,
    sourceAdapter,
    expandQueries: shouldExpand,
  } = body;

  if (!city) {
    return NextResponse.json({ error: "city is required" }, { status: 400 });
  }

  const integration = await db.integration.findUnique({
    where: { userId: user.id },
  });
  const adapters = getLeadSources(integration || null);
  const adapter =
    adapters.find((a) => a.name === sourceAdapter) || adapters[0];

  // Fetch offer for qualification context
  let offer: any = null;
  if (offerId) {
    offer = await db.offer.findFirst({
      where: { id: offerId, userId: user.id },
    });
  }
  if (!offer) {
    offer = await db.offer.findFirst({
      where: { userId: user.id, isActive: true },
      orderBy: { createdAt: "desc" },
    });
  }

  // Create SearchJob
  const job = await db.searchJob.create({
    data: {
      userId: user.id,
      offerId: offer?.id,
      city,
      country: country || null,
      category: category || null,
      keywords: keywords || null,
      radius: radius || null,
      sourceAdapter: adapter.name,
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    // ── STEP 1: Multi-query expansion ──────────────────────────
    let expanded: string[] = [`${category || "negocio"} en ${city}, ${country || ""} ${keywords || ""}`.trim()];
    let expansionId: string | null = null;
    if (shouldExpand && offer) {
      try {
        const expansion = await expandQueries({
          offerDescription: offer.description,
          targetNiches: offer.targetNiches || undefined,
          city,
          country,
          category,
          keywords,
        });
        expanded = expansion.expanded.map((e) => e.query);
        // Save the expansion for audit
        const qe = await db.queryExpansion.create({
          data: {
            searchJobId: job.id,
            originalQuery: expansion.original,
            expandedQueries: JSON.stringify(expanded),
          },
        });
        expansionId = qe.id;
      } catch (e: any) {
        console.warn("[search] query expansion failed:", e.message);
      }
    }

    // ── STEP 2: Run adapter for each (expanded) query, dedup results ──
    const allRawProspects: any[] = [];
    const seen = new Set<string>();
    for (const q of expanded.slice(0, 25)) {
      // For expanded queries we pass keywords=q so the adapter searches for it
      const adapterInput = shouldExpand
        ? { city, country, category, keywords: q, radius, offerDescription: offer?.description }
        : { city, country, category, keywords, radius, offerDescription: offer?.description };
      try {
        const results = await adapter.search(adapterInput);
        for (const r of results) {
          const key = `${r.name}|${r.city}`;
          if (seen.has(key)) continue;
          seen.add(key);
          allRawProspects.push(r);
        }
      } catch (e: any) {
        console.warn(`[search] adapter failed for query "${q}":`, e.message);
      }
      if (!shouldExpand) break; // single-query mode
    }

    // ── STEP 3: Persist prospects (dedup by name+city in DB) ────
    let tierA = 0,
      tierB = 0,
      tierC = 0,
      tierF = 0;

    const savedProspectIds: string[] = [];
    const newSaved: any[] = []; // track new ones that need enrichment

    for (const rp of allRawProspects) {
      const existing = await db.prospect.findFirst({
        where: { userId: user.id, name: rp.name, city: rp.city },
      });
      if (existing) {
        savedProspectIds.push(existing.id);
        if (existing.tier === "TIER_A") tierA++;
        else if (existing.tier === "TIER_B") tierB++;
        else if (existing.tier === "TIER_C") tierC++;
        else if (existing.tier === "TIER_F") tierF++;
        continue;
      }

      const created = await db.prospect.create({
        data: {
          userId: user.id,
          offerId: offer?.id,
          searchJobId: job.id,
          name: rp.name,
          category: rp.category || null,
          city: rp.city || city,
          country: rp.country || country || null,
          address: rp.address || null,
          website: rp.website || null,
          phone: rp.phone || null,
          email: rp.email || null,
          socialLinks: rp.socialLinks ? JSON.stringify(rp.socialLinks) : null,
          description: rp.description || null,
          source: rp.source,
          sourceUrl: rp.sourceUrl || null,
          status: "NEW",
          tier: "PENDING",
        },
      });
      savedProspectIds.push(created.id);
      newSaved.push(created);
    }

    await db.searchJob.update({
      where: { id: job.id },
      data: {
        status: "enriching",
        foundCount: savedProspectIds.length,
      },
    });

    // ── STEPS 4-5: Tech stack + freshness checks (parallel batches of 3) ──
    // Only for NEW prospects with websites
    const withWebsites = newSaved.filter((p) => p.website);
    const batches: any[][] = [];
    for (let i = 0; i < withWebsites.length; i += 3) {
      batches.push(withWebsites.slice(i, i + 3));
    }
    for (const batch of batches) {
      await Promise.all(
        batch.map(async (p) => {
          try {
            const [tech, fresh] = await Promise.all([
              detectTechStack(p.website),
              checkFreshness(p.website),
            ]);
            await db.prospect.update({
              where: { id: p.id },
              data: {
                techStack: JSON.stringify(tech),
                freshnessData: JSON.stringify(fresh),
              },
            });
          } catch (e: any) {
            console.warn(`[search] enrichment failed for ${p.name}:`, e.message);
          }
        })
      );
    }

    // ── STEP 6: AI qualification with enriched context ─────────
    const offerCtx = offer
      ? {
          name: offer.name,
          description: offer.description,
          priceRange: offer.priceRange,
          idealCustomer: offer.idealCustomer,
          targetNiches: offer.targetNiches,
          sector: offer.sector,
        }
      : null;

    if (offerCtx) {
      // Reload prospects to get the enrichment data we just saved
      const allToQualify = await db.prospect.findMany({
        where: { id: { in: savedProspectIds } },
      });

      const qualBatches: any[][] = [];
      for (let i = 0; i < allToQualify.length; i += 3) {
        qualBatches.push(allToQualify.slice(i, i + 3));
      }
      for (const batch of qualBatches) {
        const results = await Promise.all(
          batch.map(async (p) => {
            try {
              // Parse enrichment data
              let tech: any = null;
              let fresh: any = null;
              try { tech = p.techStack ? JSON.parse(p.techStack) : null; } catch {}
              try { fresh = p.freshnessData ? JSON.parse(p.freshnessData) : null; } catch {}

              const q = await qualifyProspect(offerCtx, {
                name: p.name,
                category: p.category,
                city: p.city,
                address: p.address,
                website: p.website,
                phone: p.phone,
                email: p.email,
                socialLinks: p.socialLinks,
                description: p.description,
                techStack: tech,
                freshnessData: fresh,
              });
              return { p, q };
            } catch (e: any) {
              console.error("[search] qualification failed", e.message);
              return null;
            }
          })
        );
        for (const r of results) {
          if (!r) continue;
          // ── STEP 7: Look-alike score ──────────────────────────
          let lookAlike: number | null = null;
          try {
            lookAlike = await computeLookAlikeScore(user.id, {
              tier: r.q.tier,
              nicheFit: r.q.nicheFit,
              painDetected: r.q.painDetected,
              painType: r.q.painType,
              techStack: r.p.techStack,
              freshnessData: r.p.freshnessData,
              city: r.p.city,
              category: r.p.category,
            });
          } catch {}

          // If freshness checker produced comprobable evidence, prefer it
          // over the LLM's painEvidence (it's more concrete)
          let finalPainEvidence = r.q.painEvidence;
          try {
            const fresh = r.p.freshnessData ? JSON.parse(r.p.freshnessData) : null;
            if (fresh?.comprobableEvidence) {
              finalPainEvidence = fresh.comprobableEvidence;
            }
          } catch {}

          await db.prospect.update({
            where: { id: r.p.id },
            data: {
              tier: r.q.tier,
              nicheFit: r.q.nicheFit,
              painDetected: r.q.painDetected,
              painType: r.q.painType,
              painEvidence: finalPainEvidence,
              intentSignals: JSON.stringify(r.q.intentSignals),
              disqualifyReason: r.q.disqualifyReason || null,
              qualificationDetails: r.q.details,
              lookAlikeScore: lookAlike,
            },
          });

          // ── P1.1: Lead Score (0-100, transparent, deterministic) ──────
          const scoreResult = scoreLead({
            tier: r.q.tier,
            nicheFit: r.q.nicheFit,
            painDetected: r.q.painDetected,
            painType: r.q.painType,
            techStack: r.p.techStack,
            freshnessData: r.p.freshnessData,
            city: r.p.city,
            category: r.p.category,
            validation: {}, // populated when validation layer runs
            research_state: "VALIDATED",
            evidence: [],
          });

          // ── P1.2: LLM Intelligence (GLM 5.3 Flash) ───────────────────
          let intel: any = null;
          try {
            intel = await generateIntelligence(r.p.id, offer?.description);
          } catch (e: any) {
            console.warn("[search] intelligence failed:", e.message);
          }

          // Save both Lead Score + Intelligence to the prospect
          await db.prospect.update({
            where: { id: r.p.id },
            data: {
              leadScore: scoreResult.score,
              intelligenceSummary: intel?.summary ?? null,
              intelligenceOpportunity: intel?.opportunity_size ?? null,
              intelligenceAngle: intel?.outreach_angle ?? null,
              intelligenceConfidence: intel?.confidence ?? null,
            },
          });
          if (r.q.tier === "TIER_A") tierA++;
          else if (r.q.tier === "TIER_B") tierB++;
          else if (r.q.tier === "TIER_C") tierC++;
          else if (r.q.tier === "TIER_F") tierF++;
        }
      }
    }

    await db.searchJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        foundCount: savedProspectIds.length,
        qualifiedCount: savedProspectIds.length,
        tierACount: tierA,
        tierBCount: tierB,
        tierCCount: tierC,
        tierFCount: tierF,
        completedAt: new Date(),
      },
    });

    return NextResponse.json({
      jobId: job.id,
      expansionId,
      expandedQueries: shouldExpand ? expanded.length : 1,
      found: savedProspectIds.length,
      tierA,
      tierB,
      tierC,
      tierF,
    });
  } catch (e: any) {
    await db.searchJob.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: e.message },
    });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
