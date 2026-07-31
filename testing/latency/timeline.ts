// Turn-latency model.
//
// One "turn" is: the worker stops speaking -> the first byte of the assistant's
// audio reaches the phone. Everything the worker experiences as lag lives in
// that window, so the whole profiler is built around measuring it stage by
// stage rather than reporting a single opaque number.

/** Stages of one assistant turn, in the order they happen. */
export const TURN_STAGES = [
  "endpointing",
  "stt",
  "llmTtft",
  "toolRoundTrip",
  "ttsTtfb",
  "transport",
] as const;

export type TurnStage = (typeof TURN_STAGES)[number];

export const STAGE_LABELS: Record<TurnStage, string> = {
  endpointing: "endpointing (worker stopped?)",
  stt: "stt final transcript",
  llmTtft: "llm time-to-first-token",
  toolRoundTrip: "tool server round trip",
  ttsTtfb: "tts time-to-first-byte",
  transport: "media transport to phone",
};

/**
 * Per-stage ceilings for a call that feels immediate. These are targets, not
 * measurements: the report marks a stage over budget so the next optimisation
 * is obvious instead of being argued about.
 */
export const STAGE_BUDGET_MS: Record<TurnStage, number> = {
  endpointing: 300,
  stt: 150,
  llmTtft: 450,
  toolRoundTrip: 250,
  ttsTtfb: 200,
  transport: 120,
};

/** Perceived-latency bands for the total turn, from conversation research. */
export const TOTAL_TARGET_MS = 900;
export const TOTAL_WARN_MS = 1300;

export type TurnKind = "normal" | "tool";

export interface TurnTimeline {
  index: number;
  kind: TurnKind;
  /** Milliseconds spent in each stage. Absent stages count as zero. */
  stages: Partial<Record<TurnStage, number>>;
  /** Free-form note carried into the report, e.g. which worker utterance. */
  label?: string;
}

export function turnTotal(turn: TurnTimeline): number {
  return TURN_STAGES.reduce((sum, stage) => sum + (turn.stages[stage] ?? 0), 0);
}

/**
 * Nearest-rank percentile. Deliberately not interpolated: with the handful of
 * turns a single call produces, an interpolated p95 invents a number that no
 * turn actually took.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

export interface StageStats {
  stage: TurnStage;
  p50: number;
  p95: number;
  max: number;
  /** Share of the median total turn, 0..1. */
  share: number;
  budget: number;
  overBudget: boolean;
}

export interface LatencyReport {
  name: string;
  turns: number;
  toolTurns: number;
  totalP50: number;
  totalP95: number;
  totalMax: number;
  /** Median turn that did not fire a tool — the ordinary conversational gap. */
  normalTotalP50: number;
  /** Median turn that did fire a tool. Zero when the call had none. */
  toolTotalP50: number;
  stages: StageStats[];
  /** Stage with the largest p50, the one worth optimising next. */
  topOffender: TurnStage | null;
  verdict: "good" | "acceptable" | "slow";
}

export function buildReport(name: string, turns: TurnTimeline[]): LatencyReport {
  const totals = turns.map(turnTotal);
  const totalP50 = percentile(totals, 50);

  const stages: StageStats[] = TURN_STAGES.map((stage) => {
    // Only turns where the stage actually ran count towards its percentiles.
    // Averaging in the zeros from non-tool turns would hide a slow tool server.
    const values = turns
      .map((turn) => turn.stages[stage])
      .filter((value): value is number => value !== undefined);

    const p50 = percentile(values, 50);
    return {
      stage,
      p50,
      p95: percentile(values, 95),
      max: values.length ? Math.max(...values) : 0,
      share: totalP50 > 0 ? p50 / totalP50 : 0,
      budget: STAGE_BUDGET_MS[stage],
      overBudget: p50 > STAGE_BUDGET_MS[stage],
    };
  });

  const ranked = [...stages].sort((a, b) => b.p50 - a.p50);

  return {
    name,
    turns: turns.length,
    toolTurns: turns.filter((turn) => turn.kind === "tool").length,
    totalP50,
    totalP95: percentile(totals, 95),
    totalMax: totals.length ? Math.max(...totals) : 0,
    normalTotalP50: percentile(
      turns.filter((turn) => turn.kind === "normal").map(turnTotal),
      50,
    ),
    toolTotalP50: percentile(turns.filter((turn) => turn.kind === "tool").map(turnTotal), 50),
    stages,
    topOffender: ranked[0]?.p50 ? ranked[0].stage : null,
    verdict:
      totalP50 <= TOTAL_TARGET_MS ? "good" : totalP50 <= TOTAL_WARN_MS ? "acceptable" : "slow",
  };
}

// --- Barge-in ---------------------------------------------------------------

/**
 * How long the assistant keeps talking over a worker who has started speaking.
 * Tracked separately from turn latency because it is a different failure: the
 * call does not feel slow, it feels like the assistant is not listening.
 */
export interface BargeInTimeline {
  /** Voice activity detected in the inbound audio. */
  vadDetect: number;
  /** Extra wait when the stop rule is transcript-based rather than VAD-based. */
  transcriptWait: number;
  /** Stop command reaching the media pipeline, plus audio already in flight. */
  pipelineStop: number;
  /** Enforced silence after the interruption before the assistant may reply. */
  recovery: number;
}

/** Milliseconds of assistant audio the worker hears after they start talking. */
export function talkOverMs(barge: BargeInTimeline): number {
  return barge.vadDetect + barge.transcriptWait + barge.pipelineStop;
}

/** A worker should not hear more than this much talk-over before silence. */
export const TALK_OVER_BUDGET_MS = 300;

// --- Formatting -------------------------------------------------------------

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function bar(share: number, width = 20): string {
  const filled = Math.round(share * width);
  return "#".repeat(Math.max(0, Math.min(width, filled))).padEnd(width, ".");
}

export function formatReport(report: LatencyReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${report.name}`);
  lines.push(`  ${"-".repeat(Math.max(report.name.length, 74))}`);
  lines.push(
    `  ${report.turns} turns   p50 ${report.totalP50}ms   p95 ${report.totalP95}ms   ` +
      `max ${report.totalMax}ms   [${report.verdict.toUpperCase()}]`,
  );
  lines.push(
    `  plain reply ${report.normalTotalP50}ms` +
      (report.toolTurns > 0
        ? `   reply after a decision tool ${report.toolTotalP50}ms (${report.toolTurns} of ${report.turns} turns)`
        : ""),
  );
  lines.push("");
  lines.push(
    `  ${pad("stage", 30)}${padStart("p50", 7)}${padStart("p95", 7)}` +
      `${padStart("budget", 8)}  share`,
  );

  for (const stat of report.stages) {
    if (stat.p50 === 0 && stat.p95 === 0) continue;
    const flag = stat.overBudget ? " OVER" : "";
    lines.push(
      `  ${pad(STAGE_LABELS[stat.stage], 30)}` +
        `${padStart(`${stat.p50}ms`, 7)}${padStart(`${stat.p95}ms`, 7)}` +
        `${padStart(`${stat.budget}ms`, 8)}  ${bar(stat.share)}${flag}`,
    );
  }

  if (report.topOffender) {
    lines.push("");
    lines.push(`  biggest cost: ${STAGE_LABELS[report.topOffender]}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Side-by-side totals for two stacks, so a swap can be justified. */
export function formatComparison(before: LatencyReport, after: LatencyReport): string {
  const lines: string[] = [];

  const row = (label: string, a: number, b: number, extra = "") => {
    const d = b - a;
    const pct = a > 0 ? ` (${d >= 0 ? "+" : ""}${Math.round((d / a) * 100)}%)` : "";
    return (
      `  ${pad(label, 30)}${padStart(`${a}ms`, 12)}${padStart(`${b}ms`, 12)}` +
      `${padStart(`${d >= 0 ? "+" : ""}${d}ms${pct}`, 18)}${extra}`
    );
  };

  lines.push("");
  lines.push(
    `  ${pad("stage", 30)}${padStart(before.name, 12)}${padStart(after.name, 12)}${padStart("delta", 18)}`,
  );
  lines.push(`  ${"-".repeat(74)}`);

  for (const stage of TURN_STAGES) {
    const a = before.stages.find((s) => s.stage === stage)?.p50 ?? 0;
    const b = after.stages.find((s) => s.stage === stage)?.p50 ?? 0;
    if (a === 0 && b === 0) continue;
    lines.push(row(STAGE_LABELS[stage], a, b));
  }

  lines.push(`  ${"-".repeat(74)}`);
  // Split by turn kind: the stage rows above are medians over the turns where
  // each stage ran, so a tool-server row cannot be added to a plain reply.
  lines.push(row("plain reply, end to end", before.normalTotalP50, after.normalTotalP50));
  if (before.toolTurns > 0 || after.toolTurns > 0) {
    lines.push(row("reply after a decision tool", before.toolTotalP50, after.toolTotalP50));
  }
  lines.push("");
  return lines.join("\n");
}
