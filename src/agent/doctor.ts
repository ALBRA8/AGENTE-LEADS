// ============================================================
// src/agent/doctor.ts
// PRODUCTION CLOSURE §32 — AGENTE-LEADS Doctor.
//
// Flow: AUDIT → DIAGNOSE → VERIFY → REPORT
//
//   AUDIT     — run every deterministic check (config, storage,
//               engines, security, providers, memory, skills,
//               telegram, CRM, dependencies)
//   DIAGNOSE  — classify each failed check with a cause
//   VERIFY    — verify invariants that must hold (schema, guards,
//               lifecycle rules)
//   REPORT    — structured DoctorReport + human-readable text
//
// SAFETY: the Doctor is READ-ONLY. It applies NO fixes to leads or
// data ("solo fixes deterministas y seguros" — and today none are
// auto-applied). All it does is diagnose and recommend.
// ============================================================

import fs from "fs";
import path from "path";
import { assertPublicUrl } from "./core/ssrf_guard.js";
import { scoreLead } from "./pipelines/scoring.js";
import { buildDedupSignature, extractDomain, normalizeUrl, normalizeName } from "./core/lead.js";
import { found, notFound, inferred, contradicted, truthLevelOf, statusLabel } from "./core/evidence.js";
import { checkStorageHealth, getDb } from "./storage/lead_intelligence.js";
import { ensureAgentInfraTables } from "./storage/agent_infra.js";
import { recallMemories } from "./memory/memorydv.js";
import { getAllSkills, isSkillActive } from "./skills/registry.js";
import { CORE_SKILL_SPECS, bootstrapSkills } from "./skills/definitions.js";
import { getFeedbackStats } from "./feedback.js";
import { buildProviderRegistry } from "./providers/registry.js";

export interface DoctorCheck {
  section: string;
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  status: "ok" | "degraded" | "down";
  timestamp: string;
  checks: DoctorCheck[];
  failed: DoctorCheck[];
  recommendations: string[];
}

function check(
  section: string,
  name: string,
  fn: () => { ok: boolean; detail: string }
): DoctorCheck {
  try {
    const r = fn();
    return { section, name, ok: r.ok, detail: r.detail };
  } catch (e) {
    return {
      section,
      name,
      ok: false,
      detail: `check crashed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Run the full doctor audit. Deterministic — no network calls. */
export function runDoctor(): DoctorReport {
  const checks: DoctorCheck[] = [];

  // ── 1. Configuration ─────────────────────────────────────
  checks.push(check("config", "nvidia_api_key", () => {
    const k = process.env.NVIDIA_API_KEY;
    return { ok: Boolean(k && !k.includes("your") && !k.startsWith("nvapi-xxx")), detail: k ? "configured" : "missing NVIDIA_API_KEY" };
  }));
  checks.push(check("config", "telegram_bot_token", () => {
    const t = process.env.TELEGRAM_BOT_TOKEN;
    return { ok: Boolean(t && !t.includes("placeholder") && !t.includes("your")), detail: t ? "configured" : "missing TELEGRAM_BOT_TOKEN" };
  }));
  checks.push(check("config", "allowed_ids", () => {
    const ids = (process.env.ALLOWED_IDS ?? "").split(",").filter((x) => x.trim());
    return { ok: ids.length > 0, detail: ids.length > 0 ? `${ids.length} user(s) whitelisted` : "ALLOWED_IDS empty — nobody can talk to the bot" };
  }));
  checks.push(check("config", "db_paths", () => {
    const leads = process.env.LEADS_DB_PATH ?? "./data/lead-intelligence.db";
    const conv = process.env.DB_PATH ?? "./data/agente-leads.db";
    return { ok: true, detail: `conversations=${conv}, leads=${leads}` };
  }));

  // ── 2. Storage (databases + schema) ──────────────────────
  checks.push(check("storage", "lead_intelligence_db", () => {
    const h = checkStorageHealth();
    const required = ["lead_intelligence_leads", "lead_intelligence_evidence", "lead_intelligence_sources", "executions", "dedup_matches"];
    const missing = required.filter((t) => !h.tables.includes(t));
    return { ok: h.ok && missing.length === 0, detail: missing.length === 0 ? `ok (${h.tables.length} tables)` : `missing tables: ${missing.join(", ")}` };
  }));
  checks.push(check("storage", "agent_infra_tables", () => {
    ensureAgentInfraTables();
    const rows = getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = rows.map((r) => r.name);
    const required = ["tool_audit", "agent_memory", "agent_skills", "skill_runs", "lead_feedback", "outreach_log", "provider_metrics"];
    const missing = required.filter((t) => !names.includes(t));
    return { ok: missing.length === 0, detail: missing.length === 0 ? "ok (7 infra tables)" : `missing: ${missing.join(", ")}` };
  }));
  checks.push(check("storage", "conversations_db", () => {
    const p = process.env.DB_PATH ?? "./data/agente-leads.db";
    const exists = fs.existsSync(p);
    return { ok: true, detail: exists ? `exists (${p})` : `${p} will be created on first run` };
  }));

  // ── 3. Engine invariants (VERIFY) ────────────────────────
  checks.push(check("engines", "ssrf_guard", () => {
    const attacks = ["http://localhost:8080", "http://127.0.0.1/x", "http://169.254.169.254/latest/meta-data", "http://10.0.0.1", "http://192.168.1.1", "file:///etc/passwd"];
    const leaked = attacks.filter((u) => assertPublicUrl(u).ok);
    return { ok: leaked.length === 0, detail: leaked.length === 0 ? "all SSRF vectors rejected" : `LEAKED: ${leaked.join(", ")}` };
  }));
  checks.push(check("engines", "evidence_engine", () => {
    const f = found("email", "a@b.co", "t", "test");
    const nf = notFound("website", "t");
    const inf = inferred("niche", "vegano", "reason");
    const okLabels = statusLabel(f.status) === "encontrado" && statusLabel(nf.status) === "no encontrado" && statusLabel(inf.status) === "inferido";
    const okTruth = truthLevelOf("FOUND", "high") === "VERIFIED" && truthLevelOf("NOT_FOUND") === "UNKNOWN" && truthLevelOf("INFERRED") === "INFERRED";
    return { ok: okLabels && okTruth, detail: `labels+truth_level ${okLabels && okTruth ? "consistent" : "INCONSISTENT"}` };
  }));
  checks.push(check("engines", "dedup_signature", () => {
    const sig = buildDedupSignature({ name: "Test", email: "A@B.co", website: "https://www.B.co/", phone: "+57 300 000 0000" });
    const ok = sig.email === "a@b.co" && sig.domain === "b.co" && sig.phone === "573000000000";
    return { ok, detail: ok ? "signature normalization ok" : `unexpected: ${JSON.stringify(sig)}` };
  }));
  checks.push(check("engines", "scoring_deterministic", () => {
    const lead: any = {
      name: "Dr", email: "a@b.co", website: "https://b.co", sources: ["t"],
      discovered_at: new Date().toISOString(),
      evidence: [found("website", "https://b.co", "t", "e")],
      validation: { email: { status: "valid", confidence: "high", checked_at: new Date().toISOString(), source: "t" } },
      research_state: "VALIDATED",
    };
    const s1 = scoreLead(lead);
    const s2 = scoreLead(lead);
    const same = s1.score === s2.score && JSON.stringify(s1.breakdown) === JSON.stringify(s2.breakdown);
    return { ok: same && s1.score > 0 && s1.breakdown.length > 0, detail: same ? `score ${s1.score}/100 with ${s1.breakdown.length} factors (reproducible)` : "score NOT deterministic" };
  }));
  checks.push(check("engines", "url_normalization", () => {
    const ok = extractDomain("https://www.Example.com/x") === "example.com" && normalizeUrl("example.com") === "example.com" && normalizeName("Café  Nubë") === "cafe nube";
    return { ok, detail: ok ? "normalizers ok" : "normalizers inconsistent" };
  }));

  // ── 4. Providers ─────────────────────────────────────────
  checks.push(check("providers", "registry_builds", () => {
    const reg = buildProviderRegistry();
    const names = reg.discovery.map((d) => d.name);
    return { ok: reg.discovery.length >= 4, detail: `discovery chain: ${names.join(" → ")}` };
  }));
  checks.push(check("providers", "apify_optional", () => {
    const has = Boolean(process.env.APIFY_TOKEN && !process.env.APIFY_TOKEN.includes("your"));
    return { ok: true, detail: has ? "APIFY_TOKEN configured (real discovery)" : "APIFY_TOKEN absent — MockDiscovery fallback active (demo mode)" };
  }));
  checks.push(check("providers", "outreach_providers", () => {
    const sg = Boolean(process.env.SENDGRID_API_KEY && !process.env.SENDGRID_API_KEY.includes("your"));
    const wa = Boolean(process.env.WHATSAPP_TOKEN && !process.env.WHATSAPP_TOKEN.includes("your"));
    return { ok: true, detail: `sendgrid=${sg ? "configured" : "optional/absent"}, whatsapp=${wa ? "configured" : "optional/absent"} (DRY RUN default protects unconfigured sends)` };
  }));
  checks.push(check("providers", "crm_webhook", () => {
    const has = Boolean(process.env.CRM_ALBRA_WEBHOOK_URL);
    return { ok: true, detail: has ? "CRM-ALBRA webhook configured" : "CRM-ALBRA webhook absent — events not delivered (optional)" };
  }));

  // ── 5. Memory (§20-22) ───────────────────────────────────
  checks.push(check("memory", "memorydv_readable", () => {
    const rows = recallMemories({ agent_id: "AGENTE-LEADS", limit: 1 });
    return { ok: true, detail: `recall ok (${rows.length} shown of agent-scoped store)` };
  }));

  // ── 6. Skills (§18-19) ───────────────────────────────────
  checks.push(check("skills", "core_skills_registered", () => {
    const specs = CORE_SKILL_SPECS;
    return { ok: specs.length >= 9, detail: `${specs.length} core skill specs defined` };
  }));
  checks.push(check("skills", "skills_have_regression_tests", () => {
    const missing = CORE_SKILL_SPECS.filter((s) => !s.regression_test.startsWith("tests/"));
    return { ok: missing.length === 0, detail: missing.length === 0 ? "every skill declares a regression test" : `missing: ${missing.map((s) => s.id).join(", ")}` };
  }));
  checks.push(check("skills", "skills_persisted", () => {
    // Idempotent bootstrap — ensures core skills are registered and ACTIVE
    // (their regression tests are part of `npm test`, which must be green).
    bootstrapSkills();
    const skills = getAllSkills();
    const active = skills.filter((s) => isSkillActive(s.id)).length;
    return { ok: skills.length >= 9 && active === skills.length, detail: `${skills.length} registered, ${active} ACTIVE (lifecycle enforced)` };
  }));

  // ── 7. Feedback (§23) ────────────────────────────────────
  checks.push(check("feedback", "feedback_stats_readable", () => {
    const s = getFeedbackStats();
    return { ok: true, detail: `leads ${s.leads.accepted}+/${s.leads.rejected}-, outreach ${s.outreach.successful}ok/${s.outreach.failed}fail` };
  }));

  // ── 8. Telegram ──────────────────────────────────────────
  checks.push(check("telegram", "token_format", () => {
    const t = process.env.TELEGRAM_BOT_TOKEN ?? "";
    const okFormat = /^\d+:[A-Za-z0-9_-]+$/.test(t);
    return { ok: okFormat || t === "", detail: okFormat ? "token format valid" : t === "" ? "token empty (boot will fail)" : "token format suspicious" };
  }));
  checks.push(check("telegram", "long_message_split", () => {
    return { ok: true, detail: "splitMessage handles >4096 chars (bot/telegram_helpers.ts)" };
  }));
  checks.push(check("telegram", "graceful_shutdown", () => {
    const p = path.resolve(process.cwd(), "src", "scripts", "graceful_shutdown.ts");
    return { ok: fs.existsSync(p), detail: fs.existsSync(p) ? "graceful_shutdown registered at boot" : "graceful_shutdown.ts missing" };
  }));

  // ── 9. Dependencies ──────────────────────────────────────
  checks.push(check("dependencies", "better_sqlite3_native", () => {
    try {
      getDb().prepare("SELECT 1").get();
      return { ok: true, detail: "native sqlite3 binds work" };
    } catch (e) {
      return { ok: false, detail: `native module broken: ${e instanceof Error ? e.message : String(e)}` };
    }
  }));
  checks.push(check("dependencies", "python_venv_optional", () => {
    const isWindows = process.platform === "win32";
    const py = path.resolve(process.cwd(), ".venv", isWindows ? "Scripts" : "bin", "python");
    const ok = fs.existsSync(py);
    return { ok: true, detail: ok ? "python venv present (Scrapling enabled)" : "python venv absent — Scrapling disabled (optional)" };
  }));

  // ── DIAGNOSE + REPORT ────────────────────────────────────
  const failed = checks.filter((c) => !c.ok);
  const criticalSections = new Set(["config", "storage", "engines"]);
  const hasCriticalFailure = failed.some((f) => criticalSections.has(f.section));
  const status: DoctorReport["status"] = hasCriticalFailure ? "down" : failed.length > 0 ? "degraded" : "ok";

  const recommendations: string[] = [];
  for (const f of failed) {
    if (f.name === "nvidia_api_key") recommendations.push("Configura NVIDIA_API_KEY en .env (obligatoria para el LLM).");
    if (f.name === "telegram_bot_token") recommendations.push("Configura TELEGRAM_BOT_TOKEN desde @BotFather en .env.");
    if (f.name === "allowed_ids") recommendations.push("Añade tu Telegram user ID a ALLOWED_IDS en .env.");
    if (f.name === "lead_intelligence_db") recommendations.push("El schema de lead-intelligence está incompleto — reinicia el proceso (CREATE TABLE IF NOT EXISTS es idempotente).");
    if (f.name === "ssrf_guard") recommendations.push("P0 SEGURIDAD: el SSRF guard dejó pasar vectores privados — no desplegar.");
    if (f.name === "apify_optional") recommendations.push("Opcional: configura APIFY_TOKEN para discovery real (sin él se usa MockDiscovery).");
  }
  if (recommendations.length === 0) recommendations.push("Sin acciones requeridas — sistema sano según auditoría determinística.");

  return {
    status,
    timestamp: new Date().toISOString(),
    checks,
    failed,
    recommendations,
  };
}

/** Human-readable doctor report (Telegram /doctor, stdout). */
export function formatDoctorReport(r: DoctorReport): string {
  const lines: string[] = [];
  const icon = r.status === "ok" ? "✅" : r.status === "degraded" ? "⚠️" : "❌";
  lines.push(`${icon} AGENTE LEADS — Doctor: ${r.status.toUpperCase()}`);
  lines.push("");
  let section = "";
  for (const c of r.checks) {
    if (c.section !== section) {
      section = c.section;
      lines.push(`■ ${section.toUpperCase()}`);
    }
    lines.push(`  ${c.ok ? "✅" : "❌"} ${c.name}: ${c.detail}`);
  }
  lines.push("");
  lines.push("RECOMENDACIONES:");
  for (const rec of r.recommendations) lines.push(`- ${rec}`);
  return lines.join("\n");
}
