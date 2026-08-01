import {
  callbackInviteSms,
  localizeShift,
  normalizeLanguage,
  shiftConfirmationSms,
} from "./messages";
import type { ShiftDetails } from "./messages";
import { buildAssistantOverrides } from "../vapi/assistant";
import { maxPayFor, maxPayIncrease } from "../vapi/pay";
import { resolveLanguage } from "../vapi/prompt";
import { buildVapiTools } from "../vapi/tools";
import { recordCallEvent } from "../../lib/calls/log";
import { VENUE_NAME } from "../../lib/shifts/store";
import type { ShiftCallContext } from "../vapi/types";
import type {
  A1MobileCallResult,
  A1MobileClaimedNumber,
  A1MobileResult,
  A1MobileSmsResult,
  OriginationMode,
} from "./types";

const A1_BASE_URL = "https://hack.a1mobile.com";
const VAPI_BASE_URL = "https://api.vapi.ai";

// Accept every name the docs and .env.example have used. Picking one and being
// "right" just means someone loses an hour to a silently empty header.
function teamKey(): string {
  return (
    process.env.A1MOBILE_API_KEY ||
    process.env.A1MOBILE_TEAM_KEY ||
    process.env.A1_TEAM_KEY ||
    ""
  );
}

function originationMode(): OriginationMode {
  return process.env.ORIGINATION === "inbound" ? "inbound" : "outbound";
}

function isSimulated(): boolean {
  return process.env.SIMULATE === "true";
}

async function a1Fetch<T>(
  path: string,
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const key = teamKey();
  if (!key) {
    return { ok: false, error: "A1MOBILE_API_KEY is not set" };
  }

  try {
    const response = await fetch(`${A1_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "X-Team-Key": key,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      return { ok: false, error: `a1mobile ${response.status}: ${text}` };
    }

    return { ok: true, data: (text ? JSON.parse(text) : {}) as T };
  } catch (error) {
    return { ok: false, error: `a1mobile request failed: ${String(error)}` };
  }
}

/**
 * Numbers a1mobile will let us dial. Only OTP-verified numbers may be called,
 * so a roster entry missing from this list can never produce a conversation —
 * it rings, the carrier answers, and the call dies in silence. Worth knowing
 * before a demo rather than during one.
 */
export async function listVerifiedNumbers(): Promise<
  { ok: true; numbers: string[] } | { ok: false; error: string }
> {
  const key = teamKey();
  if (!key) return { ok: false, error: "no a1mobile team key" };

  try {
    const response = await fetch(`${A1_BASE_URL}/api/verified-numbers`, {
      headers: { "X-Team-Key": key },
    });
    if (!response.ok) return { ok: false, error: `a1mobile ${response.status}` };
    const data = (await response.json()) as { verified_numbers?: string[] };
    return { ok: true, numbers: data.verified_numbers ?? [] };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

export async function claimA1MobileNumber(): Promise<
  A1MobileResult & { number?: A1MobileClaimedNumber }
> {
  const result = await a1Fetch<{
    phone_number: string;
    sip_username: string;
    sip_password: string;
  }>("/api/numbers/claim");

  if (!result.ok) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    number: {
      phoneNumber: result.data.phone_number,
      sipUsername: result.data.sip_username,
      sipPassword: result.data.sip_password,
    },
  };
}

export async function pointA1MobileNumber(
  webhookUrl: string,
): Promise<A1MobileResult> {
  const result = await a1Fetch("/api/numbers/point", {
    webhook_url: webhookUrl,
  });

  return result.ok
    ? { success: true }
    : { success: false, error: result.error };
}

export async function requestNumberVerification(
  phone: string,
): Promise<A1MobileResult> {
  const result = await a1Fetch("/api/verified-numbers", { phone });

  return result.ok
    ? { success: true }
    : { success: false, error: result.error };
}

export async function confirmNumberVerification(
  phone: string,
  code: string,
): Promise<A1MobileResult> {
  const result = await a1Fetch("/api/verified-numbers/confirm", {
    phone,
    code,
  });

  return result.ok
    ? { success: true }
    : { success: false, error: result.error };
}

export async function sendA1MobileSms(input: {
  phone: string;
  message: string;
}): Promise<A1MobileSmsResult> {
  if (isSimulated()) {
    return {
      success: true,
      messageId: `sim-sms-${Date.now()}`,
      status: "sent",
    };
  }

  const result = await a1Fetch<{ id?: string; message_id?: string }>(
    "/api/sms",
    { to: input.phone, body: input.message },
  );

  if (!result.ok) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    messageId: result.data.message_id || result.data.id || "accepted",
    status: "sent",
  };
}

/**
 * Everything the assistant is allowed to know about this call.
 *
 * The caller passes the shift already rendered into spoken strings; anything
 * missing here is heard as a blank on the phone, so the shape is built in one
 * place rather than inline at the fetch.
 */
export function buildCallContext(input: {
  workerId: string;
  language: string;
  shiftId: string;
  attemptId: string;
  workerName?: string;
  shift?: ShiftDetails;
}): ShiftCallContext {
  // This is the builder the live dial actually uses — dialViaVapi() below, not
  // the one in vapi/client.ts. The shift is stored once, in English; handing
  // that straight to a Spanish call had the assistant reading "un turno de
  // Server ... con pago de $21 per hour", because the prompt tells it to state
  // the facts exactly as given. Translating here, the same way the confirmation
  // SMS already does, means what reaches the call is already in the right
  // language and the prompt has nothing left to get wrong.
  const language = resolveLanguage(input.language);
  const spokenLanguage = normalizeLanguage(language);

  const englishShift: ShiftDetails = {
    role: input.shift?.role ?? "",
    date: input.shift?.date ?? "",
    startTime: input.shift?.startTime ?? "",
    endTime: input.shift?.endTime ?? "",
    location: input.shift?.location ?? "",
    pay: input.shift?.pay ?? "",
  };

  const localized = localizeShift(englishShift, spokenLanguage);

  // The ceiling is spoken out loud the moment anyone negotiates, so it goes
  // through the same translation — from the English source, never from the
  // already-translated copy.
  const maxPay = localizeShift(
    { ...englishShift, pay: maxPayFor(englishShift.pay) },
    spokenLanguage,
  ).pay;

  return {
    workerId: input.workerId,
    shiftId: input.shiftId,
    attemptId: input.attemptId,
    language,
    workerName: input.workerName ?? "",
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

async function dialViaVapi(input: {
  workerId: string;
  phone: string;
  language: string;
  shiftId: string;
  attemptId: string;
  workerName?: string;
  shift?: ShiftDetails;
}): Promise<A1MobileCallResult> {
  const apiKey = process.env.VAPI_API_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;

  if (!apiKey || !assistantId || !phoneNumberId) {
    return {
      success: false,
      mode: "outbound",
      error:
        "VAPI_API_KEY, VAPI_ASSISTANT_ID and VAPI_PHONE_NUMBER_ID must all be set",
    };
  }

  // Keep a1mobile as the transport boundary while applying the per-call prompt
  // and server-trusted decision tools on every dial.
  const context = buildCallContext(input);
  const overrides = buildAssistantOverrides(context);

  // Logged before the dial, so a call that fails to connect still leaves a
  // record of exactly what we were about to say.
  await recordCallEvent({
    attemptId: input.attemptId,
    workerId: input.workerId,
    event: { type: "call.requested", at: new Date().toISOString() },
    patch: {
      workerName: context.workerName,
      language: context.language,
      shiftId: context.shiftId,
      assistantInput: {
        assistantId,
        firstMessage: overrides.firstMessage,
        systemPrompt: overrides.model.messages[0]?.content ?? "",
        variableValues: overrides.variableValues,
        model: overrides.model.model,
        toolNames: buildVapiTools().map((tool) => tool.function.name),
      },
    },
  });

  try {
    const response = await fetch(`${VAPI_BASE_URL}/call/phone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistantId,
        phoneNumberId,
        customer: { number: input.phone },
        assistantOverrides: overrides,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      await recordCallEvent({
        attemptId: input.attemptId,
        workerId: input.workerId,
        event: {
          type: "call.failed",
          at: new Date().toISOString(),
          detail: { status: response.status, body: text.slice(0, 500) },
        },
      });
      return {
        success: false,
        mode: "outbound",
        error: `vapi ${response.status}: ${text}`,
      };
    }

    const data = JSON.parse(text) as { id?: string };
    await recordCallEvent({
      attemptId: input.attemptId,
      workerId: input.workerId,
      event: { type: "call.placed", at: new Date().toISOString(), detail: { callId: data.id } },
      patch: { callId: data.id },
    });

    return {
      success: true,
      mode: "outbound",
      callId: data.id,
      attemptId: input.attemptId,
    };
  } catch (error) {
    await recordCallEvent({
      attemptId: input.attemptId,
      workerId: input.workerId,
      event: { type: "call.failed", at: new Date().toISOString(), detail: { error: String(error) } },
    });
    return {
      success: false,
      mode: "outbound",
      error: `vapi request failed: ${String(error)}`,
    };
  }
}

export async function sendShiftConfirmationSms(input: {
  phone: string;
  language: string;
  workerName: string;
  shift: ShiftDetails;
}): Promise<A1MobileSmsResult> {
  return sendA1MobileSms({
    phone: input.phone,
    message: shiftConfirmationSms(input.language, input.workerName, input.shift),
  });
}

async function inviteCallbackViaSms(input: {
  phone: string;
  language: string;
  attemptId: string;
  shift?: ShiftDetails;
}): Promise<A1MobileCallResult> {
  const number = process.env.A1MOBILE_PHONE_NUMBER;
  if (!number) {
    return {
      success: false,
      mode: "inbound",
      error: "A1MOBILE_PHONE_NUMBER is not set",
    };
  }

  const sms = await sendA1MobileSms({
    phone: input.phone,
    message: callbackInviteSms(input.language, number, input.shift),
  });

  if (!sms.success) {
    return {
      success: false,
      mode: "inbound",
      attemptId: input.attemptId,
      error: sms.error,
    };
  }

  return {
    success: true,
    mode: "inbound",
    callId: sms.messageId,
    attemptId: input.attemptId,
  };
}

export async function startA1MobileCall(input: {
  workerId: string;
  phone: string;
  language: string;
  shiftId: string;
  attemptId?: string;
  workerName?: string;
  shift?: ShiftDetails;
}): Promise<A1MobileCallResult> {
  // Every attempt gets an id. The assistant echoes it back with the decision so
  // a duplicate or late webhook cannot advance the workflow twice.
  const attemptId =
    input.attemptId ??
    `att_${input.workerId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  if (isSimulated()) {
    // Simulated calls are logged too, so the call log can be exercised without
    // dialling anyone and a local run shows the same shape as production.
    const callId = `sim-call-${input.workerId}-${Date.now()}`;
    const context = buildCallContext({ ...input, attemptId });
    const overrides = buildAssistantOverrides(context);
    await recordCallEvent({
      attemptId,
      workerId: input.workerId,
      event: { type: "call.placed", at: new Date().toISOString(), detail: { callId, simulated: true } },
      patch: {
        callId,
        workerName: context.workerName,
        language: context.language,
        shiftId: context.shiftId,
        assistantInput: {
          firstMessage: overrides.firstMessage,
          systemPrompt: overrides.model.messages[0]?.content ?? "",
          variableValues: overrides.variableValues,
          toolNames: buildVapiTools().map((tool) => tool.function.name),
        },
      },
    });

    return {
      success: true,
      mode: originationMode(),
      callId,
      attemptId,
    };
  }

  if (!input.phone) {
    return {
      success: false,
      attemptId,
      error: `no phone number for ${input.workerId}`,
    };
  }

  return originationMode() === "inbound"
    ? inviteCallbackViaSms({ ...input, attemptId })
    : dialViaVapi({ ...input, attemptId });
}
