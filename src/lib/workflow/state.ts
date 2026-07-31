import { demoWorkers } from "@/data/demo-data";
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

let workflowState = createInitialState();

export function getWorkflowState(): WorkflowState {
  return workflowState;
}

export function resetWorkflowState(): WorkflowState {
  workflowState = createInitialState();
  return workflowState;
}
