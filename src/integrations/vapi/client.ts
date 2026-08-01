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
import { localizeShift, normalizeLanguage } from "../a1mobile/messages";
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
  // The backend holds one English copy of the shift. Handing that straight to
  // a Spanish call produced "un turno de Server ... con pago de $21 per hour":
  // the assistant was told to state the facts exactly, so it read the English.
  // Translate them here, the same way the confirmation SMS already does, so
  // what reaches the call is already in the right language.
  const language = resolveLanguage(input.language);
  const spokenLanguage = normalizeLanguage(language);
  const englishShift = {
    role: input.shift.role,
    // Spoken forms come from the instants when the shift has no written ones,
    // which is every shift created from the schedule.
    ...spokenShiftWindow(input.shift),
    location: input.shift.location,
    pay: input.shift.pay,
  };

  const localized = localizeShift(englishShift, spokenLanguage);

  // The negotiating ceiling is spoken out loud too, so it goes through the same
  // translation — from the English source, never from the already-translated
  // copy. Left in English it was the one number that broke the rule against
  // English inside a Spanish call.
  const maxPay = localizeShift(
    { ...englishShift, pay: maxPayFor(input.shift.pay) },
    spokenLanguage,
  ).pay;

  return {
    workerId: input.workerId,
    shiftId: input.shift.id,
    attemptId:
      input.attemptId ??
      `att_${input.workerId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    workerName: input.workerName,
    language,
    role: localized.role,
    date: localized.date,
    startTime: localized.startTime,
    endTime: localized.endTime,
    location: localized.location,
    pay: localized.pay,
    maxPay,
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
