import { NextResponse } from "next/server";
import { getWorkflowState, publicWorkflowState } from "@/lib/workflow/state";

export async function GET() {
  const state = await getWorkflowState();
  const currentWorker =
    state.currentWorkerIndex >= 0 && state.currentWorkerIndex < state.workers.length
      ? state.workers[state.currentWorkerIndex]
      : null;

  return NextResponse.json({
    status: state.status,
    shift: state.shift,
    currentWorker: currentWorker ? currentWorker.name : null,
    workerId: currentWorker ? currentWorker.id : null,
    // activeAttemptId is deliberately NOT published. It is the one value that
    // makes /api/vapi-result un-forgeable, and this route is public — anyone
    // could read it mid-call and post a decision the worker never made. The
    // operator override at /api/admin/decision reads it server-side instead.
    language: currentWorker ? currentWorker.language : null,
    timeline: state.timeline,
    proof: state.proof,
    state: publicWorkflowState(state),
  });
}
