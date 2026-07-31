import { describe, expect, it } from "vitest";
import {
  HANGUP_BUDGET_SECONDS,
  TURNS_TO_DECISION_BUDGET,
  analyzeCall,
  formatRealCall,
} from "../vapiReport.ts";

const START = Date.UTC(2026, 6, 31, 18, 0, 0);

function bot(offsetMs: number, text: string, tool = false) {
  return {
    role: "bot",
    message: text,
    time: START + offsetMs,
    endTime: START + offsetMs + 2000,
    ...(tool ? { toolCalls: [{ id: "tc_1" }] } : {}),
  };
}

function user(offsetMs: number, text: string) {
  return { role: "user", message: text, time: START + offsetMs, endTime: START + offsetMs + 1000 };
}

/** Greet, shift, yes, decision — the shape the call is supposed to have. */
const tightCall = {
  id: "call_tight",
  status: "ended",
  endedReason: "assistant-ended-call",
  startedAt: new Date(START).toISOString(),
  endedAt: new Date(START + 24_000).toISOString(),
  artifact: {
    messages: [
      bot(0, "Hi Maria, this is the scheduling team."),
      user(3_000, "Yes, speaking"),
      bot(4_000, "We have a Kitchen Assistant shift Friday, 6 to 11, $24 an hour."),
      user(11_000, "Yeah I can do that"),
      bot(12_000, "So that is Friday, 6 PM. Locking that in.", true),
      bot(18_000, "You'll get a text shortly. Thanks Maria."),
    ],
  },
};

describe("analyzeCall", () => {
  it("measures the gap between the worker finishing and the assistant starting", () => {
    const analysis = analyzeCall(tightCall);
    // user ends at 4000, bot starts at 4000 → 0ms; user ends 12000, bot 12000.
    expect(analysis.turns).toHaveLength(2);
    expect(analysis.turns.every((t) => t.responseMs >= 0)).toBe(true);
  });

  it("counts assistant turns up to the decision", () => {
    expect(analyzeCall(tightCall).turnsToDecision).toBe(3);
  });

  it("times the decision and the hangup that follows it", () => {
    const analysis = analyzeCall(tightCall);
    expect(analysis.secondsToDecision).toBe(12);
    expect(analysis.secondsFromDecisionToHangup).toBe(12);
  });

  it("flags a call that kept reading the script after the yes", () => {
    const rambling = {
      ...tightCall,
      id: "call_long",
      artifact: {
        messages: [
          bot(0, "Hi Maria."),
          user(2_000, "Yes"),
          bot(3_000, "We have a Kitchen Assistant shift."),
          user(6_000, "Sure I'll take it"),
          // Kept going anyway.
          bot(7_000, "It's on Friday."),
          bot(10_000, "From 6 PM to 11 PM."),
          bot(13_000, "At Downtown San Francisco."),
          bot(16_000, "Paying $24 per hour. Can I lock that in?"),
          user(21_000, "Yes, I said yes"),
          bot(22_000, "Locking that in.", true),
        ],
      },
    };

    const analysis = analyzeCall(rambling);
    expect(analysis.turnsToDecision).toBe(7);
    expect(analysis.turnsToDecision!).toBeGreaterThan(TURNS_TO_DECISION_BUDGET);
    expect(formatRealCall(analysis)).toContain("kept talking after it had an answer");
  });

  it("flags a call that sat open after the decision", () => {
    const lingering = {
      ...tightCall,
      id: "call_linger",
      endedAt: new Date(START + 45_000).toISOString(),
    };

    const analysis = analyzeCall(lingering);
    expect(analysis.secondsFromDecisionToHangup!).toBeGreaterThan(HANGUP_BUDGET_SECONDS);
    expect(formatRealCall(analysis)).toContain("silenceTimeoutSeconds");
  });

  it("counts talk-overs, where the assistant started before the worker finished", () => {
    const overlapping = {
      ...tightCall,
      id: "call_overlap",
      artifact: {
        messages: [
          { role: "user", message: "wait", time: START, endTime: START + 4_000 },
          bot(1_000, "We have a shift"),
        ],
      },
    };

    const analysis = analyzeCall(overlapping);
    expect(analysis.overlaps).toBe(1);
    expect(formatRealCall(analysis)).toContain("still speaking");
  });

  it("says nothing was measured rather than reporting a fast call", () => {
    const untimed = { id: "call_bare", artifact: { messages: [] } };
    const text = formatRealCall(analyzeCall(untimed));
    expect(text).toContain("Nothing was measured");
    expect(text).not.toContain("p50 0ms");
  });

  it("reports no decision when no tool ever fired", () => {
    const noDecision = {
      ...tightCall,
      id: "call_nodecision",
      artifact: {
        messages: [
          bot(0, "Hi Maria, this is the scheduling team."),
          user(3_000, "not interested, bye"),
          bot(5_000, "No problem, thanks for your time."),
        ],
      },
    };
    const analysis = analyzeCall(noDecision);
    expect(analysis.turnsToDecision).toBeNull();
    expect(formatRealCall(analysis)).toContain("no decision tool ever fired");
  });
});
