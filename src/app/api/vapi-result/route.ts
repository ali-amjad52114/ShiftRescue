import { NextResponse } from "next/server";
import { handleVapiCallEnded, handleVapiResult } from "@/lib/workflow/actions";
import { publicWorkflowState } from "@/lib/workflow/state";
import { handleVapiWebhook, isVapiToolCallPayload } from "@/integrations/vapi";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Vapi tool calls arrive as a { message: { toolCallList } } envelope and
    // expect a toolCallId-keyed reply so the assistant can close the call.
    // Plain { workerId, decision } bodies come from the demo controls.
    if (isVapiToolCallPayload(body)) {
      const { status, body: reply } = await handleVapiWebhook(body, {
        onDecision: handleVapiResult,
        onCallEnded: handleVapiCallEnded,
      });
      return NextResponse.json(reply, { status });
    }

    const state = await handleVapiResult(body);
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
