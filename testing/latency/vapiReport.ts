// Ground truth from a call that actually happened.
//
// Vapi keeps a per-message transcript with start and end timestamps. The gap
// between a worker's last word and the assistant's first word is the latency
// the worker actually felt, so this is what the mock should be calibrated
// against — and the only honest way to check that a change helped.

import { buildReport, percentile, type TurnTimeline } from "./timeline.ts";

const VAPI_BASE_URL = "https://api.vapi.ai";

interface VapiMessage {
  role?: string;
  message?: string;
  time?: number;
  endTime?: number;
  secondsFromStart?: number;
  duration?: number;
  toolCalls?: unknown[];
}

interface VapiCall {
  id?: string;
  status?: string;
  endedReason?: string;
  startedAt?: string;
  endedAt?: string;
  costBreakdown?: Record<string, unknown>;
  messages?: VapiMessage[];
  artifact?: { messages?: VapiMessage[] };
}

export interface RealTurn {
  index: number;
  /** Worker's last word -> assistant's first word, in ms. */
  responseMs: number;
  workerSaid: string;
  assistantSaid: string;
  /** Assistant message that carried a tool call. */
  tool: boolean;
}

export interface RealCallAnalysis {
  callId: string;
  status?: string;
  endedReason?: string;
  durationSeconds?: number;
  turns: RealTurn[];
  p50: number;
  p95: number;
  worst: RealTurn | null;
  /**
   * Turns where the assistant started speaking while the worker was still
   * talking — the barge-in failures, visible as overlapping timestamps.
   */
  overlaps: number;
  /**
   * Assistant turns before a decision tool fired. The call is meant to be
   * greet → shift → decision, so anything much above three means it kept
   * reading the script after the worker had already answered.
   */
  turnsToDecision: number | null;
  /** Seconds from the start of the call to the decision tool. */
  secondsToDecision: number | null;
  /** Seconds between the decision and the call actually ending. */
  secondsFromDecisionToHangup: number | null;
}

/** A call that reaches a decision in this many assistant turns is on script. */
export const TURNS_TO_DECISION_BUDGET = 4;
/** Dead air between the decision and the hangup, beyond a short goodbye. */
export const HANGUP_BUDGET_SECONDS = 6;

export async function fetchVapiCall(callId: string, apiKey: string): Promise<VapiCall> {
  const response = await fetch(`${VAPI_BASE_URL}/call/${callId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`vapi ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as VapiCall;
}

function truncate(value: string | undefined, width = 44): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

/**
 * Walks the transcript pairing each worker message with the assistant reply
 * that follows it. Messages without timestamps (older calls, or a provider that
 * did not report them) are skipped rather than guessed at.
 */
export function analyzeCall(call: VapiCall): RealCallAnalysis {
  const messages = call.artifact?.messages ?? call.messages ?? [];
  const turns: RealTurn[] = [];
  let overlaps = 0;
  let pendingWorker: VapiMessage | null = null;

  // Where the decision landed, so "did it stop as soon as it had a yes" is a
  // number rather than an impression from listening to the recording.
  let assistantTurns = 0;
  let turnsToDecision: number | null = null;
  let decisionAt: number | null = null;

  for (const message of messages) {
    const role = (message.role ?? "").toLowerCase();

    if (role === "bot" || role === "assistant") {
      assistantTurns += 1;
      const firedTool = Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
      if (firedTool && turnsToDecision === null) {
        turnsToDecision = assistantTurns;
        decisionAt = typeof message.time === "number" ? message.time : null;
      }
    }

    if (role === "user" || role === "customer" || role === "human") {
      pendingWorker = message;
      continue;
    }

    if (role !== "bot" && role !== "assistant") continue;
    if (!pendingWorker) continue;

    const workerEnd = pendingWorker.endTime ?? pendingWorker.time;
    const botStart = message.time;
    if (typeof workerEnd !== "number" || typeof botStart !== "number") {
      pendingWorker = null;
      continue;
    }

    const responseMs = Math.round(botStart - workerEnd);
    if (responseMs < 0) overlaps += 1;

    turns.push({
      index: turns.length,
      responseMs,
      workerSaid: truncate(pendingWorker.message),
      assistantSaid: truncate(message.message),
      tool: Array.isArray(message.toolCalls) && message.toolCalls.length > 0,
    });
    pendingWorker = null;
  }

  // Overlaps are a barge-in symptom, not a response time. Excluding them keeps
  // the percentiles describing "how long did the worker wait".
  const positive = turns.filter((turn) => turn.responseMs >= 0).map((turn) => turn.responseMs);
  const worst = turns.reduce<RealTurn | null>(
    (max, turn) => (max === null || turn.responseMs > max.responseMs ? turn : max),
    null,
  );

  const startedAt = call.startedAt ? new Date(call.startedAt).getTime() : null;
  const endedAt = call.endedAt ? new Date(call.endedAt).getTime() : null;
  const durationSeconds =
    startedAt !== null && endedAt !== null ? Math.round((endedAt - startedAt) / 1000) : undefined;

  const seconds = (from: number | null, to: number | null) =>
    from !== null && to !== null ? Math.round(((to - from) / 1000) * 10) / 10 : null;

  return {
    callId: call.id ?? "unknown",
    status: call.status,
    endedReason: call.endedReason,
    durationSeconds,
    turns,
    p50: percentile(positive, 50),
    p95: percentile(positive, 95),
    worst,
    overlaps,
    turnsToDecision,
    secondsToDecision: seconds(startedAt, decisionAt),
    secondsFromDecisionToHangup: seconds(decisionAt, endedAt),
  };
}

/**
 * Converts real turns into the same TurnTimeline shape the mock produces, so a
 * measured call and a simulated one can be compared with one formatter. The
 * real transcript only exposes the total, so it lands in a single bucket.
 */
export function toTimelines(analysis: RealCallAnalysis): TurnTimeline[] {
  return analysis.turns
    .filter((turn) => turn.responseMs >= 0)
    .map((turn) => ({
      index: turn.index,
      kind: turn.tool ? ("tool" as const) : ("normal" as const),
      // Attributed to llmTtft only because the transcript cannot split it
      // further; the report prints the caveat.
      stages: { llmTtft: turn.responseMs },
      label: turn.workerSaid,
    }));
}

export function formatRealCall(analysis: RealCallAnalysis): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  real call ${analysis.callId}`);
  lines.push(`  ${"-".repeat(74)}`);
  lines.push(
    `  status ${analysis.status ?? "?"}   ended ${analysis.endedReason ?? "?"}   ` +
      `duration ${analysis.durationSeconds ?? "?"}s`,
  );

  if (analysis.turns.length === 0) {
    lines.push("");
    lines.push("  No timestamped worker/assistant pairs in this call's transcript.");
    lines.push("  Nothing was measured; do not read this as a fast call.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    `  ${analysis.turns.length} replies   p50 ${analysis.p50}ms   p95 ${analysis.p95}ms   ` +
      `talk-overs ${analysis.overlaps}`,
  );
  lines.push("");

  for (const turn of analysis.turns) {
    const flag = turn.responseMs < 0 ? "TALK-OVER" : turn.responseMs > 1300 ? "SLOW" : "";
    lines.push(
      `  ${String(turn.index).padStart(2)}  ${`${turn.responseMs}ms`.padStart(8)}  ` +
        `${flag.padEnd(10)}worker: ${turn.workerSaid}`,
    );
  }

  lines.push("");
  lines.push("  conversation shape");
  if (analysis.turnsToDecision === null) {
    lines.push("    no decision tool ever fired on this call");
  } else {
    const overrun =
      analysis.turnsToDecision > TURNS_TO_DECISION_BUDGET
        ? `  OVER (budget ${TURNS_TO_DECISION_BUDGET}) - it kept talking after it had an answer`
        : "";
    lines.push(
      `    decision after ${analysis.turnsToDecision} assistant turns` +
        (analysis.secondsToDecision !== null ? `, ${analysis.secondsToDecision}s in` : "") +
        overrun,
    );
  }
  if (analysis.secondsFromDecisionToHangup !== null) {
    const slow =
      analysis.secondsFromDecisionToHangup > HANGUP_BUDGET_SECONDS
        ? `  OVER (budget ${HANGUP_BUDGET_SECONDS}s) - check silenceTimeoutSeconds and the closing prompt`
        : "";
    lines.push(`    hung up ${analysis.secondsFromDecisionToHangup}s after the decision${slow}`);
  }

  if (analysis.worst) {
    lines.push("");
    lines.push(`  worst reply (${analysis.worst.responseMs}ms) followed: "${analysis.worst.workerSaid}"`);
  }
  if (analysis.overlaps > 0) {
    lines.push(
      `  ${analysis.overlaps} reply/replies started while the worker was still speaking ` +
        `- barge-in is not stopping the assistant in time.`,
    );
  }
  lines.push("");
  lines.push("  Note: a real transcript only exposes the total gap per turn, not the");
  lines.push("  stage split. Use `simulate` for the split and this for the truth.");
  lines.push("");
  return lines.join("\n");
}

/** Report object reusing the shared formatter, for comparison against a stack. */
export function realCallReport(analysis: RealCallAnalysis) {
  return buildReport(`real call ${analysis.callId}`, toTimelines(analysis));
}
