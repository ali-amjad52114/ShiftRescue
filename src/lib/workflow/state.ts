import { demoWorkers } from "../../data/demo-data";
import type { WorkflowState } from "./types";

/**
 * The dashboard is public and links to the raw JSON, so nothing returned from an
 * API route may carry worker phone numbers. Strip them from any state we expose.
 */
export function publicWorkflowState(state: WorkflowState) {
  return {
    ...state,
    workers: state.workers.map(({ phone: _phone, ...worker }) => worker),
  };
}

function createInitialState(): WorkflowState {
  return {
    status: "WAITING_FOR_MANAGER_COMMAND",
    shift: null,
    workers: demoWorkers,
    currentWorkerIndex: -1,
    currentWorkerId: null,
    timeline: [],
    proof: {},
  };
}

const globalForWorkflow = globalThis as unknown as {
  workflowState: WorkflowState | undefined;
};

let workflowState = globalForWorkflow.workflowState ?? createInitialState();
globalForWorkflow.workflowState = workflowState;

export function getWorkflowState(): WorkflowState {
  return workflowState;
}

export function updateWorkflowState(newState: WorkflowState): WorkflowState {
  workflowState = newState;
  globalForWorkflow.workflowState = workflowState;
  return workflowState;
}

export function resetWorkflowState(): WorkflowState {
  workflowState = createInitialState();
  globalForWorkflow.workflowState = workflowState;
  return workflowState;
}

