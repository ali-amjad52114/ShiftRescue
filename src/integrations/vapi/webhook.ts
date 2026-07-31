import type {
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

const SPOKEN_ACK: Record<WorkerDecision, string> = {
  accepted: "Shift assigned. Confirm the shift is theirs and that a confirmation text is on the way, then end the call.",
  declined: "Decline recorded. Thank the worker and end the call.",
  needs_clarification: "Logged for follow-up. Tell the worker the team will follow up, then end the call.",
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

    const args = {
      ...parseArguments(call.function?.arguments),
      ...(("arguments" in call && call.arguments) || {}),
    };

    const workerId =
      (typeof args.workerId === "string" && args.workerId) ||
      (message.call?.assistantOverrides?.variableValues?.workerId as string | undefined) ||
      (message.assistant?.variableValues?.workerId as string | undefined);

    if (!workerId) continue;

    return { toolCallId: call.id, result: { workerId, decision } };
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
 * Applies one decision to the backend. The route passes in the workflow
 * reducer directly, so no HTTP hop back into our own API is needed.
 */
export type DecisionDeliverer = (result: VapiDecisionResult) => unknown;

/**
 * Full webhook handler: parse the tool call, apply the decision via `deliver`,
 * and return the reply body Vapi expects so the assistant can close the call.
 */
export async function handleVapiWebhook(
  payload: VapiToolCallWebhook,
  deliver: DecisionDeliverer
): Promise<{ status: number; body: unknown }> {
  const parsed = parseVapiToolCall(payload);

  if (!parsed) {
    return { status: 200, body: { received: true } };
  }

  try {
    await deliver(parsed.result);
  } catch (error) {
    return {
      status: 502,
      body: {
        success: false,
        error: error instanceof Error ? error.message : "Failed to record decision",
      },
    };
  }

  return { status: 200, body: buildToolCallResponse(parsed.toolCallId, parsed.result.decision) };
}
