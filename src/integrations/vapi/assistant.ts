import { buildBasePrompt, buildFirstMessage, buildShiftPrompt } from "./prompt";
import { buildVapiTools, toolServerUrl } from "./tools";
import type { ShiftCallContext } from "./types";

export const vapiAssistantId = process.env.VAPI_ASSISTANT_ID || "mock-vapi-assistant-id";

/** Vapi phone number ID for the a1mobile number registered in the Vapi dashboard. */
export const vapiPhoneNumberId = process.env.VAPI_PHONE_NUMBER_ID || "";

export const vapiApiBase = "https://api.vapi.ai";

const openaiModel = process.env.VAPI_OPENAI_MODEL || "gpt-4o";

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
      provider: "openai",
      model: "gpt-4o-transcribe",
    },
    voice: {
      provider: "openai",
      voiceId: process.env.VAPI_OPENAI_VOICE || "alloy",
    },
    firstMessage:
      "Hi, this is the scheduling team calling to check your availability for a shift. Do you have a minute?",
    // Let the worker cut in mid-sentence.
    startSpeakingPlan: { waitSeconds: 0.4 },
    stopSpeakingPlan: { numWords: 1, voiceSeconds: 0.2, backoffSeconds: 1 },
    silenceTimeoutSeconds: 20,
    maxDurationSeconds: 300,
    endCallFunctionEnabled: true,
    server: { url: toolServerUrl() },
  };
}

/** Per-call overrides: the shift-specific prompt, greeting and variables. */
export function buildAssistantOverrides(context: ShiftCallContext) {
  return {
    firstMessage: buildFirstMessage(context),
    variableValues: {
      workerId: context.workerId,
      workerName: context.workerName,
      language: context.language,
      role: context.role,
      date: context.date,
      startTime: context.startTime,
      endTime: context.endTime,
      location: context.location,
      pay: context.pay,
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
