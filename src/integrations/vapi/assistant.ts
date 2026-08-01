import { buildBasePrompt, buildFirstMessage, buildIdleMessages, buildShiftPrompt } from "./prompt";
import { buildVapiTools, toolServerUrl } from "./tools";
import type { ShiftCallContext } from "./types";

export const vapiAssistantId = process.env.VAPI_ASSISTANT_ID || "mock-vapi-assistant-id";

/** Vapi phone number ID for the a1mobile number registered in the Vapi dashboard. */
export const vapiPhoneNumberId = process.env.VAPI_PHONE_NUMBER_ID || "";

export const vapiApiBase = "https://api.vapi.ai";

const openaiModel = process.env.VAPI_OPENAI_MODEL || "gpt-4o";

// Every stage of the pipeline is swappable by env so a provider can be A/B'd
// against `node testing/latency/cli.ts report <callId>` without a code change.
// The defaults keep all four languages; the faster alternatives do not all
// cover Urdu and Punjabi, so they are a deliberate choice, not a default.
const transcriberProvider = process.env.VAPI_TRANSCRIBER_PROVIDER || "openai";
const transcriberModel = process.env.VAPI_TRANSCRIBER_MODEL || "gpt-4o-transcribe";
const voiceProvider = process.env.VAPI_VOICE_PROVIDER || "openai";

/**
 * Whether this venue's calls happen somewhere loud.
 *
 * Workers answer from kitchens, bus stops and living rooms with a television
 * on. Two settings have to move together for that, and getting one right on its
 * own makes the call worse, so they live behind a single switch.
 */
export function isNoisyEnvironment(): boolean {
  return process.env.VAPI_NOISY_ENVIRONMENT === "true";
}

/**
 * Krisp-style removal of background voices and noise before anything reaches
 * the transcriber. This is what makes voice-activity barge-in usable at all on
 * a noisy line — without it every passing conversation looks like the worker
 * starting to speak.
 */
export function denoisingEnabled(): boolean {
  return process.env.VAPI_DENOISING !== "off";
}

/**
 * How aggressively the assistant yields the floor, and how it decides the
 * worker has finished.
 *
 * `stopSpeakingPlan.numWords` is the barge-in rule. Above zero, Vapi waits for
 * the transcriber to emit that many words before cutting the audio, which on a
 * slow multilingual transcriber is most of a second of talking over the worker.
 * At zero it stops on voice activity alone — much faster, but on a noisy line
 * background chatter also stops it, so a loud venue wants a word or two of
 * evidence that it is really the worker speaking.
 *
 * `startSpeakingPlan` is the other half. `waitSeconds` alone waits for silence,
 * and in a room with a conversation going on the line is never silent, so the
 * assistant sits there hearing speech and never decides the worker has
 * finished. `transcriptionEndpointingPlan` endpoints on what was actually
 * transcribed instead, which is the only thing that works when the audio never
 * goes quiet. It is language-agnostic, unlike Vapi's smart-endpointing models,
 * which matters because half these calls are not in English.
 */
export function buildSpeakingPlan() {
  const noisy = isNoisyEnvironment();

  return {
    startSpeakingPlan: {
      // How long a pause has to last before the worker is treated as finished.
      waitSeconds: Number(process.env.VAPI_START_WAIT_SECONDS ?? 0.2),
      transcriptionEndpointingPlan: {
        // A finished sentence is a finished turn; answer straight away.
        onPunctuationSeconds: 0.1,
        // No punctuation means they are probably mid-thought. Longer on a noisy
        // line, where partial transcripts arrive ragged.
        onNoPunctuationSeconds: noisy ? 1.5 : 1.1,
        // "six", "twenty two" — someone reading out a time usually has more coming.
        onNumberSeconds: 0.5,
      },
    },
    stopSpeakingPlan: {
      numWords: Number(process.env.VAPI_STOP_NUM_WORDS ?? (noisy ? 2 : 0)),
      voiceSeconds: noisy ? 0.3 : 0.15,
      backoffSeconds: 0.6,
    },
  };
}


/**
 * How long the line stays open with nobody speaking before Vapi hangs up.
 *
 * This is the pause at the end of a call: the assistant has said its closing
 * line, the worker has said goodbye, and the call sits there until either the
 * model calls endCall or this timeout fires. At 20 seconds that dead air was
 * long enough to feel broken. Ten is enough to survive a worker pausing to
 * think without leaving them holding a silent phone.
 */
export const silenceTimeoutSeconds = Number(process.env.VAPI_SILENCE_TIMEOUT_SECONDS ?? 10);

/** Hard ceiling on one call. A worker call that runs long has gone wrong. */
export const maxDurationSeconds = Number(process.env.VAPI_MAX_CALL_SECONDS ?? 300);

/**
 * What happens when the worker says nothing at all.
 *
 * A prompt cannot fix this on its own: with no transcript there is no turn, so
 * the model is never asked to produce anything and the line simply goes quiet
 * until silenceTimeoutSeconds hangs up on someone who was only reaching for a
 * pen. Vapi's idle messages are the only thing that speaks into that gap, so
 * "sorry, can you say that again?" belongs here rather than in the prompt.
 *
 * Twice is the limit. A third prompt into silence is a machine talking to an
 * empty room, and the silence timeout ends the call more gracefully than that.
 */
export function buildMessagePlan(idleMessages: string[]) {
  return {
    messagePlan: {
      idleMessages,
      // Long enough to be a pause rather than an interruption. Vapi's floor is
      // 5 seconds; below that it starts talking over people who are thinking.
      idleTimeoutSeconds: Number(process.env.VAPI_IDLE_TIMEOUT_SECONDS ?? 7),
      idleMessageMaxSpokenCount: Number(process.env.VAPI_IDLE_MAX_COUNT ?? 2),
    },
  };
}

/**
 * Assistant-level config: OpenAI for the brain, OpenAI transcription and voice
 * so English, Spanish, Urdu and Punjabi all run through one provider.
 */
export function buildAssistantConfig() {
  return {
    name: "ShiftRescue Worker Call",
    model: {
      provider: "openai",
      model: openaiModel,
      temperature: 0.3,
      messages: [{ role: "system", content: buildBasePrompt() }],
      tools: buildVapiTools(),
    },
    transcriber: {
      provider: transcriberProvider,
      model: transcriberModel,
    },
    voice: {
      provider: voiceProvider,
      voiceId: process.env.VAPI_OPENAI_VOICE || "alloy",
    },
    firstMessage:
      "Hi, this is the scheduling team calling to check your availability for a shift. Do you have a minute?",
    // Let the worker cut in mid-sentence, including over the greeting — someone
    // answering with "hello? who is this?" should be heard, not spoken over.
    ...buildSpeakingPlan(),
    // English here; the per-call override replaces it with the worker's language.
    ...buildMessagePlan(["Sorry, can you say that again?", "Are you still there?"]),
    firstMessageInterruptionsEnabled: true,
    // Strip background voices before the transcriber hears them.
    backgroundDenoisingEnabled: denoisingEnabled(),
    silenceTimeoutSeconds,
    maxDurationSeconds,
    endCallFunctionEnabled: true,
    server: { url: toolServerUrl() },
    // "transcript" is not in Vapi's default serverMessages, so neither the live
    // panel nor the call log receives anything unless it is asked for
    // explicitly. Every server message goes to the one server.url above.
    serverMessages: ["transcript", "tool-calls", "status-update", "end-of-call-report"],
  };
}

/** Per-call overrides: the shift-specific prompt, greeting and variables. */
export function buildAssistantOverrides(context: ShiftCallContext) {
  return {
    firstMessage: buildFirstMessage(context),
    ...buildMessagePlan(buildIdleMessages(context)),
    variableValues: {
      workerId: context.workerId,
      shiftId: context.shiftId,
      attemptId: context.attemptId,
      workerName: context.workerName,
      language: context.language,
      role: context.role,
      date: context.date,
      startTime: context.startTime,
      endTime: context.endTime,
      location: context.location,
      pay: context.pay,
      maxPay: context.maxPay,
      payHeadroom: context.payHeadroom,
      venueName: context.venueName,
    },
    model: {
      provider: "openai",
      model: openaiModel,
      temperature: 0.3,
      messages: [{ role: "system", content: buildShiftPrompt(context) }],
      tools: buildVapiTools(),
    },
  };
}

/**
 * Pushes the model, tools and voice config onto the assistant that already
 * exists in the Vapi dashboard. Run once after changing prompts or tools.
 */
export async function syncVapiAssistant(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey || !process.env.VAPI_ASSISTANT_ID) {
    return { success: false, error: "VAPI_API_KEY and VAPI_ASSISTANT_ID are required" };
  }

  const { name, ...config } = buildAssistantConfig();
  void name;

  const res = await fetch(`${vapiApiBase}/assistant/${vapiAssistantId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });

  if (!res.ok) {
    return { success: false, error: `Vapi assistant update failed (${res.status}): ${await res.text()}` };
  }

  return { success: true };
}
