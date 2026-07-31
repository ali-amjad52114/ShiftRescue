import { getRedis } from "../redis";
import { callableEmployees } from "../employees/store";
import type { WorkflowState } from "./types";

const STATE_KEY = "shiftrescue:workflow";

/**
 * The dashboard is public and anything here can be read by any visitor, so
 * employee phone numbers are stripped from every API response.
 */
export function publicWorkflowState(state: WorkflowState) {
  const { activeAttemptId: _activeAttemptId, ...publicState } = state;
  return {
    ...publicState,
    workers: state.workers.map(({ phone: _phone, ...worker }) => worker),
  };
}

function createInitialState(workers: WorkflowState["workers"]): WorkflowState {
  return {
    status: "WAITING_FOR_MANAGER_COMMAND",
    shift: null,
    workers,
    currentWorkerIndex: -1,
    currentWorkerId: null,
    activeAttemptId: null,
    timeline: [],
    transcript: [],
    proof: {},
  };
}

const globalForWorkflow = globalThis as unknown as {
  workflowState: WorkflowState | undefined;
};

/**
 * The roster is owned by the employee store, never by the persisted run — so an
 * edit on the team page is picked up immediately and a stale copy of someone's
 * phone number can't linger in Redis. The call position is tracked by id and
 * the index re-derived, so adding or removing an employee mid-run cannot make
 * the workflow call the wrong person.
 */
async function hydrate(stored: WorkflowState | null): Promise<WorkflowState> {
  const workers = await callableEmployees();
  if (!stored) return createInitialState(workers);

  const index = stored.currentWorkerId
    ? workers.findIndex((w) => w.id === stored.currentWorkerId)
    : stored.currentWorkerIndex;

  return {
    ...stored,
    workers,
    currentWorkerIndex: index,
    activeAttemptId: stored.activeAttemptId ?? null,
  };
}

export async function getWorkflowState(): Promise<WorkflowState> {
  const redis = getRedis();
  if (!redis) return hydrate(globalForWorkflow.workflowState ?? null);
  return hydrate(await redis.get<WorkflowState>(STATE_KEY));
}

export async function updateWorkflowState(newState: WorkflowState): Promise<WorkflowState> {
  const redis = getRedis();
  if (!redis) {
    globalForWorkflow.workflowState = newState;
    return newState;
  }

  // Workers are hydrated from the employee store on read; persisting them here
  // would duplicate phone numbers into a second place.
  await redis.set(STATE_KEY, { ...newState, workers: [] });
  return newState;
}

export async function resetWorkflowState(): Promise<WorkflowState> {
  return updateWorkflowState(createInitialState(await callableEmployees()));
}

export { storageMode } from "../redis";
