// Mock voice pipeline.
//
// Simulates one worker call turn by turn so a config change can be priced
// without dialling anyone. Every stage is drawn from the provider profiles with
// a little jitter, from a seeded generator, so two runs of the same stack
// produce the same report and a diff in the output means a real change.

import {
  MS_PER_SPOKEN_WORD,
  PIPELINE_STOP_MS,
  TRANSPORT_MS,
  VAD_OVERHEAD_MS,
  resolveStack,
  type StackConfig,
} from "./profiles.ts";
import type { BargeInTimeline, TurnTimeline } from "./timeline.ts";

/** Small deterministic PRNG. Same seed, same report. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** +/- `spread` fraction around the profile value, rounded to whole ms. */
function jitter(rng: () => number, value: number, spread = 0.18): number {
  return Math.round(value * (1 + (rng() * 2 - 1) * spread));
}

/**
 * What our own tool webhook costs the call. These are the only numbers in the
 * whole model we control directly, which is why they are broken out: a Redis
 * round trip is cheap, placing the next outbound call inside the same request
 * is not.
 */
export interface ToolServerModel {
  /** One Upstash Redis round trip from the serverless region. */
  redisMs: number;
  /** POST /call/phone to Vapi to dial the next worker. */
  dialMs: number;
  /** Our handler's own compute. */
  handlerMs: number;
}

export const DEFAULT_TOOL_SERVER: ToolServerModel = {
  redisMs: 45,
  dialMs: 420,
  handlerMs: 10,
};

/**
 * getWorkflowState() reads the roster and the run state; today those are two
 * sequential Redis calls, and the write at the end is a third.
 */
export function toolRoundTripMs(
  stack: StackConfig,
  server: ToolServerModel = DEFAULT_TOOL_SERVER,
  options: { parallelReads?: boolean } = {},
): number {
  const reads = options.parallelReads ? server.redisMs : server.redisMs * 2;
  const write = server.redisMs;
  const dial = stack.toolPathBlocksOnDial ? server.dialMs : 0;
  return reads + write + dial + server.handlerMs;
}

export interface SimulateOptions {
  /** Total assistant turns in the call. */
  turns?: number;
  /** Which turn indexes fire a decision tool. Defaults to the last turn. */
  toolTurns?: number[];
  seed?: number;
  server?: ToolServerModel;
  /** Model getWorkflowState() issuing its two reads concurrently. */
  parallelReads?: boolean;
}

export function simulateCall(stack: StackConfig, options: SimulateOptions = {}): TurnTimeline[] {
  const turns = options.turns ?? 8;
  const toolTurns = new Set(options.toolTurns ?? [turns - 1]);
  const rng = mulberry32(options.seed ?? 1);
  const { stt, llm, tts } = resolveStack(stack);

  const timelines: TurnTimeline[] = [];

  for (let index = 0; index < turns; index += 1) {
    const isTool = toolTurns.has(index);
    const stages: TurnTimeline["stages"] = {
      endpointing: jitter(rng, stack.waitSeconds * 1000 + VAD_OVERHEAD_MS),
      stt: jitter(rng, stt.finalMs),
      llmTtft: jitter(rng, llm.ttftMs),
      ttsTtfb: jitter(rng, tts.ttfbMs),
      transport: jitter(rng, TRANSPORT_MS, 0.35),
    };

    if (isTool) {
      // A tool turn pays for our webhook and then for the model picking up
      // again once the result comes back.
      stages.toolRoundTrip =
        jitter(rng, toolRoundTripMs(stack, options.server, { parallelReads: options.parallelReads })) +
        jitter(rng, llm.toolResumeMs);
    }

    timelines.push({
      index,
      kind: isTool ? "tool" : "normal",
      stages,
      label: isTool ? "decision tool call" : undefined,
    });
  }

  return timelines;
}

/**
 * How long the assistant keeps talking after the worker cuts in.
 *
 * The rule that matters is stopSpeakingPlan.numWords. Above zero, Vapi will not
 * stop until the transcriber has produced that many words, so the wait is an
 * interim-transcript round trip plus the time it physically takes to say the
 * words. At zero it stops on voice activity alone, which is the whole
 * difference between "it heard me" and "it talked over me".
 */
export function simulateBargeIn(stack: StackConfig): BargeInTimeline {
  const { stt } = resolveStack(stack);

  const transcriptWait =
    stack.numWords > 0
      ? stt.interimMs + stack.numWords * MS_PER_SPOKEN_WORD
      : Math.round(stack.voiceSeconds * 1000);

  return {
    vadDetect: 60,
    transcriptWait,
    pipelineStop: PIPELINE_STOP_MS + TRANSPORT_MS,
    recovery: Math.round(stack.backoffSeconds * 1000),
  };
}
