// ============================================================
// src/app/api/chat/route.ts — Chat with the agent (GLM 5.3 Flash)
// Receives: { message, history } → Returns: { response, iterations }
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server";
import { db } from "@/lib/db";
import { getNvidiaClient, AI_MODEL, type ChatMessage } from "@/lib/ai/client";
import { getLeadSources } from "@/lib/leads";
import { qualifyProspect } from "@/lib/ai/qualification";
import { scoreLead } from "@/lib/ai/scoring";

export const maxDuration = 300;

const SYSTEM_PROMPT = `Eres AGENTE LEADS, el agente de prospección inteligente integrado en el dashboard web.
Objetivo: encontrar clientes potenciales, investigarlos, validarlos y entregar los mejores leads con evidencia.

## Herramienta: run_lead_pipeline
Para buscar leads, USA 'run_lead_pipeline'. Pipeline completo:
  DESCUBRIR → INVESTIGAR → VALIDAR → SCORING → INTELIGENCIA LLM → ALMACENAR

## Herramienta: get_dashboard
Devuelve KPIs del dashboard.

## Herramienta: get_prospects
Lista prospectos con filtros (tier, limit).

## Reglas
- Responde en español.
- Sé conciso — el detalle está en el CRM del dashboard.
- Distingue "no encontrado" de "no tiene".
- Menciona el Lead Score cuando muestres resultados.`;

const TOOLS: any[] = [
  {
    type: "function" as const,
    function: {
      name: "run_lead_pipeline",
      description: "Ejecuta el pipeline completo de prospección: descubrir → investigar → validar → scoring → almacenar. Úsalo cuando el usuario quiera encontrar leads.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Qué buscar (ej. 'restaurantes veganos', 'clínicas de estética')" },
          location: { type: "string", description: "Ciudad (ej. 'Medellín')" },
          niche: { type: "string", description: "Nicho (ej. 'vegano')" },
          min_followers: { type: "number", description: "Mínimo de seguidores" },
          top_n: { type: "number", description: "Máximo leads (default 10)" },
          sourceAdapter: { type: "string", description: "Fuente: 'Web Search (z.ai)', 'Demo'" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_dashboard",
      description: "KPIs del dashboard: total prospectos, Tier A/B/C, propuestas, clientes.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_prospects",
      description: "Lista prospectos con filtros.",
      parameters: {
        type: "object",
        properties: {
          tier: { type: "string", description: "TIER_A, TIER_B, TIER_C" },
          limit: { type: "number", description: "Máximo (default 10)" },
        },
      },
    },
  },
];

export async function POST(req: NextRequest) {
  const user = await requireUser();
  const { message, history } = await req.json() as { message: string; history: ChatMessage[] };

  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });

  const client = getNvidiaClient();
  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-10),
    { role: "user", content: message },
  ];

  let iterations = 0;
  const MAX = 5;

  try {
    while (iterations < MAX) {
      iterations++;
      const res = await client.chat.completions.create({
        model: AI_MODEL,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.5,
        max_tokens: 4096,
      });

      const msg = res.choices[0]?.message;
      if (!msg) break;

      if (res.choices[0].finish_reason === "stop" || !msg.tool_calls?.length) {
        return NextResponse.json({ response: msg.content ?? "(sin respuesta)", iterations });
      }

      messages.push(msg);

      for (const tc of msg.tool_calls as any) {
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
        console.log(`[chat] tool: ${tc.function.name}`, args);
        let result: string;
        try { result = await execTool(tc.function.name, args, user.id); }
        catch (e: any) { result = `Error: ${e.message}`; }
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
    }
    return NextResponse.json({ response: "Límite de iteraciones. Revisa el CRM.", iterations });
  } catch (e: any) {
    return NextResponse.json({ response: `⚠️ ${e.message}`, iterations }, { status: 500 });
  }
}

async function execTool(name: string, args: any, userId: string): Promise<string> {
  if (name === "run_lead_pipeline") return await execPipeline(args, userId);
  if (name === "get_dashboard") return await execDashboard(userId);
  if (name === "get_prospects") return await execProspects(args, userId);
  return `Unknown: ${name}`;
}

async function execPipeline(args: any, userId: string): Promise<string> {
  const integ = await db.integration.findUnique({ where: { userId } });
  const adapters = getLeadSources(integ || null);
  const adapter = adapters.find((a) => a.name === args.sourceAdapter) || adapters[0];
  const offer = await db.offer.findFirst({ where: { userId, isActive: true }, orderBy: { createdAt: "desc" } });

  const job = await db.searchJob.create({
    data: {
      userId, offerId: offer?.id, city: args.location || "n/a",
      category: args.niche || null, keywords: args.query || null,
      sourceAdapter: adapter.name, status: "running", startedAt: new Date(),
    },
  });

  try {
    const raw = await adapter.search({
      city: args.location || "", category: args.niche,
      keywords: args.query, offerDescription: offer?.description,
    });

    let tA = 0, tB = 0, tC = 0, tF = 0;
    const ids: string[] = [];

    for (const rp of raw) {
      const ex = await db.prospect.findFirst({ where: { userId, name: rp.name, city: rp.city } });
      if (ex) { ids.push(ex.id); continue; }
      const c = await db.prospect.create({
        data: {
          userId, offerId: offer?.id, searchJobId: job.id,
          name: rp.name, category: rp.category || null, city: rp.city || null,
          website: rp.website || null, phone: rp.phone || null,
          email: rp.email || null, description: rp.description || null,
          source: rp.source, status: "NEW", tier: "PENDING",
        },
      });
      ids.push(c.id);
    }

    if (offer) {
      const all = await db.prospect.findMany({ where: { id: { in: ids } } });
      for (const p of all) {
        try {
          const q = await qualifyProspect(
            { name: offer.name, description: offer.description, targetNiches: offer.targetNiches },
            { name: p.name, category: p.category, city: p.city, website: p.website, phone: p.phone, email: p.email, description: p.description },
          );
          const sc = scoreLead({ tier: q.tier, nicheFit: q.nicheFit, painDetected: q.painDetected, painType: q.painType, research_state: "VALIDATED" });
          await db.prospect.update({ where: { id: p.id }, data: {
            tier: q.tier, nicheFit: q.nicheFit, painDetected: q.painDetected,
            painType: q.painType, painEvidence: q.painEvidence,
            leadScore: sc.score, qualificationDetails: q.details,
          }});
          if (q.tier === "TIER_A") tA++; else if (q.tier === "TIER_B") tB++; else if (q.tier === "TIER_C") tC++; else if (q.tier === "TIER_F") tF++;
        } catch (e: any) { console.error("[chat] qual failed:", e.message); }
      }
    }

    await db.searchJob.update({ where: { id: job.id }, data: { status: "completed", foundCount: ids.length, tierACount: tA, tierBCount: tB, tierCCount: tC, tierFCount: tF, completedAt: new Date() } });

    return `✅ Búsqueda completada:\n- Encontrados: ${ids.length}\n- Tier A: ${tA}\n- Tier B: ${tB}\n- Tier C: ${tC}\n- Fuente: ${adapter.name}\n\nVe a /prospectos para ver los resultados.`;
  } catch (e: any) {
    await db.searchJob.update({ where: { id: job.id }, data: { status: "failed", errorMessage: e.message } });
    return `❌ Error: ${e.message}`;
  }
}

async function execDashboard(userId: string): Promise<string> {
  const [total, tA, tB, tC, tF, props, clients] = await Promise.all([
    db.prospect.count({ where: { userId } }),
    db.prospect.count({ where: { userId, tier: "TIER_A" } }),
    db.prospect.count({ where: { userId, tier: "TIER_B" } }),
    db.prospect.count({ where: { userId, tier: "TIER_C" } }),
    db.prospect.count({ where: { userId, tier: "TIER_F" } }),
    db.proposal.count({ where: { userId } }),
    db.prospect.count({ where: { userId, status: "CLIENT" } }),
  ]);
  const scored = await db.prospect.findMany({ where: { userId, leadScore: { not: null } }, select: { leadScore: true } });
  const avg = scored.length > 0 ? Math.round(scored.reduce((s, p) => s + (p.leadScore ?? 0), 0) / scored.length) : 0;
  return `📊 Dashboard:\n- Total: ${total}\n- A:${tA} B:${tB} C:${tC} F:${tF}\n- Propuestas: ${props}\n- Clientes: ${clients}\n- Avg Score: ${avg}/100`;
}

async function execProspects(args: any, userId: string): Promise<string> {
  const where: any = { userId };
  if (args.tier) where.tier = args.tier;
  const ps = await db.prospect.findMany({ where, orderBy: { createdAt: "desc" }, take: args.limit || 10, select: { name: true, tier: true, leadScore: true, city: true, painType: true } });
  if (ps.length === 0) return "Sin prospectos.";
  return ps.map((p, i) => `${i + 1}. ${p.name} | ${p.tier} | Score:${p.leadScore ?? "?"} | ${p.city ?? "?"}`).join("\n");
}
