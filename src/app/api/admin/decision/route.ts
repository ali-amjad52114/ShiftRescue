import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";
import { handleVapiResult } from "@/lib/workflow/actions";
import { getWorkflowState, publicWorkflowState } from "@/lib/workflow/state";
import type { WorkerDecision } from "@/lib/workflow/types";

const DECISIONS: WorkerDecision[] = ["accepted", "declined", "needs_clarification"];

/**
 * Operator override for recording a decision by hand — used when a call
 * connected but the assistant's tool webhook never arrived.
 *
 * The attempt id is read from the server's own state rather than accepted from
 * the caller. It is deliberately stripped from /api/status so a leaked webhook
 * cannot advance the queue, and that has to stay true; this route works because
 * it is signed in, not because it knows the id.
 */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ success: false, error: "Sign in required" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const decision = body?.decision as WorkerDecision;

    if (!DECISIONS.includes(decision)) {
      return NextResponse.json(
        { success: false, error: `decision must be one of: ${DECISIONS.join(", ")}` },
        { status: 400 },
      );
    }

    const current = await getWorkflowState();
    if (!current.currentWorkerId || !current.activeAttemptId) {
      return NextResponse.json(
        { success: false, error: "No call is currently in progress" },
        { status: 409 },
      );
    }

    const state = await handleVapiResult({
      workerId: current.currentWorkerId,
      attemptId: current.activeAttemptId,
      decision,
    });

    return NextResponse.json({
      success: true,
      status: state.status,
      state: publicWorkflowState(state),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record the decision";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
