// Guards on the shipped assistant config.
//
// These are the settings a latency regression hides in: they look harmless in a
// diff and only show up as the assistant talking over someone on a live call.

import { describe, expect, it } from "vitest";
import { buildAssistantConfig, buildSpeakingPlan } from "../../../src/integrations/vapi/assistant";
import { simulateBargeIn, simulateCall } from "../mockPipeline.ts";
import { CURRENT_STACK } from "../profiles.ts";
import { buildReport, talkOverMs } from "../timeline.ts";

const speakingPlan = buildSpeakingPlan();

/** The shipped speaking plan, expressed as a stack the profiler can price. */
function shippedStack() {
  return {
    ...CURRENT_STACK,
    name: "shipped",
    waitSeconds: speakingPlan.startSpeakingPlan.waitSeconds,
    numWords: speakingPlan.stopSpeakingPlan.numWords,
    voiceSeconds: speakingPlan.stopSpeakingPlan.voiceSeconds,
    backoffSeconds: speakingPlan.stopSpeakingPlan.backoffSeconds,
    toolPathBlocksOnDial: false,
  };
}

describe("interruption handling", () => {
  it("stops on voice activity, not on a transcribed word", () => {
    // numWords > 0 makes Vapi wait for the transcriber before cutting the
    // audio, which on gpt-4o-transcribe is most of a second of talk-over.
    expect(speakingPlan.stopSpeakingPlan.numWords).toBe(0);
  });

  it("requires only a short burst of speech to yield the floor", () => {
    expect(speakingPlan.stopSpeakingPlan.voiceSeconds).toBeLessThanOrEqual(0.2);
  });

  it("does not sit silent for a full second after being interrupted", () => {
    expect(speakingPlan.stopSpeakingPlan.backoffSeconds).toBeLessThanOrEqual(0.6);
  });

  it("lets the worker interrupt the greeting", () => {
    // Someone answering with "hello? who is this?" must be heard.
    expect(buildAssistantConfig().firstMessageInterruptionsEnabled).toBe(true);
  });

  it("more than halves talk-over versus the config we started from", () => {
    const before = talkOverMs(simulateBargeIn(CURRENT_STACK));
    const after = talkOverMs(simulateBargeIn(shippedStack()));
    expect(after).toBeLessThan(before / 2);
  });
});

describe("endpointing", () => {
  it("does not add half a second before the assistant may reply", () => {
    expect(buildAssistantConfig().startSpeakingPlan.waitSeconds).toBeLessThanOrEqual(0.25);
  });

  it("still waits long enough not to cut off a worker mid-sentence", () => {
    // Below ~0.15s the assistant starts answering into natural pauses, which
    // reads as interrupting rather than as being fast.
    expect(buildAssistantConfig().startSpeakingPlan.waitSeconds).toBeGreaterThanOrEqual(0.15);
  });
});

describe("shipped config, priced", () => {
  it("is faster end to end than what we started with", () => {
    const run = { turns: 8, toolTurns: [7], seed: 99 };
    const before = buildReport("before", simulateCall(CURRENT_STACK, run));
    const after = buildReport("after", simulateCall(shippedStack(), run));
    expect(after.normalTotalP50).toBeLessThan(before.normalTotalP50);
    expect(after.toolTotalP50).toBeLessThan(before.toolTotalP50);
  });
});

describe("provider config", () => {
  it("keeps every stage swappable by env for A/B testing", () => {
    const config = buildAssistantConfig();
    expect(config.transcriber.provider).toBeTruthy();
    expect(config.transcriber.model).toBeTruthy();
    expect(config.voice.provider).toBeTruthy();
  });

  it("defaults to the providers that cover Urdu and Punjabi", () => {
    const config = buildAssistantConfig();
    expect(config.transcriber.provider).toBe("openai");
    expect(config.voice.provider).toBe("openai");
  });
});
