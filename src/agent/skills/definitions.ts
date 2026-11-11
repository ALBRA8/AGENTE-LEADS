// ============================================================
// src/agent/skills/definitions.ts
// PRODUCTION CLOSURE §18 — The core Skills of AGENTE-LEADS.
//
// Each skill codifies KNOW-HOW (how to do X correctly) on top of the
// deterministic pipelines that already exist. Nothing here invents new
// capabilities — a skill documents the procedure, the pitfalls learned
// in audits (e.g. P0.6 "no encontrado ≠ no tiene"), its verification
// and the regression test that protects it.
// ============================================================

import type { SkillSpec } from "./types.js";

export const CORE_SKILL_SPECS: SkillSpec[] = [
  {
    id: "skill.lead_discovery",
    name: "Lead Discovery",
    purpose:
      "Encontrar candidatos relevantes con atribución de fuente, respetando fallback de providers y límites.",
    trigger: "Cuando se recibe una oportunidad (query + location opcional) sin leads asociados.",
    prerequisites: [
      "Provider registry construido (Apify → Overpass → DuckDuckGo → Mock)",
      "Query normalizada no vacía",
    ],
    procedure: [
      { order: 1, action: "Ejecutar runDiscovery con la cadena de providers", realized_by: "pipelines/discovery.ts" },
      { order: 2, action: "Aplicar filtro min_followers a nivel pipeline", realized_by: "pipelines/orchestrator.ts" },
      { order: 3, action: "Registrar failed_providers y usado_provider en el ExecutionTrace", realized_by: "core/execution.ts" },
    ],
    tools_required: ["run_lead_pipeline"],
    expected_result: "CandidateLead[] normalizados con source y discovered_at; DISCOVERED ≠ VALIDATED.",
    verification: "candidates_count > 0 implica used_provider != 'none' y cada candidato tiene source.",
    pitfalls: [
      "EMPTY_RESULT es legítimo: no reintentar en bucle (§29 rate limiting)",
      "Encontrar un resultado NO significa que sea un lead válido (§6)",
    ],
    evidence_behavior: "Cada candidato conserva raw_data del provider para auditoría.",
    version: "1.0.0",
    confidence: "high",
    origin: "Auditoría V2 — pipeline P0.3 existente",
    regression_test: "tests/discovery.test.ts",
  },
  {
    id: "skill.company_research",
    name: "Company Research",
    purpose: "Enriquecer una empresa candidato con website, actividad, ubicación y señales comerciales con procedencia.",
    trigger: "Candidato descubierto sin research previo.",
    prerequisites: ["CandidateLead normalizado", "Research/scraping providers configurados (o skip honesto)"],
    procedure: [
      { order: 1, action: "runResearch combina research provider + scraping provider", realized_by: "pipelines/research.ts" },
      { order: 2, action: "Convertir señales crudas en EvidenceRecord por campo", realized_by: "pipelines/research.ts" },
      { order: 3, action: "Calcular DedupSignature", realized_by: "core/lead.ts" },
    ],
    tools_required: ["run_lead_pipeline"],
    expected_result: "Lead con research_state=RESEARCHED y evidencia FOUND/NOT_FOUND por campo.",
    verification: "Cada campo importante (website/email/phone/instagram/linkedin) tiene EvidenceRecord.",
    pitfalls: [
      "Los datos del provider son RAW: el pipeline los estructura, no el provider (§7)",
      "Toda afirmación conserva fuente (procedencia)",
    ],
    evidence_behavior: "FOUND registra source+retrieved_at; NOT_FOUND nunca se reporta como 'no tiene'.",
    version: "1.0.0",
    confidence: "high",
    origin: "Auditoría V2 — pipeline P0.4 existente",
    regression_test: "tests/research.test.ts",
  },
  {
    id: "skill.contact_research",
    name: "Contact Research",
    purpose: "Localizar canales de contacto verificables (email, teléfono, perfiles) de un candidato.",
    trigger: "Lead sin contacto encontrado tras company research básico.",
    prerequisites: ["Lead con evidencia de research", "URLs públicas conocidas"],
    procedure: [
      { order: 1, action: "Extraer emails/phones de raw_text y scraping", realized_by: "pipelines/research.ts" },
      { order: 2, action: "Registrar cada canal como evidencia independiente", realized_by: "core/evidence.ts" },
      { order: 3, action: "Marcar confianza low para teléfonos (ruido alto)", realized_by: "pipelines/research.ts" },
    ],
    tools_required: ["run_lead_pipeline", "scrape_stealth (puntual)"],
    expected_result: "Contactos con evidencia y confianza asignada; sin contacto → NOT_FOUND explícito.",
    verification: "Ningún contacto se promueve sin EvidenceRecord que lo respalde.",
    pitfalls: [
      "Regex de teléfono genera falsos positivos → confianza baja obligatoria",
      "Un email hallado no está validado hasta validation (§8)",
    ],
    evidence_behavior: "Confianza por canal: email medium, phone low.",
    version: "1.0.0",
    confidence: "medium",
    origin: "Auditoría V2 — research existente",
    regression_test: "tests/research.test.ts",
  },
  {
    id: "skill.lead_validation",
    name: "Lead Validation",
    purpose: "Comprobar existencia, consistencia y datos mínimos antes de promover DISCOVERED → VALIDATED.",
    trigger: "Lead con research_state=RESEARCHED.",
    prerequisites: ["Verification provider configurado o marcado unknown explícito"],
    procedure: [
      { order: 1, action: "Validar email vía provider (MX/SMTP)", realized_by: "pipelines/validation.ts" },
      { order: 2, action: "Validar dominio/website vía HEAD + SSRF guard", realized_by: "providers/email_verifier_provider.ts" },
      { order: 3, action: "Chequear consistencia cross-source email-domain vs website-domain", realized_by: "pipelines/validation.ts" },
      { order: 4, action: "Setear research_state=VALIDATED", realized_by: "pipelines/validation.ts" },
    ],
    tools_required: ["run_lead_pipeline"],
    expected_result: "ValidationState poblado; conflicto de identidad marcado, no silenciado.",
    verification: "lead.validation contiene email/domain con status y confidence.",
    pitfalls: [
      "Sin provider: status='unknown' con confianza none — nunca inventar validez",
      "CONTRADICTED: dominio de email ≠ dominio web baja 10 puntos el score",
    ],
    evidence_behavior: "La validación añade evidencia email_validation; el FIND original se conserva.",
    version: "1.0.0",
    confidence: "high",
    origin: "Auditoría V2 — pipeline P0.5 existente",
    regression_test: "tests/validation.test.ts",
  },
  {
    id: "skill.evidence_collection",
    name: "Evidence Collection",
    purpose: "Garantizar que cada dato importante sea auditable con fuente, timestamp, confianza y truth_level.",
    trigger: "Cualquier escritura de dato en un Lead.",
    prerequisites: ["Ninguno — transversal"],
    procedure: [
      { order: 1, action: "Usar helpers found/notFound/confirmedAbsent/inferred/contradicted", realized_by: "core/evidence.ts" },
      { order: 2, action: "Derivar truth_level determinístico (truthLevelOf)", realized_by: "core/evidence.ts" },
      { order: 3, action: "Persistir evidencia en lead_intelligence_evidence dentro de transacción", realized_by: "storage/lead_intelligence.ts" },
    ],
    tools_required: [],
    expected_result: "EvidenceRecord[] auditable por lead; inferencias marcadas, nunca presentadas como hechos.",
    verification: "Todo EvidenceRecord tiene field, status, source, retrieved_at, confidence.",
    pitfalls: [
      "P0.6: 'no encontrado' ≠ 'no tiene' — NOT_FOUND jamás se reporta como ausencia",
      "INFERRED lleva confidence none y cadena de razonamiento",
      "CONTRADICTED nunca se presenta como dato fiable",
    ],
    evidence_behavior: "Es el comportamiento central de esta skill.",
    version: "1.0.0",
    confidence: "high",
    origin: "Auditoría V2 — evidence engine P0.6",
    regression_test: "tests/evidence.test.ts",
  },
  {
    id: "skill.deduplication",
    name: "Deduplication",
    purpose: "Evitar leads duplicados por multi-señal conservando trazabilidad de cada match.",
    trigger: "Lead validado listo para persistir.",
    prerequisites: ["DedupSignature calculada"],
    procedure: [
      { order: 1, action: "findDedupMatch: EXACT (email/website) → STRONG (instagram/phone/domain) → PROBABLE (name+location)", realized_by: "storage/lead_intelligence.ts" },
      { order: 2, action: "Registrar match en dedup_matches (audit)", realized_by: "storage/lead_intelligence.ts" },
      { order: 3, action: "Merge conservador: existing gana, evidence se deduplica por prioridad de status", realized_by: "pipelines/dedup.ts" },
    ],
    tools_required: ["run_lead_pipeline"],
    expected_result: "Sin duplicados; cada merge queda registrado con match_level y señales.",
    verification: "action='merged' implica fila en dedup_matches con matchedOn no vacío.",
    pitfalls: [
      "PROBABLE es ambiguo: se conserva trazabilidad completa del match",
      "El merge nunca destruye evidencia existente (prioridad FOUND > resto)",
    ],
    evidence_behavior: "Evidence deduplicada por campo con prioridad de status.",
    version: "1.0.0",
    confidence: "high",
    origin: "Auditoría V2 — pipeline P0.7 existente",
    regression_test: "tests/dedup.test.ts",
  },
  {
    id: "skill.qualification",
    name: "Qualification",
    purpose: "Calificar el lead con un score determinístico, explicable y auditado.",
    trigger: "Lead almacenado (STORED).",
    prerequisites: ["Validación completada", "Evidencia disponible"],
    procedure: [
      { order: 1, action: "scoreLead computa desglose por factor (validación, evidencia FOUND, consistencia, estado)", realized_by: "pipelines/scoring.ts" },
      { order: 2, action: "Adjuntar score como evidencia INFERRED con inferred_from=breakdown", realized_by: "pipelines/scoring.ts" },
      { order: 3, action: "Persistir lead con lead_score tipado", realized_by: "storage/lead_intelligence.ts" },
    ],
    tools_required: ["run_lead_pipeline"],
    expected_result: "lead_score 0-100 reproducible; ante la pregunta '¿por qué este score?' el desglose responde.",
    verification: "Dado el mismo Lead, scoreLead devuelve el mismo score y desglose (determinístico).",
    pitfalls: [
      "El LLM NO modifica el score (§11): intelligence es contexto, no opinión opaca",
      "Score se re-persiste tras computing (fix ARCH-C1) para /stats y outreach",
    ],
    evidence_behavior: "lead_score queda como evidencia INFERRED con inferred_from del desglose.",
    version: "1.0.0",
    confidence: "high",
    origin: "Auditoría V2 — scoring P1.1 existente",
    regression_test: "tests/scoring.test.ts",
  },
  {
    id: "skill.scoring",
    name: "Scoring (deterministic engine)",
    purpose: "Motor puro de scoring 0-100 — sin LLM, sin estado, explicable factor a factor.",
    trigger: "Invocado por qualification y por cualquier re-score.",
    prerequisites: ["Lead canónico"],
    procedure: [
      { order: 1, action: "Aplicar tabla de puntos fija (email 20/15/-10, dominio 15, website 10, phone 5, instagram 10, linkedin 10, identidad ±5/-10, estado 0-15)", realized_by: "pipelines/scoring.ts" },
      { order: 2, action: "Clamp a [0,100]", realized_by: "pipelines/scoring.ts" },
    ],
    tools_required: [],
    expected_result: "LeadScore { score, breakdown[] } idéntico entre ejecuciones.",
    verification: "Tests determinísticos cubren el rango completo y casos de conflicto.",
    pitfalls: [
      "No añadir señales opacas: cada punto debe tener reason legible (§11)",
    ],
    evidence_behavior: "Breakdown accesible vía score_breakdown y evidencia del lead.",
    version: "1.0.0",
    confidence: "high",
    origin: "Auditoría V2 — P1.1",
    regression_test: "tests/scoring.test.ts",
  },
  {
    id: "skill.outreach_preparation",
    name: "Outreach Preparation",
    purpose: "Preparar propuestas personalizadas SIN enviar: canal, consenso, DRY RUN e idempotencia.",
    trigger: "Usuario solicita contactar leads calificados (score >= min_score).",
    prerequisites: [
      "Lead con score y canal (email validado o teléfono)",
      "dry_run por defecto true — el envío real exige dry_run=false explícito (consentimiento)",
    ],
    procedure: [
      { order: 1, action: "Filtrar leads por min_score", realized_by: "pipelines/outreach.ts" },
      { order: 2, action: "Determinar canal ANTES de gastar tokens del LLM", realized_by: "pipelines/outreach.ts" },
      { order: 3, action: "Chequear outreach_log: (lead_id, channel) ya enviado → skip por idempotencia", realized_by: "storage/agent_infra.ts" },
      { order: 4, action: "Generar propuesta con LLM o generator inyectado", realized_by: "pipelines/outreach.ts" },
      { order: 5, action: "En DRY RUN: entregar preview sin enviar; en REAL: enviar vía API oficial + registrar outreach_log + CRM hook", realized_by: "providers/outreach.ts + crm_albra_hooks.ts" },
    ],
    tools_required: ["run_outreach"],
    expected_result: "Propuestas auditables; cero duplicados por retry; DRY RUN por defecto.",
    verification: "Segunda ejecución con mismo lead+canal produce status skipped con razón already_sent.",
    pitfalls: [
      "Nunca enviar sin dry_run=false explícito (POLICY_ERROR)",
      "No mencionar 'scrapeamos tu sitio' en propuestas (regla del prompt)",
      "Solo APIs oficiales: SendGrid / WhatsApp Cloud — sin bots ni bypass",
    ],
    evidence_behavior: "Envío real añade evidencia outreach_sent (INFERRED) al lead.",
    version: "1.0.0",
    confidence: "high",
    origin: "Auditoría V2 — P2.4 + cierre de idempotencia",
    regression_test: "tests/outreach.test.ts",
  },
];

// ============================================================
// Bootstrap — register all core skills with lifecycle enforcement.
//
// A skill becomes ACTIVE only after regression validation. The
// regression tests listed in each spec are part of this repository's
// test suite (`npm test`); the caller asserts the suite is green
// before transitioning to ACTIVE (§19: no experimental skill becomes
// permanent behavior automatically).
// ============================================================

import { registerSkill, markSkillValidated, transitionSkill, getSkillById } from "./registry.js";

export function bootstrapSkills(opts: { activate?: boolean } = {}): number {
  for (const spec of CORE_SKILL_SPECS) {
    registerSkill(spec);
    markSkillValidated(spec.id);
    if (opts.activate ?? true) {
      // VALIDATING → ACTIVE requires last_validated (set above).
      const skill = getSkillById(spec.id)!;
      if (skill.lifecycle === "PROPOSED") {
        transitionSkill(spec.id, "VALIDATING");
      }
      const current = getSkillById(spec.id)!;
      if (current.lifecycle === "VALIDATING") {
        transitionSkill(spec.id, "ACTIVE", { validated: true });
      }
    }
  }
  return CORE_SKILL_SPECS.length;
}
