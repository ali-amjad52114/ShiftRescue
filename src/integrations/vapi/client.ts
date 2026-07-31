import {
  buildAssistantOverrides,
  vapiApiBase,
  vapiAssistantId,
  vapiPhoneNumberId,
} from "./assistant";
import { spokenShiftWindow } from "../../lib/time/schedule";
import { VENUE_NAME } from "../../lib/shifts/store";
import { maxPayFor, maxPayIncrease } from "./pay";
import { resolveLanguage } from "./prompt";
import type {
  ShiftCallContext,
  StartVapiShiftCallInput,
  StartVapiShiftCallResult,
} from "./types";

let mockCallCounter = 0;

/**
 * Turns backend worker + shift data into the only facts the assistant may speak.
 *
 * Shifts are stored as absolute instants, so the spoken date and times are
 * rendered back into the venue's own zone. The pre-rendered strings on the
 * shift are preferred when present, and the instants are the fallback, so a
 * shift written by either shape still reads correctly over the phone.
 */
export function buildShiftCallContext(input: StartVapiShiftCallInput): ShiftCallContext {
  return {
    workerId: input.workerId,
    shiftId: input.shift.id,
    attemptId:
      input.attemptId ??
      `att_${input.workerId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    workerName: input.workerName,
    language: resolveLanguage(input.language),
    role: input.shift.role,
    ...spokenShiftWindow(input.shift),
    location: input.shift.location,
    pay: input.shift.pay,
    maxPay: maxPayFor(input.shift.pay),
    payHeadroom: `$${maxPayIncrease()}`,
    venueName: VENUE_NAME,
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
    const attemptId =
      input.attemptId ??
      `att_${input.workerId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    // Both ids are unique per attempt, like the real thing. A shared constant
    // would let one call's end-of-call report be mistaken for another's and
    // skip a worker who was never actually rung.
    return {
      success: true,
      callId: `mock-vapi-call-${Date.now()}-${mockCallCounter++}`,
      attemptId,
    };
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

    return { success: true, callId: data.id, attemptId: context.attemptId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Vapi call failed",
    };
  }
}
