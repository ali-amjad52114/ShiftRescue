import { NextResponse, after } from "next/server";
import { handleVapiCallEnded, handleVapiResult } from "@/lib/workflow/actions";
import { publicWorkflowState } from "@/lib/workflow/state";
import { handleVapiWebhook, isVapiToolCallPayload } from "@/integrations/vapi";
import { appendTranscriptLine } from "@/lib/workflow/transcript";
import { syncScheduleAssignment } from "@/lib/workflow/coverage";
import { recordTranscriptLine } from "@/lib/calls/log";

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
