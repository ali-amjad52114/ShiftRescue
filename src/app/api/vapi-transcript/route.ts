import { NextResponse } from "next/server";
import { appendTranscriptLine } from "@/lib/workflow/transcript";
import { publicWorkflowState } from "@/lib/workflow/state";
import { recordTranscriptLine } from "@/lib/calls/log";

/**
 * Live transcript from the call.
 *
 * Vapi posts server messages as { message: { type, role, transcriptType,
 * transcript } } — see https://docs.vapi.ai/server-url/events. The assistant
 * must list "transcript" in its serverMessages for these to arrive.
 *
 * Partial transcripts are provisional and each one replaces the last, so only
 * final lines are recorded; per Vapi's docs a missing transcriptType means
 * final. A flat { speaker, text } body is also accepted for local testing.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const message = body?.message ?? body;

    if (body?.message && message.type && message.type !== "transcript") {
      // Some other server message (status-update, end-of-call-report, …).
      return NextResponse.json({ success: true, ignored: message.type });
    }

    const transcriptType = message.transcriptType ?? "final";
    if (transcriptType !== "final") {
      return NextResponse.json({ success: true, ignored: "partial" });
    }

    const role = message.role;
    const speaker: "agent" | "worker" =
      message.speaker ?? (role === "assistant" || role === "bot" ? "agent" : "worker");

    const workerId =
      message.workerId ?? message.call?.assistantOverrides?.variableValues?.workerId;

    const text = message.transcript ?? message.text ?? "";

    // The live panel keeps only the current call; the call log keeps the whole
    // conversation against the call it belongs to.
    await recordTranscriptLine({
      callId: message.call?.id,
      workerId,
      speaker,
      text,
    });

    const state = await appendTranscriptLine({ speaker, text, workerId });

    return NextResponse.json({ success: true, state: publicWorkflowState(state) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid transcript payload";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
