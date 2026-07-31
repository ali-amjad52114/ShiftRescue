import { demoWorkers } from "../../data/demo-data";
import type { WorkflowState } from "./types";

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

