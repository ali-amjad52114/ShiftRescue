import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";
import { startCoverage } from "@/lib/workflow/coverage";
import { publicWorkflowState } from "@/lib/workflow/state";

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ success: false, error: "Sign in required" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const state = await startCoverage(body?.shiftId);
    return NextResponse.json({ success: true, state: publicWorkflowState(state) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start coverage";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
