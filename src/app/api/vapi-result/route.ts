import { NextResponse, after } from "next/server";
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
      // The assistant stays silent until this response lands, so the decision
      // is recorded here and dialling the next worker — a full Vapi API round
      // trip — is pushed behind the response with after(). Without this the
      // worker hears half a second of dead air before the closing line.
      const { status, body: reply } = await handleVapiWebhook(body, {
        onDecision: (result) => handleVapiResult(result, { defer: after }),
        onCallEnded: (event) => handleVapiCallEnded(event, { defer: after }),
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
