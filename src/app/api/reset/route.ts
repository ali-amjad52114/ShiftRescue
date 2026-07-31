import { NextResponse } from "next/server";

import { resetWorkflowState } from "@/lib/workflow/state";

export async function POST() {
  return NextResponse.json({
    ...resetWorkflowState(),
    message: "mock reset response",
  });
}
