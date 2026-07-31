// Call outcome detection.
//
// A call attempt can end without the worker ever making a decision -- nobody
// picked up, it went to voicemail, the trunk failed, or they hung up mid
// sentence. Without this the workflow waits forever for a decision that is
// never coming, which on stage looks identical to a crash.

import type { CallOutcome, CallStatus } from "./types";

const VAPI_BASE_URL = "https://api.vapi.ai";

// Vapi reports why a call ended via `endedReason`. Group them by what the
// workflow should do, not by what went wrong technically.
const NO_ANSWER = [
  "customer-did-not-answer",
  "customer-busy",
  "voicemail",
  "no-answer",
];

const ANSWERED = [
  "customer-ended-call",
  "assistant-ended-call",
  "assistant-forwarded-call",
  "silence-timed-out",
  "exceeded-max-duration",
];

export function classifyEndedReason(
  endedReason: string | undefined,
  status: string | undefined,
): CallOutcome {
  if (!endedReason) {
    if (status === "ended") return "unknown";
    return "in-progress";
  }

  const reason = endedReason.toLowerCase();

  if (NO_ANSWER.some((value) => reason.includes(value))) return "no-answer";
  if (ANSWERED.some((value) => reason.includes(value))) return "answered";

  // Anything naming the transport or the media pipeline is a real failure:
  // pipeline-error-*, call.in-progress.error-*, sip-*, twilio-*, vapi-error-*.
  if (
    reason.includes("error") ||
    reason.includes("sip") ||
    reason.includes("failed") ||
    reason.includes("rejected")
  ) {
    return "failed";
  }

  return "unknown";
}

export async function getCallOutcome(callId: string): Promise<CallStatus> {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) {
    return { callId, outcome: "unknown", error: "VAPI_API_KEY is not set" };
  }

  try {
    const response = await fetch(`${VAPI_BASE_URL}/call/${callId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      return {
        callId,
        outcome: "unknown",
        error: `vapi ${response.status}: ${await response.text()}`,
      };
    }

    const data = (await response.json()) as {
      status?: string;
      endedReason?: string;
      transcript?: string;
      startedAt?: string;
      endedAt?: string;
    };

    const durationSeconds =
      data.startedAt && data.endedAt
        ? Math.round(
            (new Date(data.endedAt).getTime() -
              new Date(data.startedAt).getTime()) /
              1000,
          )
        : undefined;

    return {
      callId,
      outcome: classifyEndedReason(data.endedReason, data.status),
      status: data.status,
      endedReason: data.endedReason,
      transcript: data.transcript,
      durationSeconds,
    };
  } catch (error) {
    return {
      callId,
      outcome: "unknown",
      error: `vapi request failed: ${String(error)}`,
    };
  }
}

// Poll until the call ends or we give up. The workflow uses this to decide that
// an attempt produced no decision, so it can move to the next worker honestly
// instead of stalling.
export async function waitForCallOutcome(
  callId: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<CallStatus> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const intervalMs = options.intervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  let last: CallStatus = { callId, outcome: "in-progress" };

  while (Date.now() < deadline) {
    last = await getCallOutcome(callId);
    if (last.outcome !== "in-progress") return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return { ...last, outcome: last.outcome === "in-progress" ? "unknown" : last.outcome };
}
