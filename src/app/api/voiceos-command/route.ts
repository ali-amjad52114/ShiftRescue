import { NextResponse } from "next/server";
import { handleVoiceosCommand } from "@/lib/workflow/actions";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const state = handleVoiceosCommand(body);
    return NextResponse.json({
      success: true,
      status: state.status,
      shift: state.shift,
      currentWorker: state.workers[state.currentWorkerIndex] || null,
      state,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Invalid payload" },
      { status: 400 }
    );
  }
}
