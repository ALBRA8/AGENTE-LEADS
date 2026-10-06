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
