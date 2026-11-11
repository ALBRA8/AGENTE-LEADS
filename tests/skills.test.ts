// ============================================================
// tests/skills.test.ts — PRODUCTION CLOSURE §18-19
// Skills: specification, lifecycle, regression, success-rate.
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, cleanupTestEnv } from "./setup.js";
import {
  registerSkill,
  getSkillById,
  getAllSkills,
  transitionSkill,
  markSkillValidated,
  recordSkillRun,
  isSkillActive,
  SkillLifecycleError,
} from "../src/agent/skills/registry.js";
import { CORE_SKILL_SPECS, bootstrapSkills } from "../src/agent/skills/definitions.js";
import { canTransition, SKILL_LIFECYCLE_TRANSITIONS, type SkillSpec } from "../src/agent/skills/types.js";

function fakeSpec(id: string): SkillSpec {
  return {
    id,
    name: `Skill ${id}`,
    purpose: "test purpose",
    trigger: "on test",
    prerequisites: [],
    procedure: [{ order: 1, action: "do it", realized_by: "test" }],
    tools_required: [],
    expected_result: "ok",
    verification: "assert ok",
    pitfalls: ["none"],
    evidence_behavior: "none",
    version: "1.0.0",
    confidence: "high",
    origin: "tests",
    regression_test: "tests/skills.test.ts",
  };
}

test("skills: all 9 core skills are defined with complete §18 spec", () => {
  assert.ok(CORE_SKILL_SPECS.length >= 9);
  const required = [
    "lead_discovery", "company_research", "contact_research", "lead_validation",
    "evidence_collection", "deduplication", "qualification", "scoring", "outreach_preparation",
  ];
  for (const r of required) {
    assert.ok(CORE_SKILL_SPECS.some((s) => s.id.endsWith(r)), `missing skill: ${r}`);
  }
  for (const s of CORE_SKILL_SPECS) {
    // §18 contract fields
    assert.ok(s.id && s.name && s.purpose && s.trigger, `${s.id} missing identity fields`);
    assert.ok(s.procedure.length > 0, `${s.id} missing procedure`);
    assert.ok(s.verification, `${s.id} missing verification`);
    assert.ok(s.pitfalls.length > 0, `${s.id} missing pitfalls`);
    assert.ok(s.regression_test.startsWith("tests/"), `${s.id} missing regression test`);
    assert.ok(s.version && s.confidence && s.origin, `${s.id} missing version/confidence/origin`);
  }
});

test("skills: lifecycle transitions follow the state machine", () => {
  assert.equal(canTransition("PROPOSED", "VALIDATING"), true);
  assert.equal(canTransition("VALIDATING", "ACTIVE"), true);
  assert.equal(canTransition("ACTIVE", "DEPRECATED"), true);
  assert.equal(canTransition("DEPRECATED", "RETIRED"), true);
  assert.equal(canTransition("PROPOSED", "ACTIVE"), false); // must validate first
  assert.equal(canTransition("ACTIVE", "PROPOSED"), false);
  assert.equal(canTransition("RETIRED", "ACTIVE"), false);
  assert.equal(SKILL_LIFECYCLE_TRANSITIONS.RETIRED.length, 0);
});

test("skills: new registration starts as PROPOSED and cannot jump to ACTIVE", () => {
  setupTestEnv();
  try {
    const skill = registerSkill(fakeSpec("skill.test_jump"));
    assert.equal(skill.lifecycle, "PROPOSED");
    assert.throws(() => transitionSkill("skill.test_jump", "ACTIVE"), SkillLifecycleError);
  } finally {
    cleanupTestEnv();
  }
});

test("skills: VALIDATING → ACTIVE requires validation proof", () => {
  setupTestEnv();
  try {
    registerSkill(fakeSpec("skill.test_validate"));
    transitionSkill("skill.test_validate", "VALIDATING");
    // Without markSkillValidated → rejected
    assert.throws(
      () => transitionSkill("skill.test_validate", "ACTIVE", { validated: false }),
      SkillLifecycleError
    );
    // With validation → allowed
    markSkillValidated("skill.test_validate");
    const active = transitionSkill("skill.test_validate", "ACTIVE", { validated: true });
    assert.equal(active.lifecycle, "ACTIVE");
    assert.ok(isSkillActive("skill.test_validate"));
  } finally {
    cleanupTestEnv();
  }
});

test("skills: recordSkillRun updates success_rate", () => {
  setupTestEnv();
  try {
    bootstrapSkills();
    const id = "skill.lead_discovery";
    recordSkillRun(id, true);
    recordSkillRun(id, true);
    recordSkillRun(id, false);
    const s = getSkillById(id)!;
    assert.equal(s.success_count, 2);
    assert.equal(s.failure_count, 1);
    assert.ok(Math.abs(s.success_rate - 2 / 3) < 1e-9);
  } finally {
    cleanupTestEnv();
  }
});

test("skills: bootstrapSkills is idempotent and activates all core skills", () => {
  setupTestEnv();
  try {
    const n = bootstrapSkills();
    assert.equal(n, CORE_SKILL_SPECS.length);
    bootstrapSkills(); // second run must not duplicate or downgrade
    const all = getAllSkills();
    assert.equal(all.length, CORE_SKILL_SPECS.length);
    for (const s of all) {
      assert.equal(s.lifecycle, "ACTIVE", `${s.id} should be ACTIVE`);
      assert.ok(s.last_validated, `${s.id} should be validated`);
    }
  } finally {
    cleanupTestEnv();
  }
});

test("skills: version bump resets lifecycle to PROPOSED (no silent upgrades)", () => {
  setupTestEnv();
  try {
    const spec = fakeSpec("skill.test_version");
    registerSkill(spec);
    markSkillValidated("skill.test_version");
    transitionSkill("skill.test_version", "VALIDATING");
    transitionSkill("skill.test_version", "ACTIVE", { validated: true });
    assert.ok(isSkillActive("skill.test_version"));

    // New version → back to PROPOSED (must re-validate)
    registerSkill({ ...spec, version: "1.1.0" });
    const updated = getSkillById("skill.test_version")!;
    assert.equal(updated.version, "1.1.0");
    assert.equal(updated.lifecycle, "PROPOSED");
    assert.equal(isSkillActive("skill.test_version"), false);
  } finally {
    cleanupTestEnv();
  }
});
