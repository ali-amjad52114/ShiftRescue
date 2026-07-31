import { Redis } from "@upstash/redis";
import { demoWorkers } from "../../data/demo-data";
import type { WorkflowState } from "./types";

const STATE_KEY = "shiftrescue:workflow";

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

/**
 * Vercel serves requests from several function instances, each with its own
 * memory — so a Vapi webhook and the dashboard's poll can land on different
 * instances and disagree about the run. Redis gives every instance one shared
 * copy of the workflow.
 *
 * Locally, with no Redis configured, an in-process object is equivalent: one
 * `next dev` process is the only reader and writer. In production that is not
 * true, so a deployment without Redis fails loudly rather than quietly serving
 * a run that other instances cannot see.
 */
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;

  // The Vercel/Upstash integration injects KV_REST_API_* rather than the
  // UPSTASH_REDIS_REST_* names Redis.fromEnv() expects, so read both.
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    if (process.env.VERCEL === "1") {
      throw new Error(
        "Workflow state requires Redis in production. Set KV_REST_API_URL and " +
          "KV_REST_API_TOKEN (vercel integration add upstash/upstash-kv).",
      );
    }
    return null;
  }

  redis = new Redis({ url, token });
  return redis;
}

const globalForWorkflow = globalThis as unknown as {
  workflowState: WorkflowState | undefined;
};

function memoryState(): WorkflowState {
  if (!globalForWorkflow.workflowState) {
    globalForWorkflow.workflowState = createInitialState();
  }
  return globalForWorkflow.workflowState;
}

export async function getWorkflowState(): Promise<WorkflowState> {
  const client = getRedis();
  if (!client) return memoryState();

  const stored = await client.get<WorkflowState>(STATE_KEY);
  if (!stored) return createInitialState();

  // Workers are code, not stored data — always take the current roster so
  // phone numbers and languages cannot go stale in Redis.
  return { ...stored, workers: demoWorkers };
}

export async function updateWorkflowState(newState: WorkflowState): Promise<WorkflowState> {
  const client = getRedis();
  if (!client) {
    globalForWorkflow.workflowState = newState;
    return newState;
  }

  await client.set(STATE_KEY, { ...newState, workers: [] });
  return newState;
}

export async function resetWorkflowState(): Promise<WorkflowState> {
  const fresh = createInitialState();
  return updateWorkflowState(fresh);
}

/** Which store is backing the workflow — surfaced so the demo can't silently run split-brain. */
export function storageMode(): "redis" | "memory" {
  return getRedis() ? "redis" : "memory";
}
