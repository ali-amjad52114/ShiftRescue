import { NextResponse } from "next/server";
import { handleVoiceosResult } from "@/lib/workflow/actions";
import { publicWorkflowState } from "@/lib/workflow/state";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const state = handleVoiceosResult(body);
    return NextResponse.json({
      success: true,
      status: state.status,
      proof: state.proof,
      state: publicWorkflowState(state),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Invalid payload" },
      { status: 400 }
    );
  }
}
