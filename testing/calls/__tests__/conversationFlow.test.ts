// Two things the assistant kept getting wrong on real calls:
//
// 1. On a noisy line it never decided the worker had finished speaking, because
//    endpointing waited for silence that never came.
// 2. It kept reading the script after the worker had already said yes, instead
//    of confirming and hanging up.
//
// Both are prompt and config behaviour rather than logic, so these guard the
// specific settings and instructions that fix them.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAssistantConfig,
  buildSpeakingPlan,
} from "../../../src/integrations/vapi/assistant";
import { buildShiftPrompt } from "../../../src/integrations/vapi/prompt";
import { buildToolCallResponse } from "../../../src/integrations/vapi/webhook";
import { buildCallContext } from "../../../src/integrations/a1mobile/client";
import { simulateBargeIn } from "../../latency/mockPipeline.ts";
import { CURRENT_STACK } from "../../latency/profiles.ts";
import { talkOverMs } from "../../latency/timeline.ts";

const context = () =>
  buildCallContext({
    workerId: "emp_ahmed",
    workerName: "Ahmed Khan",
    language: "Urdu",
    shiftId: "sh_1",
    attemptId: "att_1",
    shift: {
      role: "Kitchen Assistant",
      location: "Downtown San Francisco",
      pay: "$24 per hour",
      date: "Friday, July 31",
      startTime: "6:00 PM",
      endTime: "11:00 PM",
    },
  });

describe("hearing the worker over background conversation", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("strips background voices before the transcriber hears them", () => {
    // Without this, voice-activity barge-in fires on anyone in the room.
    expect(buildAssistantConfig().backgroundDenoisingEnabled).toBe(true);
  });

  it("can be turned off if denoising hurts a particular line", () => {
    process.env.VAPI_DENOISING = "off";
    expect(buildAssistantConfig().backgroundDenoisingEnabled).toBe(false);
  });

  it("endpoints on the transcript, not only on silence", () => {
    // waitSeconds alone never fires in a room where someone else is talking:
    // the line is never quiet, so the assistant waits forever.
    const plan = buildSpeakingPlan().startSpeakingPlan;
    expect(plan.transcriptionEndpointingPlan).toBeTruthy();
    expect(plan.transcriptionEndpointingPlan.onPunctuationSeconds).toBeLessThanOrEqual(0.2);
    expect(plan.transcriptionEndpointingPlan.onNoPunctuationSeconds).toBeGreaterThan(
      plan.transcriptionEndpointingPlan.onPunctuationSeconds,
    );
  });

  it("waits longer for a ragged transcript in a noisy venue", () => {
    // The plan reads env on every call, which is what makes the switch usable
    // without a redeploy.
    const quiet = buildSpeakingPlan().startSpeakingPlan.transcriptionEndpointingPlan;
    process.env.VAPI_NOISY_ENVIRONMENT = "true";
    const loud = buildSpeakingPlan().startSpeakingPlan.transcriptionEndpointingPlan;

    expect(loud.onNoPunctuationSeconds).toBeGreaterThan(quiet.onNoPunctuationSeconds);
  });

  it("demands a word or two of evidence before yielding in a noisy venue", () => {
    const quiet = buildSpeakingPlan();
    process.env.VAPI_NOISY_ENVIRONMENT = "true";
    const loud = buildSpeakingPlan();

    expect(loud.stopSpeakingPlan.numWords).toBeGreaterThan(0);
    expect(loud.stopSpeakingPlan.voiceSeconds).toBeGreaterThan(quiet.stopSpeakingPlan.voiceSeconds);

    // The trade the switch makes, priced: slower barge-in, but background
    // chatter stops cutting the assistant off mid-sentence.
    const loudTalkOver = talkOverMs(simulateBargeIn({ ...CURRENT_STACK, ...flatten(loud) }));
    const quietTalkOver = talkOverMs(simulateBargeIn({ ...CURRENT_STACK, ...flatten(quiet) }));
    expect(loudTalkOver).toBeGreaterThan(quietTalkOver);
  });

  it("tells the assistant to ignore people talking in the background", () => {
    expect(buildShiftPrompt(context())).toMatch(/ignore them|background/i);
  });
});

function flatten(plan: ReturnType<typeof buildSpeakingPlan>) {
  return {
    waitSeconds: plan.startSpeakingPlan.waitSeconds,
    numWords: plan.stopSpeakingPlan.numWords,
    voiceSeconds: plan.stopSpeakingPlan.voiceSeconds,
    backoffSeconds: plan.stopSpeakingPlan.backoffSeconds,
  };
}

describe("stopping as soon as the worker says yes", () => {
  const prompt = () => buildShiftPrompt(context());

  it("tells the assistant to stop reading the script on an early yes", () => {
    expect(prompt()).toMatch(/STOP AS SOON AS YOU HAVE A YES/);
    expect(prompt()).toMatch(/stop immediately/i);
  });

  it("names the two facts a worker must have heard before accepting", () => {
    // Everything else can be skipped; date and start time cannot.
    expect(prompt()).toMatch(/date and (the )?time/i);
  });

  it("does not force a full read-back of the whole shift", () => {
    // The old prompt made every accept cost an extra turn re-reading role,
    // date, both times and location back to someone who had just said yes.
    expect(prompt()).toMatch(/Never read the full shift back a second time/i);
    expect(prompt()).toMatch(/This is a check, not a recap/i);
  });

  it("caps the closing at one sentence and an immediate hangup", () => {
    expect(prompt()).toMatch(/end the call/i);
    expect(prompt()).toMatch(/One sentence/i);
  });
});

describe("the tool result that closes the call", () => {
  it("orders an immediate hangup on every decision", () => {
    for (const decision of ["accepted", "declined", "needs_clarification"] as const) {
      const reply = buildToolCallResponse("tc_1", decision);
      expect(reply.results[0].result).toMatch(/end call function immediately/i);
      expect(reply.results[0].result).toMatch(/ONE short/i);
    }
  });

  it("tells the assistant not to recap the shift after accepting", () => {
    const reply = buildToolCallResponse("tc_1", "accepted");
    expect(reply.results[0].result).toMatch(/Do not restate the shift/i);
  });
});

describe("the assistant can actually hang up", () => {
  it("has the end call function enabled", () => {
    // Without this the prompt's "end the call" is a wish, and the line stays
    // open until silenceTimeoutSeconds fires.
    expect(buildAssistantConfig().endCallFunctionEnabled).toBe(true);
  });
});
