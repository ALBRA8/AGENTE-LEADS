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
import { getLeadSources, searchWithFallback } from "@/lib/leads";
import type { FallbackAttempt } from "@/lib/leads";
import { buildDedupCandidates } from "@/lib/leads/dedup";
import { buildDiscoveryEvidence } from "@/lib/leads/evidence-builder";
import { classifyDigitalPresence, confirmWeb } from "@/lib/leads/digital-presence";
import type { DigitalPresence, RawProspect } from "@/lib/leads/types";
import { auditPageSpeed } from "@/lib/leads/pagespeed";
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
  // P1: la fuente elegida por el usuario lidera la cadena; el resto queda
  // como fallback ordenado (contrato 7 — envelope + cadena de proveedores).
  const preferred = sourceAdapter
    ? adapters.find((a) => a.name === sourceAdapter)
    : undefined;
  const chain = preferred
    ? [preferred, ...adapters.filter((a) => a !== preferred)]
    : adapters;

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
      sourceAdapter: preferred?.name || chain[0]?.name || "unknown",
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

    // ── STEP 2: Cadena de fuentes con envelope + dedup multi-señal (P1) ──
    // Cada query recorre la cadena de proveedores con envelope clasificado
    // (contrato 7); se acumulan fuentes fallidas y metadatos de coste
    // (contrato 6) y el dedup usa señales EXACT/STRONG/PROBABLE.
    const allRawProspects: RawProspect[] = [];
    const seenKeys = new Set<string>();
    const failedProviders = new Map<
      string,
      { provider: string; code: string; message: string; count: number }
    >();
    const providerCallsDetail: Record<
      string,
      { provider: string; calls: number; durationMs: number; fetchedAt: string }
    > = {};
    let totalProviderCalls = 0;

    const recordAttempts = (attempts: FallbackAttempt[]) => {
      for (const a of attempts) {
        // Una fuente "no configurada" no es un fallo operativo del usuario —
        // se omite del conteo de fuentes fallidas (contrato 6).
        if (!a.ok && !(a.code === "AUTH" && a.message === "no configurado")) {
          const prev = failedProviders.get(a.provider);
          if (prev) prev.count += 1;
          else
            failedProviders.set(a.provider, {
              provider: a.provider,
              code: a.code || "UNKNOWN",
              message: a.message || "",
              count: 1,
            });
        }
      }
    };

    for (const q of expanded.slice(0, 25)) {
      // For expanded queries we pass keywords=q so the adapter searches for it
      const adapterInput = shouldExpand
        ? { city, country, category, keywords: q, radius, offerDescription: offer?.description }
        : { city, country, category, keywords, radius, offerDescription: offer?.description };
      const outcome = await searchWithFallback(chain, adapterInput);
      totalProviderCalls += outcome.totalCalls;
      recordAttempts(outcome.attempts);
      if (outcome.result.ok) {
        const meta = outcome.result.meta;
        if (meta) {
          const acc = providerCallsDetail[meta.provider] ?? {
            provider: meta.provider,
            calls: 0,
            durationMs: 0,
            fetchedAt: meta.fetchedAt,
          };
          acc.calls += meta.calls;
          acc.durationMs += meta.durationMs;
          providerCallsDetail[meta.provider] = acc;
        }
        for (const r of outcome.result.data) {
          const cands = buildDedupCandidates(r);
          if (cands.some((c) => seenKeys.has(c.key))) continue; // duplicado multi-señal
          for (const c of cands) seenKeys.add(c.key);
          allRawProspects.push(r);
        }
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
      // Dedup multi-señal contra DB: placeId > phone > website > name+city
      const existing = await db.prospect.findFirst({
        where: {
          userId: user.id,
          OR: [
            ...(rp.placeId ? [{ placeId: rp.placeId }] : []),
            ...(rp.phone ? [{ phone: rp.phone }] : []),
            ...(rp.website ? [{ website: rp.website }] : []),
            { name: rp.name, city: rp.city ?? city },
          ],
        },
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
          // ── P1: Places enriquecido + marcado DEMO + presencia digital ──
          placeId: rp.placeId || null,
          lat: rp.lat ?? null,
          lng: rp.lng ?? null,
          rating: rp.rating ?? null,
          ratingCount: rp.ratingCount ?? null,
          businessStatus: rp.businessStatus || null,
          isMock: rp.isMock === true,
          digitalPresence: classifyDigitalPresence(rp),
          status: "NEW",
          tier: "PENDING",
        },
      });
      savedProspectIds.push(created.id);
      newSaved.push(created);

      // ── P1 · Contrato 2: evidencia por campo persistida ──
      const drafts = buildDiscoveryEvidence(rp);
      if (drafts.length > 0) {
        await db.evidence.createMany({
          data: drafts.map((d) => ({
            prospectId: created.id,
            field: d.field,
            value: d.value ?? null,
            status: d.status,
            source: d.source,
            sourceUrl: d.sourceUrl ?? null,
            confidence: d.confidence,
          })),
        });
      }
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
                // P1 · Contrato 3: la web declarada queda verificada tras fetch real
                digitalPresence: confirmWeb(
                  (p.digitalPresence as DigitalPresence | null) ??
                    "WEB_PENDIENTE_DE_VERIFICAR"
                ),
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

    // P2: candidatos a auditoría PageSpeed (contrato 5) — se llena en el
    // bucle de calificación y se consume justo después.
    const psiCandidates: { id: string; website: string }[] = [];

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

          // ── P1.1: Lead Score (0-100, transparente, determinista) ──────
          // Evidencia REAL construida desde el prospect persistido:
          // solo los campos realmente presentes → {field, status:"FOUND",
          // source:"search"}. Los ausentes se OMITEN (nunca status inventado).
          const searchEvidence: { field: string; status: string; source: string }[] = [];
          if (r.p.website) searchEvidence.push({ field: "website", status: "FOUND", source: "search" });
          if (r.p.phone) searchEvidence.push({ field: "phone", status: "FOUND", source: "search" });
          if (r.p.email) searchEvidence.push({ field: "email", status: "FOUND", source: "search" });

          // research_state honesto: este pipeline corre discovery + research
          // (tech stack + freshness), pero NO existe capa de validación →
          // nunca "VALIDATED" hardcodeado. techStack/freshnessData llegan
          // como JSON string de la DB — scoreLead los parsea.
          const scoreResult = scoreLead({
            tier: r.q.tier,
            nicheFit: r.q.nicheFit,
            painDetected: r.q.painDetected,
            painType: r.q.painType,
            techStack: r.p.techStack,
            freshnessData: r.p.freshnessData,
            research_state: "RESEARCHED",
            evidence: searchEvidence,
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
              // P0-B: desglose auditable del score (field/points/reason por
              // componente), persistido junto al score. Se persiste aquí y no
              // en el create porque el breakdown solo existe tras la
              // calificación (el create ocurre antes del pipeline de scoring).
              leadScoreBreakdown: JSON.stringify(scoreResult.breakdown),
              intelligenceSummary: intel?.summary ?? null,
              intelligenceOpportunity: intel?.opportunity_size ?? null,
              intelligenceAngle: intel?.outreach_angle ?? null,
              intelligenceConfidence: intel?.confidence ?? null,
              // P2: taxonomía FACT/INFERENCE/HYPOTHESIS/RECOMMENDATION persistida
              intelligenceItems: intel?.items ? JSON.stringify(intel.items) : null,
            },
          });
          if (r.q.tier === "TIER_A") tierA++;
          else if (r.q.tier === "TIER_B") tierB++;
          // P2: solo A/B con website se auditan con PageSpeed (coste/tiempo)
          if ((r.q.tier === "TIER_A" || r.q.tier === "TIER_B") && r.p.website) {
            psiCandidates.push({ id: r.p.id, website: r.p.website });
          }
          else if (r.q.tier === "TIER_C") tierC++;
          else if (r.q.tier === "TIER_F") tierF++;
        }
      }
    }

    // ── P2: PageSpeed Insights (contrato 5) para calificados A/B con web ──
    // Batches de 2, tope 10 auditorías por job (PSI tarda ~15-25s por URL).
    // La key opcional viene de Integration.pageSpeedApiKey (contrato 8:
    // sin key usa la cuota anónima gratuita). El resultado (incl. estados
    // UNREACHABLE/TIMEOUT/INVALID_URL) se persiste tal cual: es evidencia.
    let pagespeedAudited = 0;
    if (psiCandidates.length > 0) {
      const psiTargets = psiCandidates.slice(0, 10);
      for (let i = 0; i < psiTargets.length; i += 2) {
        await Promise.all(
          psiTargets.slice(i, i + 2).map(async (t) => {
            try {
              const ps = await auditPageSpeed(t.website, {
                apiKey: integration?.pageSpeedApiKey || undefined,
              });
              await db.prospect.update({
                where: { id: t.id },
                data: { pageSpeed: JSON.stringify(ps) },
              });
              pagespeedAudited++;
            } catch (e: any) {
              console.warn(`[search] pagespeed failed for ${t.id}:`, e.message);
            }
          })
        );
      }
    }

    // ── P1 · Contrato 6: estado real del SearchJob + trazabilidad de fuentes/coste ──
    const failedList = Array.from(failedProviders.values());
    const hadFailures = failedList.length > 0;
    const found = savedProspectIds.length;
    const finalStatus =
      found > 0 ? (hadFailures ? "partial" : "completed") : hadFailures ? "failed" : "completed";

    await db.searchJob.update({
      where: { id: job.id },
      data: {
        status: finalStatus,
        foundCount: found,
        qualifiedCount: found,
        tierACount: tierA,
        tierBCount: tierB,
        tierCCount: tierC,
        tierFCount: tierF,
        completedAt: new Date(),
        partialSources: failedList.length,
        failedSources: failedList.length ? JSON.stringify(failedList) : null,
        providerCalls: totalProviderCalls,
        providerCallsDetail: Object.keys(providerCallsDetail).length
          ? JSON.stringify(Object.values(providerCallsDetail))
          : null,
      },
    });

    return NextResponse.json({
      jobId: job.id,
      expansionId,
      expandedQueries: shouldExpand ? expanded.length : 1,
      found,
      tierA,
      tierB,
      tierC,
      tierF,
      status: finalStatus,
      partialSources: failedList.length,
      failedSources: failedList,
      providerCalls: totalProviderCalls,
      pagespeedAudited,
    });
  } catch (e: any) {
    await db.searchJob.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: e.message },
    });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
