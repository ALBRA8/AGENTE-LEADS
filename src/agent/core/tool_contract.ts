// ============================================================
// src/agent/core/tool_contract.ts
// PRODUCTION CLOSURE §17 — Explicit tool contracts.
//
// Every tool MUST declare:
//   id, name, purpose, input_schema, output_schema,
//   permissions (READ | WRITE | EXTERNAL | SENSITIVE),
//   risk, side_effects, timeout, retry_policy,
//   evidence_behavior, audit_behavior
//
// Enforcement (deterministic, no LLM involvement):
//   - EXTERNAL tools: any argument named in `url_args` is validated
//     through the SSRF guard BEFORE execution.
//   - ALL tools: hard timeout — a hung tool returns a normalized
//     TIMEOUT error instead of freezing the agent loop.
//   - ALL tools: every invocation is appended to tool_audit.
//
// Permission classes:
//   READ      — no state change (safe)
//   WRITE     — mutates local storage
//   EXTERNAL  — performs network I/O (SSRF-guarded)
//   SENSITIVE — performs irreversible external effects (outreach);
//               requires explicit consent gate (dry_run=false)
// ============================================================

import { assertPublicUrl } from "./ssrf_guard.js";
import { makeError, normalizeError } from "./errors.js";
import { recordToolAudit } from "../storage/agent_infra.js";

export type ToolPermission = "READ" | "WRITE" | "EXTERNAL" | "SENSITIVE";

export interface ToolContract {
  id: string;
  name: string;
  purpose: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  permissions: ToolPermission[];
  risk: "low" | "medium" | "high";
  side_effects: string[];
  /** Hard timeout for the whole tool execution (ms) */
  timeout_ms: number;
  retry_policy: { max_attempts: number; backoff: "none" | "exponential" };
  evidence_behavior: string;
  audit_behavior: string;
  /** Arguments that carry a URL and must pass the SSRF guard for EXTERNAL tools */
  url_args?: string[];
}

/** Result of a contracted tool execution. */
export interface ContractedToolResult {
  ok: boolean;
  result: string;
  /** Set when enforcement blocked or timed out the call */
  enforcement?: "timeout" | "ssrf_blocked" | "audit_only";
}

/**
 * Wrap a raw tool executor with contract enforcement.
 * Returns a new execute() function with the same signature.
 */
export function enforceContract(
  contract: ToolContract,
  rawExecute: (args: Record<string, unknown>) => Promise<string>
): (args: Record<string, unknown>) => Promise<string> {
  return async (args: Record<string, unknown>): Promise<string> => {
    const started = Date.now();
    const argsSummary = JSON.stringify(args).slice(0, 300);

    // ── SSRF enforcement for EXTERNAL tools ────────────────
    if (contract.permissions.includes("EXTERNAL") && contract.url_args?.length) {
      for (const argName of contract.url_args) {
        const val = args[argName];
        if (typeof val === "string" && val.length > 0) {
          const check = assertPublicUrl(val);
          if (!check.ok) {
            recordToolAudit({
              tool_name: contract.name,
              args_summary: argsSummary,
              status: "failed",
              error_type: "INVALID_INPUT",
              duration_ms: Date.now() - started,
              execution_note: `SSRF guard rejected ${argName}: ${check.error.message}`,
            });
            return `Error [${contract.name}]: SSRF guard rejected ${argName} — ${check.error.message}`;
          }
        }
      }
    }

    // ── Hard timeout enforcement ───────────────────────────
    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        rawExecute(args),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(makeError("TIMEOUT", `tool ${contract.name} exceeded ${contract.timeout_ms}ms`)),
            contract.timeout_ms
          );
          // Don't keep the event loop alive solely for this timer.
          timeoutHandle.unref?.();
        }),
      ]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      recordToolAudit({
        tool_name: contract.name,
        args_summary: argsSummary,
        status: "ok",
        duration_ms: Date.now() - started,
      });
      return result;
    } catch (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const normalized = normalizeError(err, contract.name);
      recordToolAudit({
        tool_name: contract.name,
        args_summary: argsSummary,
        status: normalized.type === "TIMEOUT" ? "timeout" : "failed",
        error_type: normalized.type,
        duration_ms: Date.now() - started,
        execution_note: normalized.message.slice(0, 300),
      });
      return `Error [${contract.name}] (${normalized.type}): ${normalized.message}`;
    }
  };
}
