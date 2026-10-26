// ============================================================
// src/agent/skills/types.ts
// PRODUCTION CLOSURE §18 — Skill specification.
//
//   TOOL  = puede hacer X
//   SKILL = sabe cómo hacer X correctamente
//
// A Skill wraps deterministic procedures around tools/pipelines and
// carries its own verification, pitfalls and regression contract.
// ============================================================

export type SkillLifecycle =
  | "PROPOSED"    // drafted, not executable in production
  | "VALIDATING"  // under regression validation
  | "ACTIVE"      // validated — production behavior allowed
  | "DEPRECATED"  // superseded — do not use for new executions
  | "RETIRED";    // historical only

/** §19 — allowed lifecycle transitions. */
export const SKILL_LIFECYCLE_TRANSITIONS: Record<SkillLifecycle, SkillLifecycle[]> = {
  PROPOSED: ["VALIDATING", "RETIRED"],
  VALIDATING: ["ACTIVE", "RETIRED"],
  ACTIVE: ["DEPRECATED", "RETIRED"],
  DEPRECATED: ["RETIRED"],
  RETIRED: [],
};

export function canTransition(from: SkillLifecycle, to: SkillLifecycle): boolean {
  return SKILL_LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface SkillStep {
  /** Ordered, human-auditable procedure step */
  order: number;
  action: string;
  /** Which module/tool/pipeline realizes this step */
  realized_by: string;
}

export interface SkillSpec {
  id: string;
  name: string;
  purpose: string;
  trigger: string;
  prerequisites: string[];
  procedure: SkillStep[];
  tools_required: string[];
  expected_result: string;
  /** Deterministic verification the run performed correctly */
  verification: string;
  pitfalls: string[];
  evidence_behavior: string;
  version: string;
  confidence: "high" | "medium" | "low";
  origin: string;
  /** Path of the regression test that validates this skill */
  regression_test: string;
}

/** Runtime row (spec + lifecycle + measured stats). */
export interface SkillRecord {
  id: string;
  name: string;
  version: string;
  lifecycle: SkillLifecycle;
  spec: SkillSpec;
  success_count: number;
  failure_count: number;
  success_rate: number; // 0..1, computed
  last_validated: string | null;
  created_at: string;
  updated_at: string;
}
