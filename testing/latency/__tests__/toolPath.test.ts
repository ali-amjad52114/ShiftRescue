// The tool-webhook path.
//
// Vapi holds the assistant silent until this webhook replies, so the property
// under test is structural rather than a stopwatch: nothing that needs a
// network round trip may happen before the reply is produced.

import { beforeEach, describe, expect, it } from "vitest";
import { handleVapiCallEnded, handleVapiResult } from "../../../src/lib/workflow/actions";
import { getWorkflowState, resetWorkflowState } from "../../../src/lib/workflow/state";
import { resetEmployees } from "../../../src/lib/employees/store";
import { handleVoiceosCommand } from "../../../src/lib/workflow/actions";
import { handleVapiWebhook } from "../../../src/integrations/vapi";
import { toolCallEnvelope } from "../fixtures.ts";

/** Captures deferred work instead of running it, standing in for after(). */
function capturingDefer() {
  const tasks: Array<() => Promise<void>> = [];
  return {
    defer: (task: () => Promise<void>) => {
      tasks.push(task);
    },
    tasks,
    async runAll() {
      for (const task of tasks) await task();
    },
  };
}

const SHIFT = {
  role: "Kitchen Assistant",
  date: "July 31",
  startTime: "6:00 PM",
  endTime: "10:00 PM",
  location: "Downtown San Francisco",
  pay: "$24 per hour",
};

describe("decision webhook", () => {
  beforeEach(async () => {
    process.env.DEMO_WORKER_1_PHONE = "+14155550101";
    process.env.DEMO_WORKER_2_PHONE = "+14155550102";
    process.env.DEMO_WORKER_3_PHONE = "+14155550103";
    process.env.SIMULATE = "true";
    await resetEmployees();
    await resetWorkflowState();
    await handleVoiceosCommand(SHIFT);
  });

  it("records the decline and advances the queue before replying", async () => {
    const started = await getWorkflowState();
    const { defer, tasks } = capturingDefer();

    await handleVapiResult(
      { workerId: started.currentWorkerId!, attemptId: started.activeAttemptId!, decision: "declined" },
      { defer },
    );

    const committed = await getWorkflowState();
    expect(committed.currentWorkerId).toBe("emp_ahmed");
    expect(committed.status).toBe("CALLING_WORKER");
    // The decline is durable even if the deferred dial never runs.
    expect(committed.timeline.some((e) => e.message.includes("declined"))).toBe(true);
    expect(tasks).toHaveLength(1);
  });

  it("does not dial the next worker before the reply is produced", async () => {
    const started = await getWorkflowState();
    const { defer, runAll } = capturingDefer();

    await handleVapiResult(
      { workerId: started.currentWorkerId!, attemptId: started.activeAttemptId!, decision: "declined" },
      { defer },
    );

    // No call has been placed yet: this is the round trip the worker used to
    // wait through before hearing the closing line.
    expect((await getWorkflowState()).activeAttemptId).toBeNull();

    await runAll();
    expect((await getWorkflowState()).activeAttemptId).toBeTruthy();
  });

  it("still dials inline when no defer is supplied", async () => {
    const started = await getWorkflowState();
    const state = await handleVapiResult({
      workerId: started.currentWorkerId!,
      attemptId: started.activeAttemptId!,
      decision: "declined",
    });

    expect(state.currentWorkerId).toBe("emp_ahmed");
    expect(state.activeAttemptId).toBeTruthy();
  });

  it("does not dial twice if the deferred task runs after another webhook already did", async () => {
    const started = await getWorkflowState();
    const { defer, runAll } = capturingDefer();

    await handleVapiResult(
      { workerId: started.currentWorkerId!, attemptId: started.activeAttemptId!, decision: "declined" },
      { defer },
    );

    await runAll();
    const first = (await getWorkflowState()).activeAttemptId;
    await runAll();
    expect((await getWorkflowState()).activeAttemptId).toBe(first);
  });

  it("defers the dial on the end-of-call path too", async () => {
    const started = await getWorkflowState();
    const { defer, tasks } = capturingDefer();

    await handleVapiCallEnded(
      { callId: started.proof.callId, endedReason: "customer-did-not-answer" },
      { defer },
    );

    expect(tasks).toHaveLength(1);
    expect((await getWorkflowState()).activeAttemptId).toBeNull();
    expect((await getWorkflowState()).currentWorkerId).toBe("emp_ahmed");
  });

  it("returns the toolCallId reply Vapi needs to close the call", async () => {
    const started = await getWorkflowState();
    const { defer } = capturingDefer();

    const { status, body } = await handleVapiWebhook(
      toolCallEnvelope({
        workerId: started.currentWorkerId!,
        attemptId: started.activeAttemptId!,
        toolName: "decline_shift",
      }) as never,
      { onDecision: (result) => handleVapiResult(result, { defer }) },
    );

    expect(status).toBe(200);
    expect(JSON.stringify(body)).toContain("toolCallId");
  });
});
