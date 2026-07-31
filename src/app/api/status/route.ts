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
    language: currentWorker ? currentWorker.language : null,
    timeline: state.timeline,
    proof: state.proof,
    state: publicWorkflowState(state),
  });
}
