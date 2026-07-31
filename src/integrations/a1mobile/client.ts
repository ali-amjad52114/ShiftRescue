import { callbackInviteSms, shiftConfirmationSms } from "./messages";
import type { ShiftDetails } from "./messages";
import type {
  A1MobileCallResult,
  A1MobileClaimedNumber,
  A1MobileResult,
  A1MobileSmsResult,
  OriginationMode,
} from "./types";

const A1_BASE_URL = "https://hack.a1mobile.com";
const VAPI_BASE_URL = "https://api.vapi.ai";

function teamKey(): string {
  return process.env.A1MOBILE_API_KEY || process.env.A1_TEAM_KEY || "";
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

async function dialViaVapi(input: {
  workerId: string;
  phone: string;
  language: string;
  shiftId: string;
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
        // Everything the prompt needs, so shift details live in one place
        // instead of being hardcoded into the assistant. Piotre templates
        // these as {{workerName}}, {{role}}, {{pay}} and so on.
        assistantOverrides: {
          variableValues: {
            workerId: input.workerId,
            shiftId: input.shiftId,
            language: input.language,
            workerName: input.workerName ?? "",
            role: input.shift?.role ?? "",
            date: input.shift?.date ?? "",
            startTime: input.shift?.startTime ?? "",
            endTime: input.shift?.endTime ?? "",
            location: input.shift?.location ?? "",
            pay: input.shift?.pay ?? "",
          },
        },
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      return {
        success: false,
        mode: "outbound",
        error: `vapi ${response.status}: ${text}`,
      };
    }

    const data = JSON.parse(text) as { id?: string };
    return { success: true, mode: "outbound", callId: data.id };
  } catch (error) {
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
    return { success: false, mode: "inbound", error: sms.error };
  }

  return { success: true, mode: "inbound", callId: sms.messageId };
}

export async function startA1MobileCall(input: {
  workerId: string;
  phone: string;
  language: string;
  shiftId: string;
  workerName?: string;
  shift?: ShiftDetails;
}): Promise<A1MobileCallResult> {
  if (isSimulated()) {
    return {
      success: true,
      mode: originationMode(),
      callId: `sim-call-${input.workerId}-${Date.now()}`,
    };
  }

  if (!input.phone) {
    return { success: false, error: `no phone number for ${input.workerId}` };
  }

  return originationMode() === "inbound"
    ? inviteCallbackViaSms(input)
    : dialViaVapi(input);
}
