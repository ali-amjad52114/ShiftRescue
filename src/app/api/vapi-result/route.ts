import { NextResponse, after } from "next/server";
import { handleVapiCallEnded, handleVapiResult } from "@/lib/workflow/actions";
import { publicWorkflowState } from "@/lib/workflow/state";
import { handleVapiWebhook, isVapiToolCallPayload } from "@/integrations/vapi";
import { appendTranscriptLine } from "@/lib/workflow/transcript";
import { syncScheduleAssignment } from "@/lib/workflow/coverage";
import { getCallLog, recordCallEvent, recordTranscriptLine } from "@/lib/calls/log";
import type { ConfirmationContext, GateOutcome, VapiDecisionResult } from "@/integrations/vapi";

/**
 * How stale the worker's last transcript line may be and still be treated as
 * the answer this tool call is about.
 *
 * Vapi delivers transcripts and tool calls to the same URL but makes no promise
 * about the order they arrive in. When the deciding line has not landed yet,
 * the newest line on the log is from an earlier turn — and challenging a
 * decision on the strength of something the worker said half a minute ago is
 * worse than not challenging at all. Past this age the gate stands down.
 */
const RECENT_REPLY_MS = 20_000;

/**
 * Everything the confirmation gate needs, read off the call log: what the
 * worker last said, and whether the gate has already had its one turn.
 */
async function confirmationContext(
  result: VapiDecisionResult,
): Promise<ConfirmationContext | undefined> {
  const entry = await getCallLog(result.attemptId);
  if (!entry) return undefined;

  const last = [...entry.transcript].reverse().find((line) => line.speaker === "worker");
  const fresh = last && Date.now() - Date.parse(last.at) <= RECENT_REPLY_MS;

  return {
    lastWorkerReply: fresh ? last.text : undefined,
    alreadyChallenged: entry.events.some((event) => event.type === "decision.challenged"),
  };
}

/** Puts a refused decision on the record, so a bad gate is visible in the log. */
async function recordGateChallenge(result: VapiDecisionResult, outcome: GateOutcome) {
  await recordCallEvent({
    attemptId: result.attemptId,
    workerId: result.workerId,
    event: {
      type: "decision.challenged",
      at: new Date().toISOString(),
      detail: {
        decision: result.decision,
        reason: outcome.reason,
        heard: outcome.reply,
        intent: outcome.intent,
        confidence: outcome.confidence,
      },
    },
  });
}

/**
 * Record the decision, then mirror an acceptance onto the schedule so the gap
 * actually closes on the calendar. Without this the workflow knew who had
 * accepted but the shift stayed unfilled on screen.
 */
async function recordDecision(
  payload: Parameters<typeof handleVapiResult>[0],
  options?: Parameters<typeof handleVapiResult>[1],
) {
  const state = await handleVapiResult(payload, options);
  await syncScheduleAssignment(state);
  return state;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const message = body?.message;

    // Vapi sends every server message to one URL, so the live transcript lands
    // here alongside tool calls. Partials replace each other, so only final
    // lines are kept (a missing transcriptType means final).
    if (message?.type === "transcript") {
      if ((message.transcriptType ?? "final") !== "final") {
        return NextResponse.json({ success: true, ignored: "partial" });
      }
      const speaker =
        message.role === "assistant" || message.role === "bot" ? "agent" : "worker";
      const workerId = message.call?.assistantOverrides?.variableValues?.workerId;
      const text = message.transcript ?? "";

      // The live panel keeps only the current call; the call log keeps the
      // whole conversation against the call it belongs to.
      await recordTranscriptLine({ callId: message.call?.id, workerId, speaker, text });
      await appendTranscriptLine({ speaker, text, workerId });
      return NextResponse.json({ success: true });
    }

    // Vapi tool calls arrive as a { message: { toolCallList } } envelope and
    // expect a toolCallId-keyed reply so the assistant can close the call.
    // Plain { workerId, decision } bodies come from the demo controls.
    if (isVapiToolCallPayload(body)) {
      // The assistant stays silent until this response lands, so the decision
      // is recorded here and dialling the next worker — a full Vapi API round
      // trip — is pushed behind the response with after(). Without this the
      // worker hears half a second of dead air before the closing line.
      const { status, body: reply } = await handleVapiWebhook(body, {
        onDecision: (result) => recordDecision(result, { defer: after }),
        onCallEnded: (event) => handleVapiCallEnded(event, { defer: after }),
        confirmationContext,
        onGateChallenge: recordGateChallenge,
      });
      return NextResponse.json(reply, { status });
    }

    const state = await recordDecision(body);
    return NextResponse.json({
      success: true,
      status: state.status,
      state: publicWorkflowState(state),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Invalid payload" },
      { status: 400 }
    );
  }
}
