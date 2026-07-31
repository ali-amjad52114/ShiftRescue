// The call log.
//
// When a call goes wrong the first question is "what did we actually send the
// assistant". These check that the answer is recorded, that it is complete
// enough to debug from, and that a logging failure can never take a call down.

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCallLogs,
  closeCallLog,
  getCallLog,
  listCallLogs,
  recordCallEvent,
  recordTranscriptLine,
} from "../../../src/lib/calls/log";
import { startCoverage } from "../../../src/lib/workflow/coverage";
import { handleVapiCallEnded, handleVapiResult } from "../../../src/lib/workflow/actions";
import { getWorkflowState, resetWorkflowState } from "../../../src/lib/workflow/state";
import { resetEmployees } from "../../../src/lib/employees/store";
import { createShift, resetShifts } from "../../../src/lib/shifts/store";

beforeEach(async () => {
  process.env.DEMO_WORKER_1_PHONE = "+14155550101";
  process.env.DEMO_WORKER_2_PHONE = "+14155550102";
  process.env.DEMO_WORKER_3_PHONE = "+14155550103";
  process.env.SIMULATE = "true";
  // Tests exercise the store, not the local file mirror.
  process.env.CALL_LOG_FILE = "off";
  await resetEmployees();
  await resetShifts();
  await resetWorkflowState();
  await clearCallLogs();
});

describe("recordCallEvent", () => {
  it("creates an entry the first time it hears about a call", async () => {
    await recordCallEvent({
      attemptId: "att_1",
      workerId: "emp_maria",
      event: { type: "call.requested", at: new Date().toISOString() },
    });

    const entry = await getCallLog("att_1");
    expect(entry?.workerId).toBe("emp_maria");
    expect(entry?.events).toHaveLength(1);
  });

  it("appends to the same entry rather than creating a second", async () => {
    for (const type of ["call.requested", "call.placed", "decision"] as const) {
      await recordCallEvent({
        attemptId: "att_1",
        workerId: "emp_maria",
        event: { type, at: new Date().toISOString() },
      });
    }

    expect(await listCallLogs()).toHaveLength(1);
    expect((await getCallLog("att_1"))?.events).toHaveLength(3);
  });

  it("applies patches to the entry's own fields", async () => {
    await recordCallEvent({
      attemptId: "att_1",
      workerId: "emp_maria",
      event: { type: "call.placed", at: new Date().toISOString() },
      patch: { callId: "call_abc", workerName: "Maria Alvarez" },
    });

    const entry = await getCallLog("att_1");
    expect(entry?.callId).toBe("call_abc");
    expect(entry?.workerName).toBe("Maria Alvarez");
  });

  it("swallows a store failure rather than taking the call down", async () => {
    // getRedis() throws on Vercel when no Redis is configured. Logging must
    // absorb that: a missing log line is bad, a failed call is worse.
    const previous = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      await expect(
        recordCallEvent({
          attemptId: "att_bad",
          workerId: "emp_maria",
          event: { type: "call.placed", at: new Date().toISOString() },
        }),
      ).resolves.toBeUndefined();
      await expect(
        recordTranscriptLine({ callId: "call_abc", speaker: "agent", text: "hi" }),
      ).resolves.toBeUndefined();
      await expect(closeCallLog({ callId: "call_abc" })).resolves.toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous;
    }
  });
});

describe("recordTranscriptLine", () => {
  beforeEach(async () => {
    await recordCallEvent({
      attemptId: "att_1",
      workerId: "emp_maria",
      event: { type: "call.placed", at: new Date().toISOString() },
      patch: { callId: "call_abc" },
    });
  });

  it("attaches lines to the call they belong to", async () => {
    await recordTranscriptLine({ callId: "call_abc", speaker: "agent", text: "Hi Maria" });
    await recordTranscriptLine({ callId: "call_abc", speaker: "worker", text: "Yes, speaking" });

    const entry = await getCallLog("att_1");
    expect(entry?.transcript.map((l) => l.text)).toEqual(["Hi Maria", "Yes, speaking"]);
    expect(entry?.transcript[0].speaker).toBe("agent");
  });

  it("falls back to the newest open call when Vapi sends no call id", async () => {
    await recordTranscriptLine({ workerId: "emp_maria", speaker: "worker", text: "Hello?" });
    expect((await getCallLog("att_1"))?.transcript).toHaveLength(1);
  });

  it("ignores blank lines", async () => {
    await recordTranscriptLine({ callId: "call_abc", speaker: "agent", text: "   " });
    expect((await getCallLog("att_1"))?.transcript).toHaveLength(0);
  });

  it("does not attach a line to a call that has already ended", async () => {
    await closeCallLog({ callId: "call_abc", endedReason: "customer-ended-call" });
    await recordTranscriptLine({ workerId: "emp_maria", speaker: "worker", text: "late line" });

    expect((await getCallLog("att_1"))?.transcript).toHaveLength(0);
  });
});

describe("closeCallLog", () => {
  it("records how the call ended", async () => {
    await recordCallEvent({
      attemptId: "att_1",
      workerId: "emp_maria",
      event: { type: "call.placed", at: new Date().toISOString() },
      patch: { callId: "call_abc" },
    });

    await closeCallLog({ callId: "call_abc", endedReason: "customer-did-not-answer" });

    const entry = await getCallLog("att_1");
    expect(entry?.endedAt).toBeTruthy();
    expect(entry?.endedReason).toBe("customer-did-not-answer");
    expect(entry?.events.at(-1)?.type).toBe("call.ended");
  });

  it("is a no-op for a call it has never heard of", async () => {
    await expect(closeCallLog({ callId: "nope" })).resolves.toBeUndefined();
  });
});

describe("a real run through the workflow", () => {
  async function startRun() {
    const shift = await createShift({
      role: "Kitchen Assistant",
      startsAt: "2026-08-01T01:00:00.000Z",
      endsAt: "2026-08-01T06:00:00.000Z",
      location: "Downtown San Francisco",
      pay: "$24 per hour",
    });
    await startCoverage(shift.id);
    return getWorkflowState();
  }

  it("logs exactly what the assistant was given", async () => {
    await startRun();
    const [entry] = await listCallLogs();

    expect(entry.assistantInput).toBeTruthy();
    // The greeting and the system prompt, as sent — not a reconstruction.
    expect(entry.assistantInput!.firstMessage).toContain("Kitchen Assistant");
    expect(entry.assistantInput!.firstMessage).toContain("Friday, July 31");
    expect(entry.assistantInput!.systemPrompt).toContain("$24 per hour");
    expect(entry.assistantInput!.variableValues.attemptId).toBe(entry.attemptId);
    expect(entry.assistantInput!.toolNames).toEqual([
      "accept_shift",
      "decline_shift",
      "needs_clarification",
    ]);
  });

  it("never writes a phone number into the log", async () => {
    await startRun();
    const serialised = JSON.stringify(await listCallLogs());
    expect(serialised).not.toContain("+14155550101");
  });

  it("records the decision and the settled rate", async () => {
    const state = await startRun();
    await handleVapiResult({
      workerId: state.currentWorkerId!,
      attemptId: state.activeAttemptId!,
      decision: "accepted",
      agreedPay: "$27 per hour",
    });

    const entry = await getCallLog(state.activeAttemptId!);
    expect(entry?.decision).toBe("accepted");
    expect(entry?.agreedPay).toBe("$27 per hour");
  });

  it("closes the entry when the end-of-call report arrives", async () => {
    const state = await startRun();
    await handleVapiCallEnded({
      callId: state.proof.callId,
      endedReason: "customer-did-not-answer",
    });

    const entry = await getCallLog(state.activeAttemptId!);
    expect(entry?.endedReason).toBe("customer-did-not-answer");
  });

  it("keeps one entry per worker as the queue advances", async () => {
    const state = await startRun();
    await handleVapiResult({
      workerId: state.currentWorkerId!,
      attemptId: state.activeAttemptId!,
      decision: "declined",
    });

    const logs = await listCallLogs();
    expect(logs).toHaveLength(2);
    // Newest first.
    expect(logs[0].workerId).toBe("emp_ahmed");
    expect(logs[1].workerId).toBe("emp_maria");
  });
});
