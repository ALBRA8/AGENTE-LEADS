// ============================================================
// src/agent/skills/registry.ts
// PRODUCTION CLOSURE §18-19 — Skill registry + lifecycle.
//
// Rules enforced here:
//   - A skill can only be promoted to ACTIVE from VALIDATING
//     AND with a recorded validation (last_validated set).
//   - Lifecycle transitions follow SKILL_LIFECYCLE_TRANSITIONS —
//     an experimental skill can NEVER silently become permanent
//     behavior (§19).
//   - Every execution of a skill is recorded in skill_runs, which
//     feeds success_rate (§18) and future regression decisions.
// ============================================================

import { ensureAgentInfraTables } from "../storage/agent_infra.js";
import { getDb } from "../storage/lead_intelligence.js";
import {
  canTransition,
  type SkillLifecycle,
  type SkillRecord,
  type SkillSpec,
} from "./types.js";

export class SkillLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillLifecycleError";
  }
}

/** Register (upsert) a skill. New skills start as PROPOSED. */
export function registerSkill(spec: SkillSpec): SkillRecord {
  ensureAgentInfraTables();
  const now = new Date().toISOString();

  const existing = getDb()
    .prepare("SELECT * FROM agent_skills WHERE id = ?")
    .get(spec.id) as any;

  if (existing) {
    // Versioned update — same id, new version resets lifecycle.
    if (existing.version !== spec.version) {
      getDb()
        .prepare(
          "UPDATE agent_skills SET name = ?, version = ?, spec = ?, lifecycle = 'PROPOSED', updated_at = ? WHERE id = ?"
        )
        .run(spec.name, spec.version, JSON.stringify(spec), now, spec.id);
    }
    return getSkillById(spec.id)!;
  }

  getDb()
    .prepare(
      "INSERT INTO agent_skills (id, name, version, lifecycle, spec, created_at, updated_at) VALUES (?, ?, ?, 'PROPOSED', ?, ?, ?)"
    )
    .run(spec.id, spec.name, spec.version, JSON.stringify(spec), now, now);

  return getSkillById(spec.id)!;
}

export function getSkillById(id: string): SkillRecord | null {
  ensureAgentInfraTables();
  const row = getDb().prepare("SELECT * FROM agent_skills WHERE id = ?").get(id) as any;
  if (!row) return null;
  return rowToSkill(row);
}

export function getAllSkills(): SkillRecord[] {
  ensureAgentInfraTables();
  const rows = getDb().prepare("SELECT * FROM agent_skills ORDER BY id").all() as any[];
  return rows.map(rowToSkill);
}

function rowToSkill(row: any): SkillRecord {
  const spec = JSON.parse(row.spec) as SkillSpec;
  const total = row.success_count + row.failure_count;
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    lifecycle: row.lifecycle as SkillLifecycle,
    spec,
    success_count: row.success_count,
    failure_count: row.failure_count,
    success_rate: total > 0 ? row.success_count / total : 0,
    last_validated: row.last_validated ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Transition a skill through the lifecycle (§19). Enforced + validated. */
export function transitionSkill(id: string, to: SkillLifecycle, opts: { validated?: boolean } = {}): SkillRecord {
  const skill = getSkillById(id);
  if (!skill) throw new SkillLifecycleError(`unknown skill: ${id}`);
  if (!canTransition(skill.lifecycle, to)) {
    throw new SkillLifecycleError(
      `illegal lifecycle transition ${skill.lifecycle} → ${to} for skill ${id}`
    );
  }
  // §19: only VALIDATING → ACTIVE requires proof of validation.
  if (to === "ACTIVE") {
    const validated = opts.validated ?? Boolean(skill.last_validated);
    if (!validated) {
      throw new SkillLifecycleError(
        `skill ${id} cannot become ACTIVE without regression validation`
      );
    }
  }
  const now = new Date().toISOString();
  getDb()
    .prepare("UPDATE agent_skills SET lifecycle = ?, updated_at = ? WHERE id = ?")
    .run(to, now, id);
  return getSkillById(id)!;
}

/** Mark a skill as regression-validated (sets last_validated). */
export function markSkillValidated(id: string): SkillRecord {
  const skill = getSkillById(id);
  if (!skill) throw new SkillLifecycleError(`unknown skill: ${id}`);
  const now = new Date().toISOString();
  getDb()
    .prepare("UPDATE agent_skills SET last_validated = ?, updated_at = ? WHERE id = ?")
    .run(now, now, id);
  return getSkillById(id)!;
}

/** Record a skill execution — feeds success_rate (§18). */
export function recordSkillRun(
  skill_id: string,
  success: boolean,
  execution_id?: string,
  detail?: string
): void {
  ensureAgentInfraTables();
  const db = getDb();
  db.prepare("INSERT INTO skill_runs (skill_id, execution_id, success, detail) VALUES (?, ?, ?, ?)")
    .run(skill_id, execution_id ?? null, success ? 1 : 0, detail ?? null);
  const column = success ? "success_count" : "failure_count";
  db.prepare(`UPDATE agent_skills SET ${column} = ${column} + 1, updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), skill_id);
}

/** Only ACTIVE skills may drive production behavior. */
export function isSkillActive(id: string): boolean {
  const skill = getSkillById(id);
  return skill?.lifecycle === "ACTIVE";
}
