import { NextResponse, after } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";
import { startCoverage } from "@/lib/workflow/coverage";
import { publicWorkflowState } from "@/lib/workflow/state";

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ success: false, error: "Sign in required" }, { status: 401 });
  }

  try {
    const body = await req.json();
    // The run is recorded before responding; the outbound dial happens behind
    // the response so the button does not hang on a Vapi round trip.
    const state = await startCoverage(body?.shiftId, { defer: after });
    return NextResponse.json({ success: true, state: publicWorkflowState(state) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start coverage";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
