import { describe, expect, it } from "vitest";
import {
  STAGE_BUDGET_MS,
  TALK_OVER_BUDGET_MS,
  buildReport,
  formatComparison,
  formatReport,
  percentile,
  talkOverMs,
  turnTotal,
  type TurnTimeline,
} from "../timeline.ts";

function turn(index: number, stages: TurnTimeline["stages"], kind: "normal" | "tool" = "normal") {
  return { index, kind, stages } satisfies TurnTimeline;
}

describe("percentile", () => {
  it("returns 0 for no samples rather than NaN", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("uses nearest rank, so every result is a value that actually occurred", () => {
    const values = [100, 200, 300, 400];
    expect(percentile(values, 50)).toBe(200);
    expect(percentile(values, 95)).toBe(400);
    expect(values).toContain(percentile(values, 75));
  });

  it("does not mutate the caller's array", () => {
    const values = [300, 100, 200];
    percentile(values, 50);
    expect(values).toEqual([300, 100, 200]);
  });
});

describe("buildReport", () => {
  const turns = [
    turn(0, { endpointing: 300, llmTtft: 400, ttsTtfb: 200 }),
    turn(1, { endpointing: 300, llmTtft: 400, ttsTtfb: 200 }),
    turn(2, { endpointing: 300, llmTtft: 400, ttsTtfb: 200, toolRoundTrip: 900 }, "tool"),
  ];

  it("totals each turn across its stages", () => {
    expect(turnTotal(turns[0])).toBe(900);
    expect(turnTotal(turns[2])).toBe(1800);
  });

  it("keeps tool turns out of the stage percentiles for stages they skip", () => {
    const report = buildReport("t", turns);
    const tool = report.stages.find((s) => s.stage === "toolRoundTrip")!;
    // Only the one tool turn counts. Averaging in two zeros would report 0ms
    // and hide a slow webhook completely.
    expect(tool.p50).toBe(900);
  });

  it("separates plain replies from replies that fired a tool", () => {
    const report = buildReport("t", turns);
    expect(report.normalTotalP50).toBe(900);
    expect(report.toolTotalP50).toBe(1800);
    expect(report.toolTurns).toBe(1);
  });

  it("names the stage worth optimising next", () => {
    expect(buildReport("t", turns).topOffender).toBe("toolRoundTrip");
  });

  it("flags stages over their budget", () => {
    const report = buildReport("t", turns);
    const stt = report.stages.find((s) => s.stage === "stt")!;
    const llm = report.stages.find((s) => s.stage === "llmTtft")!;
    expect(stt.overBudget).toBe(false); // never ran
    expect(llm.p50).toBeGreaterThan(0);
    expect(llm.overBudget).toBe(llm.p50 > STAGE_BUDGET_MS.llmTtft);
  });

  it("grades the call against the perceived-latency bands", () => {
    expect(buildReport("fast", [turn(0, { llmTtft: 500 })]).verdict).toBe("good");
    expect(buildReport("mid", [turn(0, { llmTtft: 1100 })]).verdict).toBe("acceptable");
    expect(buildReport("slow", [turn(0, { llmTtft: 2500 })]).verdict).toBe("slow");
  });

  it("survives an empty call without dividing by zero", () => {
    const report = buildReport("empty", []);
    expect(report.totalP50).toBe(0);
    expect(report.topOffender).toBeNull();
    expect(report.stages.every((s) => s.share === 0)).toBe(true);
  });
});

describe("formatting", () => {
  const before = buildReport("current", [turn(0, { llmTtft: 600, ttsTtfb: 480 })]);
  const after = buildReport("tuned", [turn(0, { llmTtft: 300, ttsTtfb: 200 })]);

  it("reports both a total and the stage breakdown", () => {
    const text = formatReport(before);
    expect(text).toContain("p50 1080ms");
    expect(text).toContain("llm time-to-first-token");
    expect(text).toContain("OVER");
  });

  it("shows the direction and size of each change", () => {
    const text = formatComparison(before, after);
    expect(text).toContain("-300ms");
    expect(text).toContain("plain reply, end to end");
    expect(text).not.toContain("+"); // everything got faster
  });
});

describe("talkOverMs", () => {
  it("counts everything the worker hears after they start speaking", () => {
    const ms = talkOverMs({
      vadDetect: 60,
      transcriptWait: 500,
      pipelineStop: 180,
      // Recovery happens after silence, so it is not talk-over.
      recovery: 1000,
    });
    expect(ms).toBe(740);
    expect(ms).toBeGreaterThan(TALK_OVER_BUDGET_MS);
  });
});
