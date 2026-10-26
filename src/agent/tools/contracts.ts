// ============================================================
// src/agent/tools/contracts.ts
// PRODUCTION CLOSURE §17 — Explicit contracts for every tool.
//
// Separation: READ / WRITE / EXTERNAL / SENSITIVE.
//   - EXTERNAL tools list their url_args so enforceContract can run
//     the SSRF guard before any network I/O.
//   - SENSITIVE tools (run_outreach) have consent gating implemented
//     inside the pipeline (dry_run default true) — the contract
//     documents the risk; the pipeline enforces it.
//   - ALL tools get a hard timeout + audit trail via enforceContract.
// ============================================================

import type { ToolContract } from "../core/tool_contract.js";

export const CONTRACTS: Record<string, ToolContract> = {
  get_current_time: {
    id: "tool.get_current_time",
    name: "get_current_time",
    purpose: "Devolver fecha/hora actual del sistema.",
    input_schema: { type: "object", properties: {}, required: [] },
    output_schema: { type: "string" },
    permissions: ["READ"],
    risk: "low",
    side_effects: [],
    timeout_ms: 5_000,
    retry_policy: { max_attempts: 1, backoff: "none" },
    evidence_behavior: "none — dato trivial del sistema",
    audit_behavior: "invocación registrada en tool_audit",
  },

  run_lead_pipeline: {
    id: "tool.run_lead_pipeline",
    name: "run_lead_pipeline",
    purpose:
      "Pipeline determinístico completo: discovery → research → validation → evidence → dedup → scoring → intelligence → storage → report.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" }, location: { type: "string" }, niche: { type: "string" },
        platform: { type: "string" }, min_followers: { type: "number" }, top_n: { type: "number" },
        max_concurrency: { type: "number" }, offer_description: { type: "string" },
        enable_intelligence: { type: "boolean" },
      },
      required: ["query"],
    },
    output_schema: { type: "string (markdown report + resumen de ejecución)" },
    permissions: ["READ", "WRITE", "EXTERNAL"],
    risk: "medium",
    side_effects: [
      "Escribe leads + evidencia + execution trace en lead-intelligence.db",
      "Consume cuota de providers externos (Apify/Overpass/DDG/email verifier)",
    ],
    timeout_ms: 600_000,
    retry_policy: { max_attempts: 1, backoff: "none" }, // retries are per-provider inside the pipeline
    evidence_behavior: "cada campo investigado obtiene EvidenceRecord; el trace queda persistido",
    audit_behavior: "ExecutionTrace en executions + cada llamada en tool_audit",
  },

  run_outreach: {
    id: "tool.run_outreach",
    name: "run_outreach",
    purpose:
      "Generar propuestas personalizadas y (solo con dry_run=false explícito) enviarlas por email/WhatsApp oficiales.",
    input_schema: {
      type: "object",
      properties: {
        min_score: { type: "number" }, offer_description: { type: "string" },
        dry_run: { type: "boolean" }, style: { type: "string" }, limit: { type: "number" },
      },
      required: ["offer_description"],
    },
    output_schema: { type: "string (resumen markdown de outreach)" },
    permissions: ["READ", "WRITE", "EXTERNAL", "SENSITIVE"],
    risk: "high",
    side_effects: [
      "SENSITIVE: envío de mensajes reales a terceros (solo dry_run=false)",
      "Escribe outreach_log (idempotencia) y evidencia outreach_sent",
      "Dispara CRM-ALBRA webhook si está configurado",
    ],
    timeout_ms: 300_000,
    retry_policy: { max_attempts: 1, backoff: "none" },
    evidence_behavior: "outreach_sent queda como evidencia INFERRED del lead",
    audit_behavior: "outreach_log por (lead, canal, oferta) + tool_audit",
  },

  scrape_instagram_leads: {
    id: "tool.scrape_instagram_leads",
    name: "scrape_instagram_leads",
    purpose: "Descubrimiento puntual vía Apify (legacy — preferir run_lead_pipeline).",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    output_schema: { type: "string (JSON de candidatos crudos)" },
    permissions: ["READ", "EXTERNAL"],
    risk: "medium",
    side_effects: ["Consume cuota de Apify si APIFY_TOKEN está configurado"],
    timeout_ms: 150_000,
    retry_policy: { max_attempts: 1, backoff: "none" },
    evidence_behavior: "devuelve datos crudos — sin evidencia estructurada (legacy)",
    audit_behavior: "invocación registrada en tool_audit",
  },

  enrich_lead_profile: {
    id: "tool.enrich_lead_profile",
    name: "enrich_lead_profile",
    purpose: "Enriquecimiento puntual con Google Search (legacy, infraestructura — no inteligencia).",
    input_schema: {
      type: "object",
      properties: { username: { type: "string" }, niche: { type: "string" } },
      required: ["username", "niche"],
    },
    output_schema: { type: "string (resultados de búsqueda)" },
    permissions: ["READ", "EXTERNAL"],
    risk: "low",
    side_effects: ["Consume cuota de Apify si APIFY_TOKEN está configurado"],
    timeout_ms: 150_000,
    retry_policy: { max_attempts: 1, backoff: "none" },
    evidence_behavior: "datos crudos de búsqueda — el pipeline los convierte en evidencia",
    audit_behavior: "invocación registrada en tool_audit",
  },

  verify_email: {
    id: "tool.verify_email",
    name: "verify_email",
    purpose: "Verificación puntual de un email contra el verifier externo.",
    input_schema: { type: "object", properties: { email: { type: "string" } }, required: ["email"] },
    output_schema: { type: "string (resultado de verificación)" },
    permissions: ["READ", "EXTERNAL"],
    risk: "low",
    side_effects: [],
    timeout_ms: 20_000,
    retry_policy: { max_attempts: 1, backoff: "none" },
    evidence_behavior: "resultado de verificación puntual; la validación canónica vive en el pipeline",
    audit_behavior: "invocación registrada en tool_audit",
  },

  scrape_stealth: {
    id: "tool.scrape_stealth",
    name: "scrape_stealth",
    purpose: "Extracción de una URL concreta con Scrapling (Python). NO evade CAPTCHAs ni Cloudflare.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" }, selector: { type: "string" } },
      required: ["url"],
    },
    output_schema: { type: "string (texto/emails/socials extraídos)" },
    permissions: ["READ", "EXTERNAL"],
    risk: "medium",
    side_effects: ["Ejecuta proceso Python local (60s hard cap en el bridge)"],
    timeout_ms: 90_000,
    retry_policy: { max_attempts: 1, backoff: "none" },
    evidence_behavior: "contenido crudo; el pipeline lo convierte en evidencia",
    audit_behavior: "tool_audit + SSRF guard registra rechazos",
    url_args: ["url"],
  },

  save_lead: {
    id: "tool.save_lead",
    name: "save_lead",
    purpose: "Guardar un lead individual (legacy, SQLite de conversaciones, dedup por email).",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string" }, email: { type: "string" }, url: { type: "string" },
        followers: { type: "string" }, status: { type: "string" },
      },
      required: ["email"],
    },
    output_schema: { type: "string (confirmación)" },
    permissions: ["WRITE"],
    risk: "low",
    side_effects: ["Inserta/actualiza fila en tabla leads (DB legacy)"],
    timeout_ms: 10_000,
    retry_policy: { max_attempts: 1, backoff: "none" },
    evidence_behavior: "ninguno — almacenamiento crudo legacy",
    audit_behavior: "invocación registrada en tool_audit",
  },
};
