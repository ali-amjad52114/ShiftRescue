import { describe, expect, it } from "vitest";
import { DEFAULT_TOOL_SERVER, simulateBargeIn, simulateCall, toolRoundTripMs } from "../mockPipeline.ts";
import {
  AZURE_STACK,
  CURRENT_STACK,
  FASTEST_STACK,
  STACKS,
  TUNED_STACK,
  stackLanguageCoverage,
} from "../profiles.ts";
import { TALK_OVER_BUDGET_MS, buildReport, talkOverMs } from "../timeline.ts";

const RUN = { turns: 8, toolTurns: [7], seed: 4242 };

function p50(stack: typeof CURRENT_STACK) {
  return buildReport(stack.name, simulateCall(stack, RUN)).normalTotalP50;
}

function toolP50(stack: typeof CURRENT_STACK) {
  return buildReport(stack.name, simulateCall(stack, RUN)).toolTotalP50;
}

describe("simulateCall", () => {
  it("is deterministic for a given seed, so a diff in the report is a real change", () => {
    expect(simulateCall(CURRENT_STACK, RUN)).toEqual(simulateCall(CURRENT_STACK, RUN));
  });

  it("produces a different call for a different seed", () => {
    expect(simulateCall(CURRENT_STACK, { ...RUN, seed: 1 })).not.toEqual(
      simulateCall(CURRENT_STACK, RUN),
    );
  });

  it("charges the tool round trip only on the turns that fire a tool", () => {
    const turns = simulateCall(CURRENT_STACK, RUN);
    expect(turns.filter((t) => t.stages.toolRoundTrip !== undefined)).toHaveLength(1);
    expect(turns[7].kind).toBe("tool");
  });

  it("rejects an unknown provider instead of silently costing zero", () => {
    expect(() => simulateCall({ ...CURRENT_STACK, tts: "nope/nope" }, RUN)).toThrow(/Unknown tts/);
  });
});

describe("the tuned stack", () => {
  it("beats the current one on an ordinary reply", () => {
    expect(p50(TUNED_STACK)).toBeLessThan(p50(CURRENT_STACK));
  });

  it("helps most on the turn that fires a decision tool", () => {
    const plainGain = p50(CURRENT_STACK) - p50(TUNED_STACK);
    const toolGain = toolP50(CURRENT_STACK) - toolP50(TUNED_STACK);
    expect(toolGain).toBeGreaterThan(plainGain);
  });

  it("still covers all four languages, which is the whole constraint", () => {
    expect(stackLanguageCoverage(TUNED_STACK)).toBe("all-four");
    expect(stackLanguageCoverage(AZURE_STACK)).toBe("all-four");
    // Kept as a reference point only; it cannot call Ahmed or a Punjabi worker.
    expect(stackLanguageCoverage(FASTEST_STACK)).not.toBe("all-four");
  });
});

describe("toolRoundTripMs", () => {
  it("prices dialling the next worker inside the webhook as the dominant cost", () => {
    const blocking = toolRoundTripMs(CURRENT_STACK);
    const deferred = toolRoundTripMs(TUNED_STACK);
    expect(blocking - deferred).toBe(DEFAULT_TOOL_SERVER.dialMs);
  });

  it("counts a saved Redis round trip when the two reads are concurrent", () => {
    const serial = toolRoundTripMs(TUNED_STACK);
    const parallel = toolRoundTripMs(TUNED_STACK, DEFAULT_TOOL_SERVER, { parallelReads: true });
    expect(serial - parallel).toBe(DEFAULT_TOOL_SERVER.redisMs);
  });
});

describe("simulateBargeIn", () => {
  it("charges a transcript-based stop rule for the words it waits on", () => {
    const oneWord = simulateBargeIn({ ...CURRENT_STACK, numWords: 1 });
    const threeWords = simulateBargeIn({ ...CURRENT_STACK, numWords: 3 });
    expect(threeWords.transcriptWait).toBeGreaterThan(oneWord.transcriptWait);
  });

  it("shows numWords:1 talking over the worker for most of a second", () => {
    expect(talkOverMs(simulateBargeIn(CURRENT_STACK))).toBeGreaterThan(900);
  });

  it("cuts talk-over by more than half when stopping on voice activity alone", () => {
    const before = talkOverMs(simulateBargeIn(CURRENT_STACK));
    const after = talkOverMs(simulateBargeIn(TUNED_STACK));
    expect(after).toBeLessThan(before / 2);
  });

  it("does not count the post-interruption backoff as talk-over", () => {
    const barge = simulateBargeIn(TUNED_STACK);
    expect(barge.recovery).toBe(600);
    expect(talkOverMs(barge)).toBe(barge.vadDetect + barge.transcriptWait + barge.pipelineStop);
  });

  it("is still not inside budget on the multilingual stack, and says so", () => {
    // Honest result: VAD-based stopping is a big win but the remaining cost is
    // media transport, which no config change removes. Recorded so the budget
    // is not quietly moved to make the report green.
    expect(talkOverMs(simulateBargeIn(TUNED_STACK))).toBeGreaterThan(TALK_OVER_BUDGET_MS);
  });
});

describe("every named stack", () => {
  it("resolves and produces a finite report", () => {
    for (const stack of Object.values(STACKS)) {
      const report = buildReport(stack.name, simulateCall(stack, RUN));
      expect(report.totalP50).toBeGreaterThan(0);
      expect(Number.isFinite(report.totalP95)).toBe(true);
    }
  });
});
