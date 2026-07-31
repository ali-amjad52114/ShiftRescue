import { NextResponse } from "next/server";

import { isAuthenticated } from "@/lib/auth/session";
import { releaseRescuedShift } from "@/lib/workflow/coverage";
import {
  getWorkflowState,
  publicWorkflowState,
  resetWorkflowState,
} from "@/lib/workflow/state";

/**
 * Clear the current rescue and hand its shift back, so the demo is repeatable.
 *
 * Signed in only: this destroys the evidence of a run, and during judging an
 * open endpoint that wipes live state is not something to leave lying around.
 */
export async function POST() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ success: false, error: "Sign in required" }, { status: 401 });
  }

  await releaseRescuedShift(await getWorkflowState());

  return NextResponse.json({
    ...publicWorkflowState(await resetWorkflowState()),
    message: "Workflow state reset",
  });
}
