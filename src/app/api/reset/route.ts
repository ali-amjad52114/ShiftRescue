import { NextResponse } from "next/server";

import { publicWorkflowState, resetWorkflowState } from "@/lib/workflow/state";

export async function POST() {
  return NextResponse.json({
    ...publicWorkflowState(await resetWorkflowState()),
    message: "Workflow state reset",
  });
}
