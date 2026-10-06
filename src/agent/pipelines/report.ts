// ============================================================
// src/agent/pipelines/report.ts
// P0.12 — Report engine.
//
// Output is NOT raw JSON. The report must be useful for the user.
//
// Each field's representation makes clear whether the data is:
//   - observado  (FOUND)
//   - validado   (FOUND + ValidationState.valid)
//   - inferido   (INFERRED)
//   - no encontrado (NOT_FOUND — never "no tiene")
//
// Top leads are sorted by:
//   1. research_state (VALIDATED > RESEARCHED > DISCOVERED)
//   2. number of FOUND signals
//   3. number of validated fields
// ============================================================

import type { Lead } from "../core/lead.js";
import { statusLabel, confidenceLabel } from "../core/evidence.js";

export interface ReportInput {
  leads: Lead[];
  /** Original user request for context */
  user_request: string;
  /** Maximum leads to include in the top */
  top_n?: number;
}

export interface ReportOutput {
  /** Human-readable Markdown report */
  text: string;
  /** Compact JSON for programmatic consumption */
  json: string;
  /** Top leads sorted by quality */
  top_leads: Lead[];
}

export function generateReport(input: ReportInput): ReportOutput {
  const top_n = input.top_n ?? 10;
  const sorted = sortLeadsByQuality(input.leads);
  const top = sorted.slice(0, top_n);

  const lines: string[] = [];
  lines.push(`# TOP LEADS — AGENTE LEADS`);
  lines.push(``);
  lines.push(`_Solicitud:_ ${input.user_request}`);
  lines.push(`_Leads encontrados:_ ${input.leads.length}`);
  lines.push(`_Mostrando top:_ ${top.length}`);
  lines.push(``);

  if (top.length === 0) {
    lines.push(`No se encontraron leads con los criterios especificados.`);
    lines.push(``);
    lines.push(`_Sugerencia:_ reformula la búsqueda o ajusta los filtros (por ejemplo, reduce el mínimo de seguidores).`);
  }

  top.forEach((lead, i) => {
    lines.push(`## ${i + 1}. ${lead.name}`);
    lines.push(``);
    lines.push(`| Campo | Valor | Estado | Confianza |`);
    lines.push(`|-------|-------|--------|-----------|`);

    // Use the canonical order: identity → contact → location → niche → P1 extras
    const fields: Array<keyof typeof FIELD_LABELS> = [
      "instagram",
      "website",
      "email",
      "phone",
      "linkedin",
      "location",
      "category",
      "lead_score",
      "llm_intelligence",
    ];
    for (const field of fields) {
      const ev = lead.evidence.find((e) => e.field === field);
      const label = FIELD_LABELS[field];
      if (!ev) {
        lines.push(`| ${label} | — | no investigado | — |`);
        continue;
      }
      const valStr = ev.value ? String(ev.value) : "—";
      const statusStr = statusLabel(ev.status);
      const confStr = confidenceLabel(ev.confidence);
      lines.push(`| ${label} | ${valStr} | ${statusStr} | ${confStr} |`);
    }

    // Validation summary
    if (lead.validation && Object.keys(lead.validation).length > 0) {
      lines.push(``);
      lines.push(`**Validación:**`);
      for (const [field, v] of Object.entries(lead.validation)) {
        lines.push(`- ${VALIDATION_LABELS[field] ?? field}: ${v.status} (confianza ${confidenceLabel(v.confidence)}) — _${v.notes ?? ""}_`);
      }
    }

    // Provenance
    lines.push(``);
    lines.push(`_Fuentes:_ ${lead.sources.join(", ")}`);
    lines.push(`_Descubierto:_ ${lead.discovered_at}`);
    if (lead.research_state) {
      lines.push(`_Estado de investigación:_ ${lead.research_state}`);
    }
    lines.push(``);
  });

  // Footer with the observed/validated/inferred legend
  lines.push(`---`);
  lines.push(``);
  lines.push(`**Leyenda de estados:**`);
  lines.push(`- **encontrado** — dato observado en una fuente pública`);
  lines.push(`- **validado** — dato observado y verificado contra una fuente externa`);
  lines.push(`- **no encontrado** — se buscó pero no apareció (NO implica que no exista)`);
  lines.push(`- **ausente confirmado** — múltiples fuentes confirman que no existe`);
  lines.push(`- **inferido** — derivado por el sistema a partir de señales`);

  const json = JSON.stringify({
    user_request: input.user_request,
    total: input.leads.length,
    top: top.map((l) => ({
      id: l.id,
      name: l.name,
      username: l.username,
      platform: l.platform,
      url: l.url,
      website: l.website,
      email: l.email,
      phone: l.phone,
      location: l.location,
      category: l.category,
      niche: l.niche,
      sources: l.sources,
      research_state: l.research_state,
      validation: l.validation,
      evidence_summary: l.evidence.map((e) => ({
        field: e.field,
        status: e.status,
        confidence: e.confidence,
        source: e.source,
      })),
    })),
  }, null, 2);

  return {
    text: lines.join("\n"),
    json,
    top_leads: top,
  };
}

const FIELD_LABELS = {
  instagram: "Instagram",
  website: "Website",
  email: "Email",
  phone: "Teléfono",
  linkedin: "LinkedIn",
  location: "Ubicación",
  category: "Categoría",
  lead_score: "Lead Score",
  llm_intelligence: "Inteligencia LLM",
} as const;

const VALIDATION_LABELS: Record<string, string> = {
  email: "Email",
  domain: "Dominio",
  url: "URL",
  profile: "Perfil",
  identity: "Identidad (cross-source)",
  cross_source_consistency: "Consistencia cross-source",
};

/**
 * Sort leads by quality:
 * 1. research_state (VALIDATED > RESEARCHED > DISCOVERED)
 * 2. number of FOUND evidence records
 * 3. number of validated fields
 */
function sortLeadsByQuality(leads: Lead[]): Lead[] {
  const stateOrder: Record<string, number> = {
    VALIDATED: 3,
    RESEARCHED: 2,
    RESEARCHING: 1,
    DISCOVERED: 0,
    STORED: 3, // treat as validated
    FAILED: -1,
  };
  return [...leads].sort((a, b) => {
    const sa = stateOrder[a.research_state] ?? 0;
    const sb = stateOrder[b.research_state] ?? 0;
    if (sa !== sb) return sb - sa;
    const fa = a.evidence.filter((e) => e.status === "FOUND").length;
    const fb = b.evidence.filter((e) => e.status === "FOUND").length;
    if (fa !== fb) return fb - fa;
    const va = a.validation ? Object.values(a.validation).filter((v) => v.status === "valid").length : 0;
    const vb = b.validation ? Object.values(b.validation).filter((v) => v.status === "valid").length : 0;
    return vb - va;
  });
}
