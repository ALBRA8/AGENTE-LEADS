// ============================================================
// src/agent/pipelines/quality.ts
// P1.4 — Quality metrics per provider
//
// Tracks per-provider:
//   - total calls attempted
//   - successful calls (ok=true)
//   - failure breakdown by error type
//   - average latency
//   - success rate (0-100%)
//
// Stored in the executions table (as part of ExecutionTrace) or
// persisted to a separate `provider_metrics` table for historical
// analysis. For P1.4 we just compute and expose the metrics — no
// sophisticated ML.
// ============================================================

import type { ExecutionTrace } from "../core/execution.js";
import { ensureAgentInfraTables } from "../storage/agent_infra.js";
import { getDb } from "../storage/lead_intelligence.js";

export interface ProviderMetric {
  provider: string;
  total_calls: number;
  successful_calls: number;
  failed_calls: number;
  failure_breakdown: Record<string, number>;  // error_type → count
  avg_latency_ms: number;
  success_rate: number;  // 0-100
}

/**
 * Compute per-provider metrics from a completed execution trace.
 */
export function computeProviderMetrics(trace: ExecutionTrace): ProviderMetric[] {
  const byProvider = new Map<string, {
    total: number;
    success: number;
    failed: number;
    failures: Record<string, number>;
    durations: number[];
  }>();

  for (const step of trace.steps) {
    if (!step.provider) continue;
    const m = byProvider.get(step.provider) ?? {
      total: 0, success: 0, failed: 0, failures: {}, durations: []
    };
    m.total++;
    if (step.status === "ok") {
      m.success++;
    } else if (step.status === "failed") {
      m.failed++;
      const errType = step.error_type ?? "UNKNOWN";
      m.failures[errType] = (m.failures[errType] ?? 0) + 1;
    }
    if (step.duration_ms !== undefined) {
      m.durations.push(step.duration_ms);
    }
    byProvider.set(step.provider, m);
  }

  const metrics: ProviderMetric[] = [];
  for (const [provider, m] of byProvider.entries()) {
    const avg = m.durations.length > 0
      ? m.durations.reduce((a, b) => a + b, 0) / m.durations.length
      : 0;
    metrics.push({
      provider,
      total_calls: m.total,
      successful_calls: m.success,
      failed_calls: m.failed,
      failure_breakdown: m.failures,
      avg_latency_ms: Math.round(avg * 100) / 100,
      success_rate: m.total > 0 ? Math.round((m.success / m.total) * 100) : 0,
    });
  }

  // Sort by total calls descending
  metrics.sort((a, b) => b.total_calls - a.total_calls);
  return metrics;
}

/**
 * Format metrics as a human-readable table for the report.
 */
export function formatProviderMetrics(metrics: ProviderMetric[]): string {
  if (metrics.length === 0) return "No provider calls recorded.";
  const lines: string[] = [];
  lines.push("| Provider | Total | OK | Fail | Success% | Avg ms | Top failure |");
  lines.push("|----------|-------|----|------|----------|--------|--------------|");
  for (const m of metrics) {
    const topFailure = Object.entries(m.failure_breakdown)
      .sort((a, b) => b[1] - a[1])[0];
    const topFailureStr = topFailure ? `${topFailure[0]} (${topFailure[1]})` : "—";
    lines.push(
      `| ${m.provider} | ${m.total_calls} | ${m.successful_calls} | ${m.failed_calls} | ${m.success_rate}% | ${m.avg_latency_ms} | ${topFailureStr} |`
    );
  }
  return lines.join("\n");
}

// ── §14 — Persistence + degradation detection ──────────────────

/**
 * Persist the metrics of a completed trace into provider_metrics
 * (historical analysis). usable_results = steps that produced output.
 */
export function persistProviderMetrics(trace: ExecutionTrace, metrics?: ProviderMetric[]): void {
  ensureAgentInfraTables();
  const computed = metrics ?? computeProviderMetrics(trace);
  const stmt = getDb().prepare(`
    INSERT INTO provider_metrics
      (provider, execution_id, requests, success_rate, failure_rate, avg_latency_ms, usable_results, failure_breakdown)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const m of computed) {
    stmt.run(
      m.provider,
      trace.id,
      m.total_calls,
      m.success_rate,
      100 - m.success_rate,
      m.avg_latency_ms,
      trace.steps.filter((s) => s.provider === m.provider && s.status === "ok" && s.output).length,
      JSON.stringify(m.failure_breakdown)
    );
  }
}

export interface ProviderDegradation {
  provider: string;
  window_requests: number;
  window_success_rate: number;
  degraded: boolean;
}

/**
 * Decide whether a provider is degraded over its recent history.
 * Deterministic rule: weighted success_rate < threshold on the last N records.
 */
export function isProviderDegraded(
  provider: string,
  opts: { window?: number; threshold?: number } = {}
): ProviderDegradation {
  ensureAgentInfraTables();
  const window = opts.window ?? 10;
  const threshold = opts.threshold ?? 50; // %
  const rows = getDb()
    .prepare(
      "SELECT success_rate, requests FROM provider_metrics WHERE provider = ? ORDER BY recorded_at DESC, id DESC LIMIT ?"
    )
    .all(provider, window) as { success_rate: number; requests: number }[];

  if (rows.length === 0) {
    return { provider, window_requests: 0, window_success_rate: 100, degraded: false };
  }
  const totalRequests = rows.reduce((s, r) => s + r.requests, 0);
  const weighted =
    totalRequests > 0
      ? rows.reduce((s, r) => s + r.success_rate * r.requests, 0) / totalRequests
      : rows.reduce((s, r) => s + r.success_rate, 0) / rows.length;
  return {
    provider,
    window_requests: totalRequests,
    window_success_rate: Math.round(weighted * 100) / 100,
    degraded: weighted < threshold,
  };
}
