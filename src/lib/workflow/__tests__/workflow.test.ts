import { describe, it, expect, beforeEach } from "vitest";
import { getWorkflowState, resetWorkflowState } from "../state";
import {
  handleVoiceosCommand,
  handleVapiResult,
  handleVoiceosResult,
} from "../actions";

describe("Workflow Orchestrator Engine", () => {
  beforeEach(() => {
    resetWorkflowState();
  });

  it("should initialize with default empty state", () => {
    const state = getWorkflowState();
    expect(state.status).toBe("WAITING_FOR_MANAGER_COMMAND");
    expect(state.shift).toBeNull();
    expect(state.timeline).toHaveLength(0);
    expect(state.proof).toEqual({});
  });

  it("should process manager command and begin calling Worker 1 (Maria)", () => {
    const payload = {
      role: "Kitchen Assistant",
      date: "July 31",
      startTime: "6:00 PM",
      endTime: "10:00 PM",
      location: "Downtown San Francisco",
      pay: "$24 per hour",
    };

    const state = handleVoiceosCommand(payload);

    expect(state.status).toBe("CALLING_WORKER");
    expect(state.shift?.role).toBe("Kitchen Assistant");
    expect(state.currentWorkerIndex).toBe(0);
    expect(state.currentWorkerId).toBe("worker-1");
    expect(state.timeline).toHaveLength(2);
    expect(state.timeline[0].message).toContain("Uncovered Kitchen Assistant shift created");
    expect(state.timeline[1].message).toContain("Calling Maria in Spanish");
  });

  it("should advance to Worker 2 (Ahmed) when Worker 1 declines", () => {
    handleVoiceosCommand({
      role: "Kitchen Assistant",
      date: "July 31",
      startTime: "6:00 PM",
      endTime: "10:00 PM",
      location: "Downtown San Francisco",
    });

    const state = handleVapiResult({
      workerId: "worker-1",
      decision: "declined",
    });

    expect(state.status).toBe("CALLING_WORKER");
    expect(state.currentWorkerIndex).toBe(1);
    expect(state.currentWorkerId).toBe("worker-2");
    expect(state.timeline.some((t) => t.message.includes("Maria declined"))).toBe(true);
    expect(state.timeline.some((t) => t.message.includes("Calling Ahmed in Urdu"))).toBe(true);
  });

  it("should transition to TRIGGERING_VOICEOS when Worker 2 accepts", () => {
    handleVoiceosCommand({
      role: "Kitchen Assistant",
      date: "July 31",
      startTime: "6:00 PM",
      endTime: "10:00 PM",
      location: "Downtown San Francisco",
    });

    handleVapiResult({ workerId: "worker-1", decision: "declined" });
    const state = handleVapiResult({ workerId: "worker-2", decision: "accepted" });

    expect(state.status).toBe("TRIGGERING_VOICEOS");
    expect(state.shift?.assignedWorkerId).toBe("worker-2");
    expect(state.timeline.some((t) => t.message.includes("Ahmed accepted"))).toBe(true);
  });

  it("should ignore late worker callbacks once someone has already accepted", () => {
    handleVoiceosCommand({
      role: "Kitchen Assistant",
      date: "July 31",
      startTime: "6:00 PM",
      endTime: "10:00 PM",
      location: "Downtown San Francisco",
    });

    handleVapiResult({ workerId: "worker-1", decision: "declined" });
    handleVapiResult({ workerId: "worker-2", decision: "accepted" });

    const stateAfterLateCallback = handleVapiResult({
      workerId: "worker-3",
      decision: "declined",
    });

    expect(stateAfterLateCallback.status).toBe("TRIGGERING_VOICEOS");
  });

  it("should store proof IDs and mark COMPLETE upon VoiceOS success", () => {
    handleVoiceosCommand({
      role: "Kitchen Assistant",
      date: "July 31",
      startTime: "6:00 PM",
      endTime: "10:00 PM",
      location: "Downtown San Francisco",
    });

    handleVapiResult({ workerId: "worker-2", decision: "accepted" });

    const state = handleVoiceosResult({
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
});
