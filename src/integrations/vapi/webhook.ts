import type {
  VapiCallEnded,
  VapiDecisionResult,
  VapiToolCallResponse,
  VapiToolCallWebhook,
  WorkerDecision,
} from "./types";

const DECISION_BY_TOOL: Record<string, WorkerDecision> = {
  accept_shift: "accepted",
  decline_shift: "declined",
  needs_clarification: "needs_clarification",
};

/**
 * The last instruction the model sees before it closes. Vapi feeds this back as
 * the tool result, so it outranks the system prompt for the next turn — which
 * makes it the most reliable place to force a short goodbye and an immediate
 * hangup rather than another lap around the shift details.
 */
const SPOKEN_ACK: Record<WorkerDecision, string> = {
  accepted:
    "Recorded. Say ONE short sentence confirming the date and start time and that a text is coming, then call the end call function immediately. Do not restate the shift, do not ask if they need anything else.",
  declined:
    "Recorded. Say ONE short thank-you, then call the end call function immediately. Do not ask them to reconsider.",
  needs_clarification:
    "Logged. Say ONE short sentence that the team will follow up, then call the end call function immediately.",
};

function parseArguments(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw as Record<string, unknown>;
}

/**
 * Extracts the one structured result the backend needs from a Vapi tool-call
 * webhook: { workerId, decision }. Returns null for any other message type.
 */
export function parseVapiToolCall(
  payload: VapiToolCallWebhook
): { toolCallId: string; result: VapiDecisionResult } | null {
  const message = payload?.message;
  if (!message) return null;

  const calls = message.toolCallList || message.toolCalls || [];

  for (const call of calls) {
    const name = ("name" in call && call.name) || call.function?.name;
    const decision = name ? DECISION_BY_TOOL[name] : undefined;
    if (!decision) continue;

    // Vapi has emitted each of these shapes in either its docs or live SDKs.
    // Merge all of them, with top-level trusted values winning.
    const args = {
      ...parseArguments(call.function?.parameters),
      ...parseArguments(call.function?.arguments),
      ...parseArguments("parameters" in call ? call.parameters : undefined),
      ...parseArguments("arguments" in call ? call.arguments : undefined),
    };

    const workerId =
      (typeof args.workerId === "string" && args.workerId) ||
      (message.call?.assistantOverrides?.variableValues?.workerId as string | undefined) ||
      (message.assistant?.variableValues?.workerId as string | undefined);
    const attemptId =
      (typeof args.attemptId === "string" && args.attemptId) ||
      (message.call?.assistantOverrides?.variableValues?.attemptId as string | undefined) ||
      (message.assistant?.variableValues?.attemptId as string | undefined);

    if (!workerId || !attemptId) continue;

    // Model-supplied, unlike the two above. Carried through as free text and
    // clamped against the shift's authorised ceiling by the workflow.
    const agreedPay = typeof args.agreedPay === "string" ? args.agreedPay : undefined;

    return { toolCallId: call.id, result: { workerId, attemptId, decision, agreedPay } };
  }

  return null;
}

/** Reply Vapi expects for a tool call, so the assistant can close the call. */
export function buildToolCallResponse(
  toolCallId: string,
  decision: WorkerDecision
): VapiToolCallResponse {
  return { results: [{ toolCallId, result: SPOKEN_ACK[decision] }] };
}

/** True when the body is a Vapi tool-call envelope rather than a plain result. */
export function isVapiToolCallPayload(payload: unknown): payload is VapiToolCallWebhook {
  return typeof payload === "object" && payload !== null && "message" in payload;
}

/**
 * Vapi's end-of-call report. It arrives for every call, including the ones
 * where nobody picked up and no tool was ever called — which is the only
 * signal the backend gets that a worker is not going to answer.
 */
export function parseVapiCallEnded(payload: VapiToolCallWebhook): VapiCallEnded | null {
  const message = payload?.message;
  if (message?.type !== "end-of-call-report") return null;

  return {
    callId: message.call?.id,
    endedReason: message.endedReason,
  };
}

/**
 * Applies one decision to the backend. The route passes in the workflow
 * reducer directly, so no HTTP hop back into our own API is needed.
 */
export type DecisionDeliverer = (result: VapiDecisionResult) => unknown;

/** Told when a call finished, so a worker who never answered cannot stall the run. */
export type CallEndedHandler = (event: VapiCallEnded) => unknown;

export interface VapiWebhookHandlers {
  onDecision: DecisionDeliverer;
  onCallEnded?: CallEndedHandler;
}

/**
 * Full webhook handler. A tool call carries a decision and gets the reply Vapi
 * needs to close the call politely; an end-of-call report is passed on so the
 * workflow can move to the next worker when no decision ever came. Everything
 * else Vapi sends (speech, transcripts, status) is acknowledged and ignored.
 */
export async function handleVapiWebhook(
  payload: VapiToolCallWebhook,
  handlers: VapiWebhookHandlers
): Promise<{ status: number; body: unknown }> {
  const parsed = parseVapiToolCall(payload);

  if (!parsed) {
    const ended = parseVapiCallEnded(payload);
    if (ended && handlers.onCallEnded) {
      try {
        await handlers.onCallEnded(ended);
      } catch (error) {
        return {
          status: 502,
          body: {
            success: false,
            error: error instanceof Error ? error.message : "Failed to record call end",
          },
        };
      }
    }
    return { status: 200, body: { received: true } };
  }

  try {
    await handlers.onDecision(parsed.result);
  } catch (error) {
    return {
      // A tool response keeps the assistant honest and prevents retries from
      // turning one stale callback into multiple queue mutations.
      status: 200,
      body: {
        results: [
          {
            toolCallId: parsed.toolCallId,
            result:
              "The decision could not be recorded. Do not confirm the shift. Tell the worker the scheduling team will follow up, then end the call.",
          },
        ],
      },
    };
  }

  return { status: 200, body: buildToolCallResponse(parsed.toolCallId, parsed.result.decision) };
}
