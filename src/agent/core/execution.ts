// ============================================================
// src/agent/core/execution.ts
// P0.11 — Observability / ExecutionTrace.
//
// Each pipeline execution records:
//   - what it tried to do
//   - which provider it used
//   - what it found
//   - what failed
//   - what was validated
//   - what was stored
//   - how long each step took
//
// Not a dashboard. Just enough structured trace to debug a real run.
// ============================================================

export type StepStatus = "started" | "ok" | "failed" | "skipped";

export interface ExecutionStep {
  /** Step name e.g. "discovery.apify", "research.scrapling.fetch", "validation.email" */
  name: string;
  status: StepStatus;
  /** When the step started (ISO 8601) */
  started_at: string;
  /** When the step ended (ISO 8601) — undefined if still running */
  ended_at?: string;
  /** Duration in ms (ended_at - started_at) */
  duration_ms?: number;
  /** Provider used, if any */
  provider?: string;
  /** What the step tried to do */
  intent?: string;
  /** Inputs that mattered (JSON-serializable) */
  input?: Record<string, unknown>;
  /** What was found/produced (summary) */
  output?: string;
  /** What failed (normalized error if any) */
  error_type?: string;
  error_message?: string;
}

export interface ExecutionTrace {
  id: string;
  /** What the user asked for (verbatim) */
  user_request: string;
  /** Parsed intent */
  parsed_intent?: Record<string, unknown>;
  /** When the execution started */
  started_at: string;
  /** When the execution ended */
  ended_at?: string;
  /** Total duration in ms */
  total_duration_ms?: number;
  /** All steps in order */
  steps: ExecutionStep[];
  /** Final summary — short text */
  summary?: string;
  /** Outcome: success / partial / failed */
  outcome: "success" | "partial" | "failed" | "in_progress";
}

export class ExecutionRecorder {
  private trace: ExecutionTrace;

  constructor(userRequest: string, parsedIntent?: Record<string, unknown>) {
    this.trace = {
      id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      user_request: userRequest,
      parsed_intent: parsedIntent,
      started_at: new Date().toISOString(),
      steps: [],
      outcome: "in_progress",
    };
  }

  /**
   * Begin a step. Returns a function to call when the step ends.
   * Usage:
   *   const end = trace.start("discovery.apify", { provider: "Apify", intent: "search vegan restaurants in Medellín" });
   *   try { ...; end({ output: "12 candidates" }); }
   *   catch (e) { end({ error: e }); throw e; }
   */
  start(
    name: string,
    opts: { provider?: string; intent?: string; input?: Record<string, unknown> } = {}
  ): (endOpts?: { output?: string; error?: unknown; status?: StepStatus }) => void {
    const step: ExecutionStep = {
      name,
      status: "started",
      started_at: new Date().toISOString(),
      provider: opts.provider,
      intent: opts.intent,
      input: opts.input,
    };
    this.trace.steps.push(step);
    return (endOpts = {}) => {
      step.ended_at = new Date().toISOString();
      step.duration_ms = new Date(step.ended_at).getTime() - new Date(step.started_at).getTime();
      if (endOpts.error) {
        const err = endOpts.error;
        step.status = "failed";
        if (typeof err === "object" && err !== null && "type" in err) {
          step.error_type = (err as any).type;
          step.error_message = (err as any).message;
        } else {
          step.error_type = "UNKNOWN";
          step.error_message = err instanceof Error ? err.message : String(err);
        }
      } else {
        step.status = endOpts.status ?? "ok";
        if (endOpts.output) step.output = endOpts.output;
      }
    };
  }

  /** Mark a step that was intentionally skipped (e.g. fallback not needed) */
  skip(name: string, reason: string, opts: { provider?: string; intent?: string } = {}): void {
    const step: ExecutionStep = {
      name,
      status: "skipped",
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: 0,
      provider: opts.provider,
      intent: opts.intent,
      output: reason,
    };
    this.trace.steps.push(step);
  }

  finish(outcome: "success" | "partial" | "failed", summary?: string): ExecutionTrace {
    this.trace.ended_at = new Date().toISOString();
    this.trace.total_duration_ms = new Date(this.trace.ended_at).getTime() - new Date(this.trace.started_at).getTime();
    this.trace.outcome = outcome;
    if (summary) this.trace.summary = summary;
    return this.trace;
  }

  getTrace(): ExecutionTrace {
    return this.trace;
  }
}
