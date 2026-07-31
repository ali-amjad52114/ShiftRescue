import { NextResponse } from "next/server";
import { handleVapiResult } from "@/lib/workflow/actions";
import { publicWorkflowState } from "@/lib/workflow/state";

export async function POST(req: Request) {
  try {
    const body = await req.json();
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
