// ============================================================
// src/agent/pipelines/index.ts — Barrel export
// ============================================================

export { runDiscovery } from "./discovery.js";
export type { DiscoveryInput, DiscoveryOutput } from "./discovery.js";

export { runResearch } from "./research.js";
export type { ResearchInput, ResearchOutput } from "./research.js";

export { runValidation } from "./validation.js";
export type { ValidationInput, ValidationOutput } from "./validation.js";

export { runDedup } from "./dedup.js";
export type { DedupInput, DedupOutput } from "./dedup.js";

// P1.1 — Scoring
export { runScoring, scoreLead } from "./scoring.js";
export type { ScoringInput, ScoringOutput, LeadScore } from "./scoring.js";

// P1.2 — LLM Intelligence (GLM 5.3 Flash)
export { runIntelligence } from "./intelligence.js";
export type { IntelligenceInput, IntelligenceOutput, LeadIntelligence } from "./intelligence.js";

// P1.4 — Quality metrics per provider
export { computeProviderMetrics, formatProviderMetrics } from "./quality.js";
export type { ProviderMetric } from "./quality.js";

// P0.9 + P1.3 — Orchestrator
export { runLeadPipeline } from "./orchestrator.js";
export type { ParsedIntent, ProviderRegistry, PipelineResult } from "./orchestrator.js";

// P2.3 — CRM-ALBRA hooks
export { CRMAlbraHooks } from "./crm_albra_hooks.js";
export type { CRMHookEvent, CRMHookConfig } from "./crm_albra_hooks.js";

// P2.4 — Outreach pipeline
export { runOutreach } from "./outreach.js";
export type { OutreachInput_Pipeline as OutreachPipelineInput, OutreachOutput as OutreachPipelineOutput } from "./outreach.js";

export { generateReport } from "./report.js";
export type { ReportInput, ReportOutput } from "./report.js";
