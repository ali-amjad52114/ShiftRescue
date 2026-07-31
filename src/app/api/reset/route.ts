import { NextResponse } from "next/server";

import { publicWorkflowState, resetWorkflowState } from "@/lib/workflow/state";

export async function POST() {
  return NextResponse.json({
    ...publicWorkflowState(resetWorkflowState()),
    message: "mock reset response",
  });
}
