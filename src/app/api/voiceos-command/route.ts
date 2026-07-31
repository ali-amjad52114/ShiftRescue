import { NextResponse } from "next/server";
import { handleVoiceosCommand } from "@/lib/workflow/actions";
import { publicWorkflowState } from "@/lib/workflow/state";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const state = await handleVoiceosCommand(body);
    const safe = publicWorkflowState(state);
    return NextResponse.json({
      success: true,
      status: state.status,
      shift: state.shift,
      currentWorker: safe.workers[state.currentWorkerIndex] || null,
      state: safe,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Invalid payload" },
      { status: 400 }
    );
  }
}
