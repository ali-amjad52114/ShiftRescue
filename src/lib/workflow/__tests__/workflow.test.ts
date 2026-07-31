import { describe, it, expect, beforeEach } from "vitest";
import { getWorkflowState, resetWorkflowState } from "../state";
import {
  handleVoiceosCommand,
  handleVapiResult,
  handleVoiceosResult,
} from "../actions";

describe("Workflow Orchestrator Engine", () => {
  beforeEach(async () => {
    await resetWorkflowState();
  });

  it("should initialize with default empty state", async () => {
    const state = await getWorkflowState();
    expect(state.status).toBe("WAITING_FOR_MANAGER_COMMAND");
    expect(state.shift).toBeNull();
    expect(state.timeline).toHaveLength(0);
    expect(state.proof).toEqual({});
  });

  it("should process manager command and begin calling Worker 1 (Maria)", async () => {
    const payload = {
      role: "Kitchen Assistant",
      date: "July 31",
      startTime: "6:00 PM",
      endTime: "10:00 PM",
      location: "Downtown San Francisco",
      pay: "$24 per hour",
    };

    const state = await handleVoiceosCommand(payload);

    expect(state.status).toBe("CALLING_WORKER");
    expect(state.shift?.role).toBe("Kitchen Assistant");
    expect(state.currentWorkerIndex).toBe(0);
    expect(state.currentWorkerId).toBe("worker-1");
    expect(state.timeline).toHaveLength(2);
    expect(state.timeline[0].message).toContain("Uncovered Kitchen Assistant shift created");
    expect(state.timeline[1].message).toContain("Calling Maria in Spanish");
  });

  it("should advance to Worker 2 (Ahmed) when Worker 1 declines", async () => {
    await handleVoiceosCommand({
      role: "Kitchen Assistant",
      date: "July 31",
      startTime: "6:00 PM",
      endTime: "10:00 PM",
      location: "Downtown San Francisco",
    });

    const state = await handleVapiResult({
      workerId: "worker-1",
      decision: "declined",
    });

    expect(state.status).toBe("CALLING_WORKER");
    expect(state.currentWorkerIndex).toBe(1);
    expect(state.currentWorkerId).toBe("worker-2");
    expect(state.timeline.some((t) => t.message.includes("Maria declined"))).toBe(true);
    expect(state.timeline.some((t) => t.message.includes("Calling Ahmed in Urdu"))).toBe(true);
  });

  it("should transition to TRIGGERING_VOICEOS when Worker 2 accepts", async () => {
    await handleVoiceosCommand({
      role: "Kitchen Assistant",
      date: "July 31",
      startTime: "6:00 PM",
      endTime: "10:00 PM",
      location: "Downtown San Francisco",
    });

    await handleVapiResult({ workerId: "worker-1", decision: "declined" });
    const state = await handleVapiResult({ workerId: "worker-2", decision: "accepted" });

    expect(state.status).toBe("TRIGGERING_VOICEOS");
    expect(state.shift?.assignedWorkerId).toBe("worker-2");
    expect(state.timeline.some((t) => t.message.includes("Ahmed accepted"))).toBe(true);
  });

  it("should ignore late worker callbacks once someone has already accepted", async () => {
    await handleVoiceosCommand({
      role: "Kitchen Assistant",
      date: "July 31",
      startTime: "6:00 PM",
      endTime: "10:00 PM",
      location: "Downtown San Francisco",
    });

    await handleVapiResult({ workerId: "worker-1", decision: "declined" });
    await handleVapiResult({ workerId: "worker-2", decision: "accepted" });

    const stateAfterLateCallback = await handleVapiResult({
      workerId: "worker-3",
      decision: "declined",
    });

    expect(stateAfterLateCallback.status).toBe("TRIGGERING_VOICEOS");
  });

  it("should store proof IDs and mark COMPLETE upon VoiceOS success", async () => {
    await handleVoiceosCommand({
      role: "Kitchen Assistant",
      date: "July 31",
      startTime: "6:00 PM",
      endTime: "10:00 PM",
      location: "Downtown San Francisco",
    });

    await handleVapiResult({ workerId: "worker-2", decision: "accepted" });

    const state = await handleVoiceosResult({
      success: true,
      scheduleUpdated: true,
      calendarEventId: "calendar_proof_99",
      slackMessageId: "slack_proof_99",
      smsMessageId: "sms_proof_99",
    });

    expect(state.status).toBe("COMPLETE");
    expect(state.proof.calendarEventId).toBe("calendar_proof_99");
    expect(state.proof.slackMessageId).toBe("slack_proof_99");
    expect(state.proof.smsMessageId).toBe("sms_proof_99");
  });

  const command = {
    role: "Kitchen Assistant",
    date: "July 31",
    startTime: "6:00 PM",
    endTime: "10:00 PM",
    location: "Downtown San Francisco",
  };

  it("should never invent proof IDs when VoiceOS reports success without them", async () => {
    await handleVoiceosCommand(command);
    await handleVapiResult({ workerId: "worker-1", decision: "accepted" });

    const state = await handleVoiceosResult({ success: true });

    expect(state.proof.calendarEventId).toBeUndefined();
    expect(state.proof.slackMessageId).toBeUndefined();
    expect(state.proof.smsMessageId).toBeUndefined();
    expect(state.proof.scheduleUpdated).toBeUndefined();
    // Nothing was confirmed, so the run must not claim to be complete.
    expect(state.status).not.toBe("COMPLETE");
  });

  it("should not claim the SMS was sent without a message ID", async () => {
    await handleVoiceosCommand(command);
    await handleVapiResult({ workerId: "worker-1", decision: "accepted" });

    const state = await handleVoiceosResult({
      success: true,
      scheduleUpdated: true,
      calendarEventId: "cal_1",
      slackMessageId: "slack_1",
    });

    expect(state.status).toBe("SENDING_SMS");
    expect(state.proof.smsMessageId).toBeUndefined();
    expect(state.timeline.some((t) => t.message.includes("Rescue complete"))).toBe(false);
  });

  it("should ignore a duplicate decline from a worker who is no longer being called", async () => {
    await handleVoiceosCommand(command);
    await handleVapiResult({ workerId: "worker-1", decision: "declined" });

    // Retried webhook for worker-1 while worker-2 is on the phone.
    const state = await handleVapiResult({ workerId: "worker-1", decision: "declined" });

    expect(state.currentWorkerId).toBe("worker-2");
    expect(state.timeline.filter((t) => t.message.includes("Maria declined"))).toHaveLength(1);
  });

  it("should credit the worker who actually accepted", async () => {
    await handleVoiceosCommand(command);
    const state = await handleVapiResult({ workerId: "worker-2", decision: "accepted" });

    expect(state.shift?.assignedWorkerId).toBe("worker-2");
    expect(state.currentWorkerId).toBe("worker-2");
    expect(state.currentWorkerIndex).toBe(1);
  });

  it("should reject a malformed manager command", async () => {
    await expect(handleVoiceosCommand({ role: "Kitchen Assistant" } as never)).rejects.toThrow(
      /Missing required shift fields/,
    );
    expect((await getWorkflowState()).status).toBe("WAITING_FOR_MANAGER_COMMAND");
  });
});
