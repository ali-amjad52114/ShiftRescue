import {
  buildAssistantOverrides,
  vapiApiBase,
  vapiAssistantId,
  vapiPhoneNumberId,
} from "./assistant";
import { resolveLanguage } from "./prompt";
import type {
  ShiftCallContext,
  StartVapiShiftCallInput,
  StartVapiShiftCallResult,
} from "./types";

/**
 * Shifts are stored as absolute instants, but the assistant has to say them out
 * loud. These render back into the venue's own zone, in the 12-hour form people
 * actually speak ("Friday, 31 July", "6:00 PM").
 */
function spokenDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

function spokenTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** Turns backend worker + shift data into the only facts the assistant may speak. */
export function buildShiftCallContext(input: StartVapiShiftCallInput): ShiftCallContext {
  const { startsAt, endsAt, timeZone } = input.shift;

  return {
    workerId: input.workerId,
    workerName: input.workerName,
    language: resolveLanguage(input.language),
    role: input.shift.role,
    date: spokenDate(startsAt, timeZone),
    startTime: spokenTime(startsAt, timeZone),
    endTime: spokenTime(endsAt, timeZone),
    location: input.shift.location,
    pay: input.shift.pay,
  };
}

/**
 * Starts one outbound call from the a1mobile number to the worker.
 * Falls back to the mock call ID when Vapi credentials are absent, so the
 * demo workflow still runs locally.
 */
export async function startVapiShiftCall(
  input: StartVapiShiftCallInput
): Promise<StartVapiShiftCallResult> {
  const apiKey = process.env.VAPI_API_KEY;

  if (!apiKey || !process.env.VAPI_ASSISTANT_ID || !vapiPhoneNumberId) {
    return { success: true, callId: "mock-vapi-call-id" };
  }

  if (!input.phone) {
    return { success: false, error: `No phone number for ${input.workerId}` };
  }

  const context = buildShiftCallContext(input);

  try {
    const res = await fetch(`${vapiApiBase}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistantId: vapiAssistantId,
        phoneNumberId: vapiPhoneNumberId,
        customer: { number: input.phone, name: input.workerName },
        assistantOverrides: buildAssistantOverrides(context),
      }),
    });

    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };

    if (!res.ok) {
      return {
        success: false,
        error: `Vapi call failed (${res.status}): ${data.message || "unknown error"}`,
      };
    }

    return { success: true, callId: data.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Vapi call failed",
    };
  }
}
