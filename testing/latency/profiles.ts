// Provider latency profiles.
//
// IMPORTANT: every number here is a starting estimate, not a measurement from
// this account. Run `npm run profile report <callId>` against a real call and
// overwrite the entries for the stack actually in use. The point of the file is
// that a provider swap can be argued about with numbers in one place, rather
// than by re-reading vendor marketing pages.
//
// `languages` is what limits the choice here: the assistant has to speak
// English, Spanish, Urdu and Punjabi, which rules out most of the fast options.

export type LanguageCoverage = "all-four" | "no-punjabi" | "english-spanish";

export interface SttProfile {
  id: string;
  /** Final transcript emitted, measured from the endpoint decision. */
  finalMs: number;
  /** Interim (partial) transcript latency, which is what barge-in waits on. */
  interimMs: number;
  languages: LanguageCoverage;
  note?: string;
}

export interface LlmProfile {
  id: string;
  /** Time to first token with a ~1200 token system prompt. */
  ttftMs: number;
  /** Extra time to resume speaking after a tool result comes back. */
  toolResumeMs: number;
  note?: string;
}

export interface TtsProfile {
  id: string;
  /** Time to first audio byte. */
  ttfbMs: number;
  languages: LanguageCoverage;
  note?: string;
}

export const STT_PROFILES: Record<string, SttProfile> = {
  "openai/gpt-4o-transcribe": {
    id: "openai/gpt-4o-transcribe",
    finalMs: 380,
    interimMs: 430,
    languages: "all-four",
    note: "Current. Highest quality on Urdu/Punjabi, slowest interims.",
  },
  "openai/whisper-1": {
    id: "openai/whisper-1",
    finalMs: 520,
    interimMs: 600,
    languages: "all-four",
    note: "Chunked, not truly streaming. Worst case for barge-in.",
  },
  "deepgram/nova-3": {
    id: "deepgram/nova-3",
    finalMs: 90,
    interimMs: 110,
    languages: "english-spanish",
    note: "Fastest, but no Punjabi. Only viable if the roster is en/es.",
  },
  "assemblyai/universal-streaming": {
    id: "assemblyai/universal-streaming",
    finalMs: 130,
    interimMs: 160,
    languages: "no-punjabi",
  },
  "azure/speech": {
    id: "azure/speech",
    finalMs: 210,
    interimMs: 240,
    languages: "all-four",
    note: "Middle ground: covers all four languages at half the OpenAI latency.",
  },
};

export const LLM_PROFILES: Record<string, LlmProfile> = {
  "openai/gpt-4o": {
    id: "openai/gpt-4o",
    ttftMs: 620,
    toolResumeMs: 380,
    note: "Current.",
  },
  "openai/gpt-4o-mini": {
    id: "openai/gpt-4o-mini",
    ttftMs: 340,
    toolResumeMs: 220,
    note: "The call is a scripted decision tree; the big model buys little here.",
  },
  "openai/gpt-4.1-mini": {
    id: "openai/gpt-4.1-mini",
    ttftMs: 310,
    toolResumeMs: 200,
  },
  "openai/gpt-4.1-nano": {
    id: "openai/gpt-4.1-nano",
    ttftMs: 230,
    toolResumeMs: 150,
    note: "Fastest, but watch instruction-following on the never-invent rules.",
  },
};

export const TTS_PROFILES: Record<string, TtsProfile> = {
  "openai/alloy": {
    id: "openai/alloy",
    ttfbMs: 480,
    languages: "all-four",
    note: "Current. Single biggest fixed cost in the pipeline.",
  },
  "azure/neural-multilingual": {
    id: "azure/neural-multilingual",
    ttfbMs: 200,
    languages: "all-four",
    note: "Covers ur-PK and pa-IN with real streaming.",
  },
  "elevenlabs/flash-v2.5": {
    id: "elevenlabs/flash-v2.5",
    ttfbMs: 110,
    languages: "no-punjabi",
  },
  "cartesia/sonic-2": {
    id: "cartesia/sonic-2",
    ttfbMs: 95,
    languages: "english-spanish",
  },
  "deepgram/aura-2": {
    id: "deepgram/aura-2",
    ttfbMs: 130,
    languages: "english-spanish",
  },
};

/** One-way media transport out through the a1mobile SIP trunk to the PSTN. */
export const TRANSPORT_MS = 90;

/** VAD overhead on top of the configured endpointing wait. */
export const VAD_OVERHEAD_MS = 80;

/** Stop command reaching the media pipeline, plus audio already in flight. */
export const PIPELINE_STOP_MS = 90;

/** Average speaking rate, used to price a transcript-based barge-in rule. */
export const MS_PER_SPOKEN_WORD = 350;

export interface StackConfig {
  name: string;
  stt: string;
  llm: string;
  tts: string;
  /** startSpeakingPlan.waitSeconds */
  waitSeconds: number;
  /** stopSpeakingPlan.numWords — 0 means stop on voice activity alone. */
  numWords: number;
  /** stopSpeakingPlan.voiceSeconds */
  voiceSeconds: number;
  /** stopSpeakingPlan.backoffSeconds */
  backoffSeconds: number;
  /**
   * Whether the tool webhook places the next outbound call before replying to
   * Vapi. When true the assistant is mute for a whole dial round trip.
   */
  toolPathBlocksOnDial: boolean;
}

/** The stack as configured in src/integrations/vapi/assistant.ts today. */
export const CURRENT_STACK: StackConfig = {
  name: "current",
  stt: "openai/gpt-4o-transcribe",
  llm: "openai/gpt-4o",
  tts: "openai/alloy",
  waitSeconds: 0.4,
  numWords: 1,
  voiceSeconds: 0.2,
  backoffSeconds: 1,
  toolPathBlocksOnDial: true,
};

/** Every fix that keeps all four languages. This is the one to ship. */
export const TUNED_STACK: StackConfig = {
  name: "tuned",
  stt: "openai/gpt-4o-transcribe",
  llm: "openai/gpt-4o-mini",
  tts: "openai/alloy",
  waitSeconds: 0.2,
  numWords: 0,
  voiceSeconds: 0.15,
  backoffSeconds: 0.6,
  toolPathBlocksOnDial: false,
};

/**
 * What VAPI_NOISY_ENVIRONMENT=true buys and costs.
 *
 * Requiring two transcribed words before yielding stops background chatter
 * cutting the assistant off, at the price of talking over the real worker for
 * roughly twice as long. Only worth it if denoising alone was not enough.
 */
export const NOISY_STACK: StackConfig = {
  ...TUNED_STACK,
  name: "noisy venue",
  numWords: 2,
  voiceSeconds: 0.3,
};

/** Tuned, plus swapping to Azure for STT and TTS. Still covers all four. */
export const AZURE_STACK: StackConfig = {
  ...TUNED_STACK,
  name: "tuned+azure",
  stt: "azure/speech",
  tts: "azure/neural-multilingual",
};

/** The floor, if the roster were English/Spanish only. Reference point. */
export const FASTEST_STACK: StackConfig = {
  ...TUNED_STACK,
  name: "en/es only",
  stt: "deepgram/nova-3",
  llm: "openai/gpt-4.1-mini",
  tts: "cartesia/sonic-2",
};

export const STACKS: Record<string, StackConfig> = {
  current: CURRENT_STACK,
  tuned: TUNED_STACK,
  noisy: NOISY_STACK,
  azure: AZURE_STACK,
  fastest: FASTEST_STACK,
};

export function resolveStack(stack: StackConfig) {
  const stt = STT_PROFILES[stack.stt];
  const llm = LLM_PROFILES[stack.llm];
  const tts = TTS_PROFILES[stack.tts];
  if (!stt) throw new Error(`Unknown stt profile: ${stack.stt}`);
  if (!llm) throw new Error(`Unknown llm profile: ${stack.llm}`);
  if (!tts) throw new Error(`Unknown tts profile: ${stack.tts}`);
  return { stt, llm, tts };
}

/**
 * Whether a stack can actually run the roster. A stack that is 400ms faster and
 * cannot say the greeting in Punjabi is not an option, so the comparison output
 * always carries this next to the timings.
 */
export function stackLanguageCoverage(stack: StackConfig): LanguageCoverage {
  const { stt, tts } = resolveStack(stack);
  const rank: Record<LanguageCoverage, number> = {
    "all-four": 2,
    "no-punjabi": 1,
    "english-spanish": 0,
  };
  return rank[stt.languages] <= rank[tts.languages] ? stt.languages : tts.languages;
}
