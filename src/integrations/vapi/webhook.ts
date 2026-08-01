import { CLEAR_INTENT, readIntent, type WorkerIntent } from "./intent";
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
    "Recorded. Say ONE short sentence: thank them for confirming, name the role, date and start time, and say a confirmation text is on the way. Then call the end call function immediately. Do not repeat the pay, do not ask them to confirm again, do not ask if they need anything else.",
  declined:
    "Recorded. Say ONE short thank-you, then call the end call function immediately. Do not ask them to reconsider.",
  needs_clarification:
    "Logged. Say ONE short sentence that the team will follow up, then call the end call function immediately.",
};

/**
 * What the model is told when the gate below refuses its decision. Same trick
 * as SPOKEN_ACK: this comes back as a tool result, so it is the freshest thing
 * in the model's context and outranks the system prompt for the next turn.
 *
 * Each one is an instruction to ask, never to assume — the gate's job is to buy
 * one more question, not to decide the call itself.
 */
const GATE_INSTRUCTION: Record<GateReason, string> = {
  "no-yes-heard":
    "NOT RECORDED. The worker's last reply did not sound like an acceptance. Do not confirm the shift and do not say it is booked. Ask exactly once, in their language: \"Sorry, just to be clear — can you work this shift, yes or no?\" Wait for their answer, then call the tool that matches it.",
  unsure:
    "NOT RECORDED. The worker's last reply sounded undecided rather than a yes. Do not confirm the shift. Ask exactly once, in their language: \"Just to confirm — are you taking this shift?\" If they do not give a clear yes, call needs_clarification.",
  "missed-yes":
    "NOT LOGGED. The worker's last reply sounded like a yes. Ask exactly once, in their language: \"Just to confirm — you can work this shift?\" If they confirm, call accept_shift. If not, call needs_clarification again and close.",
};

export type GateReason = "no-yes-heard" | "unsure" | "missed-yes";

export interface GateOutcome {
  reason: GateReason;
  /** What the worker actually said, as the transcriber heard it. */
  reply: string;
  intent: WorkerIntent;
  confidence: number;
}

/**
 * What the gate needs to know about the call so far. Supplied by the route,
 * which reads it off the call log, so this module stays free of storage.
 */
export interface ConfirmationContext {
  /** The last thing the worker said before the tool fired. */
  lastWorkerReply?: string;
  /** Whether the gate has already made this call ask again. It gets one turn. */
  alreadyChallenged?: boolean;
}

/**
 * The one check standing between "the model called accept_shift" and "a worker
 * is on the roster".
 *
 * The model is the only thing that hears the call, and mostly it is right. But
 * the two ways it goes wrong are not symmetric: recording an acceptance the
 * worker never gave puts someone on a shift they will not turn up to, while
 * missing one costs a phone call. So the gate is deliberately lopsided —
 * an accept is checked against what the worker actually said, and everything
 * else is left alone except a clear yes that got logged as a non-decision.
 *
 * It fires at most once per call. After that the model has been told to ask a
 * plain yes/no question, and whatever comes back is taken at face value:
 * a second challenge would just loop the worker through the same question.
 */
export function checkConfirmation(
  decision: WorkerDecision,
  context: ConfirmationContext | undefined,
): GateOutcome | null {
  const reply = context?.lastWorkerReply?.trim();
  if (!reply || context?.alreadyChallenged) return null;

  const reading = readIntent(reply);
  if (reading.confidence < CLEAR_INTENT) return null;

  const outcome = (reason: GateReason): GateOutcome => ({
    reason,
    reply,
    intent: reading.intent,
    confidence: reading.confidence,
  });

  if (decision === "accepted") {
    if (reading.intent === "decline" || reading.intent === "stop") return outcome("no-yes-heard");
    if (reading.intent === "unsure") return outcome("unsure");
    return null;
  }

  if (decision === "needs_clarification" && reading.intent === "affirm") {
    return outcome("missed-yes");
  }

  return null;
}

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
  /**
   * Supplies the gate with the worker's last words. Omit it and the gate never
   * fires, which is the old behaviour: whatever tool the model called is what
   * gets recorded.
   */
  confirmationContext?: (result: VapiDecisionResult) => Promise<ConfirmationContext | undefined>;
  /** Called when the gate refuses a decision, so the refusal is on the record. */
  onGateChallenge?: (result: VapiDecisionResult, outcome: GateOutcome) => unknown;
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

  // Before anything is written down: does what the worker said match the tool
  // the model reached for? If not, nothing is recorded and the model is sent
  // back to ask one plain question.
  if (handlers.confirmationContext) {
    let challenge: GateOutcome | null = null;
    try {
      challenge = checkConfirmation(
        parsed.result.decision,
        await handlers.confirmationContext(parsed.result),
      );
    } catch {
      // A gate that cannot read the transcript must not block a real decision.
      challenge = null;
    }

    if (challenge) {
      try {
        await handlers.onGateChallenge?.(parsed.result, challenge);
      } catch {
        // Recording the challenge is a log line, not part of the call.
      }
      return {
        status: 200,
        body: {
          results: [
            { toolCallId: parsed.toolCallId, result: GATE_INSTRUCTION[challenge.reason] },
          ],
        },
      };
    }
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
