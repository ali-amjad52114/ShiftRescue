import { NextResponse } from "next/server";

import { getWorkflowState } from "@/lib/workflow/state";

export async function GET() {
  return NextResponse.json({
    ...getWorkflowState(),
    message: "mock status response",
  });
}
