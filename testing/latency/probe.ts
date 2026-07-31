// Live probe of our own tool server.
//
// This is the one part of the pipeline we own, and the only stage the mock
// cannot honestly estimate: it depends on the deployment region, the Redis
// round trip and whether the handler dials the next worker before replying.
// Point it at a running dev server or at the Vercel URL.

import { endOfCallEnvelope, toolCallEnvelope } from "./fixtures.ts";
import { percentile } from "./timeline.ts";

export interface ProbeResult {
  url: string;
  samples: number;
  p50: number;
  p95: number;
  max: number;
  min: number;
  statuses: Record<number, number>;
  /** True when at least one response carried the toolCallId reply Vapi needs. */
  repliedWithToolResult: boolean;
  errors: string[];
}

export interface ProbeOptions {
  url: string;
  samples?: number;
  workerId?: string;
  attemptId?: string;
  /**
   * Which payload to time. `decline` is the expensive one: it is the path that
   * advances the queue and, today, dials the next worker.
   */
  payload?: "accept" | "decline" | "clarify" | "end-of-call";
}

function buildBody(options: ProbeOptions): unknown {
  const workerId = options.workerId ?? "worker_probe";
  const attemptId = options.attemptId ?? "att_probe";

  switch (options.payload ?? "decline") {
    case "accept":
      return toolCallEnvelope({ workerId, attemptId, toolName: "accept_shift" });
    case "clarify":
      return toolCallEnvelope({ workerId, attemptId, toolName: "needs_clarification" });
    case "end-of-call":
      return endOfCallEnvelope("call_probe_0001");
    default:
      return toolCallEnvelope({ workerId, attemptId, toolName: "decline_shift" });
  }
}

/**
 * Sends the same payload N times, sequentially. Sequential on purpose: Vapi
 * sends one tool call at a time per call, and firing them in parallel would
 * measure contention we do not actually have.
 */
export async function probeToolServer(options: ProbeOptions): Promise<ProbeResult> {
  const samples = options.samples ?? 10;
  const body = JSON.stringify(buildBody(options));
  const durations: number[] = [];
  const statuses: Record<number, number> = {};
  const errors: string[] = [];
  let repliedWithToolResult = false;

  for (let i = 0; i < samples; i += 1) {
    const started = performance.now();
    try {
      const response = await fetch(options.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const text = await response.text();
      durations.push(Math.round(performance.now() - started));
      statuses[response.status] = (statuses[response.status] ?? 0) + 1;
      if (text.includes("toolCallId")) repliedWithToolResult = true;
    } catch (error) {
      durations.push(Math.round(performance.now() - started));
      errors.push(String(error));
    }
  }

  return {
    url: options.url,
    samples,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    max: durations.length ? Math.max(...durations) : 0,
    min: durations.length ? Math.min(...durations) : 0,
    statuses,
    repliedWithToolResult,
    errors,
  };
}

export function formatProbe(result: ProbeResult): string {
  const lines = [
    "",
    `  tool server probe  ${result.url}`,
    `  ${"-".repeat(74)}`,
    `  ${result.samples} samples   p50 ${result.p50}ms   p95 ${result.p95}ms   ` +
      `min ${result.min}ms   max ${result.max}ms`,
    `  statuses: ${Object.entries(result.statuses)
      .map(([status, count]) => `${status} x${count}`)
      .join(", ") || "none"}`,
    `  tool reply returned: ${result.repliedWithToolResult ? "yes" : "no"}`,
  ];

  if (result.errors.length) {
    lines.push(`  errors: ${[...new Set(result.errors)].join("; ")}`);
  }

  // The assistant is silent for this entire window, on top of the model and
  // voice latency of the closing line.
  if (result.p50 > 250) {
    lines.push("");
    lines.push(
      `  OVER BUDGET: the worker hears ${result.p50}ms of dead air before the ` +
        `closing line even starts generating.`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
