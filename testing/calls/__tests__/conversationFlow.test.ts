// Two things the assistant kept getting wrong on real calls:
//
// 1. On a noisy line it never decided the worker had finished speaking, because
//    endpointing waited for silence that never came.
// 2. It kept reading the script after the worker had already said yes, instead
//    of confirming and hanging up.
//
// Both are prompt and config behaviour rather than logic, so these guard the
// specific settings and instructions that fix them.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAssistantConfig,
  buildAssistantOverrides,
  buildSpeakingPlan,
} from "../../../src/integrations/vapi/assistant";
import { buildIdleMessages, buildShiftPrompt } from "../../../src/integrations/vapi/prompt";
import {
  buildToolCallResponse,
  checkConfirmation,
  handleVapiWebhook,
} from "../../../src/integrations/vapi/webhook";
import { toolCallEnvelope } from "../../latency/fixtures.ts";
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

  it("closes an acceptance by thanking them and naming the shift once", () => {
    const reply = buildToolCallResponse("tc_1", "accepted");
    expect(reply.results[0].result).toMatch(/thank them for confirming/i);
    expect(reply.results[0].result).toMatch(/do not ask them to confirm again/i);
  });

  it("tells the assistant when a decision did not stick", () => {
    // The model must not tell a worker they are booked on the strength of a
    // tool call the backend refused.
    const prompt = buildShiftPrompt(context());
    expect(prompt).toMatch(/it is not recorded/i);
    expect(prompt).toMatch(/Do not tell the worker they are booked/i);
  });
});

describe("the call runs as a fixed sequence of steps", () => {
  const prompt = () => buildShiftPrompt(context());

  it("names every step, in order, and forbids improvising a new one", () => {
    for (const step of [
      /STEP 1 - RIGHT PERSON/,
      /STEP 2 - THE OFFER/,
      /STEP 3 - READ THE ANSWER/,
      /STEP 4 - CONFIRMATION GATE/,
      /STEP 5 - CLOSE/,
    ]) {
      expect(prompt()).toMatch(step);
    }
    expect(prompt()).toMatch(/never invent a sixth/i);
  });

  it("puts a confirmation question between the yes and the tool", () => {
    // The whole point of the gate: accept_shift is unreachable from a bare yes.
    expect(prompt()).toMatch(/Never call accept_shift straight out of step 3/i);
    expect(prompt()).toMatch(/just to confirm/i);
  });

  it("caps the confirming at once, so the worker is not interrogated", () => {
    expect(prompt()).toMatch(/Ask the gate question once per call/i);
    expect(prompt()).toMatch(/never make a worker confirm three times/i);
  });

  it("sorts every reply into one bucket and forbids guessing", () => {
    expect(prompt()).toMatch(/YES-TYPE/);
    expect(prompt()).toMatch(/NO-TYPE/);
    expect(prompt()).toMatch(/UNSURE/);
    expect(prompt()).toMatch(/Never guess which one it was/i);
    expect(prompt()).toMatch(/Silence is not a yes/i);
  });

  it("hands the model the same yes-words the backend matches on", () => {
    // Without this the model and the confirmation gate disagree about what a
    // yes is, and the gate spends the call challenging correct decisions.
    const text = buildShiftPrompt({ ...context(), language: "English" });
    for (const phrase of ["count me in", "sounds good", "let me check", "no problem"]) {
      expect(text).toContain(phrase);
    }
    expect(text).not.toMatch(/\{\{yesWords\}\}|\{\{noWords\}\}|\{\{unsureWords\}\}/);
  });

  it("gives the examples in the worker's own language", () => {
    expect(buildShiftPrompt(context())).toContain("haan");
    expect(buildShiftPrompt({ ...context(), language: "Spanish" })).toContain("cuenta conmigo");
  });

  it("thanks the worker for confirming and states the shift back on the way out", () => {
    expect(prompt()).toMatch(/Thank you for confirming/i);
    expect(prompt()).toMatch(/confirmation text is on the way/i);
  });
});

describe("when the worker says nothing", () => {
  it("asks them to say it again rather than sitting in silence", () => {
    // A prompt cannot do this on its own: no transcript means no turn, so the
    // model is never asked for anything. Vapi's idle messages are the only
    // thing that speaks into a silence.
    const plan = buildAssistantConfig().messagePlan;
    expect(plan.idleMessages[0]).toMatch(/say that again/i);
  });

  it("asks in the worker's language", () => {
    const overrides = buildAssistantOverrides({ ...context(), language: "Spanish" });
    expect(overrides.messagePlan.idleMessages[0]).toMatch(/repetir/i);
    expect(buildIdleMessages(context())[0]).toMatch(/dobara/i);
  });

  it("gives up after two, rather than talking at an empty room", () => {
    const plan = buildAssistantConfig().messagePlan;
    expect(plan.idleMessageMaxSpokenCount).toBe(2);
    expect(plan.idleMessages.length).toBeGreaterThanOrEqual(2);
    // Long enough to be a pause, not an interruption.
    expect(plan.idleTimeoutSeconds).toBeGreaterThanOrEqual(5);
  });

  it("tells the assistant the same thing, for the case where it does get a turn", () => {
    expect(buildShiftPrompt(context())).toMatch(/Sorry, can you say that again\?/);
  });
});

describe("the confirmation gate", () => {
  const heard = (lastWorkerReply: string) => ({ lastWorkerReply });

  it("lets an acceptance through when the worker said yes in their own words", () => {
    for (const reply of ["yeah I can do that", "count me in", "haan ji", "no problem"]) {
      expect(checkConfirmation("accepted", heard(reply))).toBeNull();
    }
  });

  it("refuses an acceptance when the worker had just refused", () => {
    const outcome = checkConfirmation("accepted", heard("sorry, I'm working that day"));
    expect(outcome?.reason).toBe("no-yes-heard");
    expect(outcome?.intent).toBe("decline");
  });

  it("refuses an acceptance built on a maybe", () => {
    expect(checkConfirmation("accepted", heard("let me check"))?.reason).toBe("unsure");
    expect(checkConfirmation("accepted", heard("call me back"))?.reason).toBe("unsure");
  });

  it("catches a clear yes that got logged as no decision", () => {
    expect(checkConfirmation("needs_clarification", heard("sure thing"))?.reason).toBe("missed-yes");
  });

  it("leaves a decline alone, since nobody is rostered by one", () => {
    expect(checkConfirmation("declined", heard("yes"))).toBeNull();
  });

  it("stands down when it cannot hear well enough to be sure", () => {
    // A fuzzy match is a guess, and a guess must not override the one thing on
    // the call that actually heard the audio.
    expect(checkConfirmation("accepted", heard("nahiii"))).toBeNull();
    expect(checkConfirmation("accepted", heard("who is this"))).toBeNull();
    expect(checkConfirmation("accepted", undefined)).toBeNull();
    expect(checkConfirmation("accepted", heard("   "))).toBeNull();
  });

  it("fires once and then trusts the model", () => {
    // Otherwise a worker who answers the gate question the same way both times
    // is asked it forever.
    const context = { lastWorkerReply: "let me check", alreadyChallenged: true };
    expect(checkConfirmation("accepted", context)).toBeNull();
  });
});

describe("what a challenged decision does to the call", () => {
  const envelope = toolCallEnvelope({
    workerId: "emp_ahmed",
    attemptId: "att_1",
    toolName: "accept_shift",
  });

  it("does not record the acceptance, and sends the assistant back to ask", async () => {
    const onDecision = vi.fn();
    const response = await handleVapiWebhook(envelope as never, {
      onDecision,
      confirmationContext: async () => ({ lastWorkerReply: "no, I'm working" }),
    });

    expect(onDecision).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    const result = (response.body as { results: Array<{ result: string }> }).results[0].result;
    expect(result).toMatch(/NOT RECORDED/);
    expect(result).toMatch(/can you work this shift/i);
  });

  it("puts the refusal on the record", async () => {
    const onGateChallenge = vi.fn();
    await handleVapiWebhook(envelope as never, {
      onDecision: vi.fn(),
      confirmationContext: async () => ({ lastWorkerReply: "no, I'm working" }),
      onGateChallenge,
    });

    expect(onGateChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "accepted" }),
      expect.objectContaining({ reason: "no-yes-heard", reply: "no, I'm working" }),
    );
  });

  it("records the decision normally when the worker did say yes", async () => {
    const onDecision = vi.fn();
    const response = await handleVapiWebhook(envelope as never, {
      onDecision,
      confirmationContext: async () => ({ lastWorkerReply: "yeah, I'll take it" }),
    });

    expect(onDecision).toHaveBeenCalledTimes(1);
    expect((response.body as { results: Array<{ result: string }> }).results[0].result).toMatch(
      /Recorded/,
    );
  });

  it("never blocks a decision because the transcript could not be read", async () => {
    const onDecision = vi.fn();
    await handleVapiWebhook(envelope as never, {
      onDecision,
      confirmationContext: async () => {
        throw new Error("redis down");
      },
    });

    expect(onDecision).toHaveBeenCalledTimes(1);
  });

  it("is off entirely when no transcript source is wired up", async () => {
    const onDecision = vi.fn();
    await handleVapiWebhook(envelope as never, { onDecision });
    expect(onDecision).toHaveBeenCalledTimes(1);
  });
});

describe("the assistant can actually hang up", () => {
  it("has the end call function enabled", () => {
    // Without this the prompt's "end the call" is a wish, and the line stays
    // open until silenceTimeoutSeconds fires.
    expect(buildAssistantConfig().endCallFunctionEnabled).toBe(true);
  });
});
