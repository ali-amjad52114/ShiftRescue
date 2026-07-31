import { describe, it, expect, beforeEach } from "vitest";
import { getWorkflowState, resetWorkflowState } from "../state";
import { resetEmployees } from "../../employees/store";
import {
  handleVoiceosCommand,
  handleVapiResult,
  handleVoiceosResult,
} from "../actions";

async function submitDecision(
  decision: "accepted" | "declined" | "needs_clarification",
  workerId?: string,
) {
  const state = await getWorkflowState();
  return handleVapiResult({
    workerId: workerId ?? state.currentWorkerId ?? "",
    attemptId: state.activeAttemptId ?? "",
    decision,
  });
}

describe("Workflow Orchestrator Engine", () => {
  beforeEach(async () => {
    // callableEmployees() drops anyone without a number, so the seeded roster
    // needs phones before it can be called at all. No VAPI_API_KEY is set here,
    // so startVapiShiftCall stays in its mock path and dials nobody.
    process.env.DEMO_WORKER_1_PHONE = "+14155550101";
    process.env.DEMO_WORKER_2_PHONE = "+14155550102";
    process.env.DEMO_WORKER_3_PHONE = "+14155550103";
    process.env.SIMULATE = "true";
    await resetEmployees();
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
    expect(state.currentWorkerId).toBe("emp_maria");
    expect(state.timeline).toHaveLength(2);
    expect(state.timeline[0].message).toContain("Uncovered Kitchen Assistant shift created");
    expect(state.timeline[1].message).toContain("Calling Maria Alvarez in Spanish");
  });

  it("should advance to Worker 2 (Ahmed) when Worker 1 declines", async () => {
    await handleVoiceosCommand({
      role: "Kitchen Assistant",
      date: "July 31",
      startTime: "6:00 PM",
      endTime: "10:00 PM",
      location: "Downtown San Francisco",
    });

    const state = await submitDecision("declined");

    expect(state.status).toBe("CALLING_WORKER");
    expect(state.currentWorkerIndex).toBe(1);
    expect(state.currentWorkerId).toBe("emp_ahmed");
    expect(state.timeline.some((t) => t.message.includes("Maria Alvarez declined"))).toBe(true);
    expect(state.timeline.some((t) => t.message.includes("Calling Ahmed Khan in Urdu"))).toBe(true);
  });

  it("should transition to TRIGGERING_VOICEOS when Worker 2 accepts", async () => {
    await handleVoiceosCommand({
      role: "Kitchen Assistant",
      date: "July 31",
      startTime: "6:00 PM",
      endTime: "10:00 PM",
      location: "Downtown San Francisco",
    });

    await submitDecision("declined");
    const state = await submitDecision("accepted");

    expect(state.status).toBe("TRIGGERING_VOICEOS");
    expect(state.shift?.assignedWorkerId).toBe("emp_ahmed");
    expect(state.timeline.some((t) => t.message.includes("Ahmed Khan accepted"))).toBe(true);
  });

  it("should ignore late worker callbacks once someone has already accepted", async () => {
    await handleVoiceosCommand({
      role: "Kitchen Assistant",
      date: "July 31",
      startTime: "6:00 PM",
      endTime: "10:00 PM",
      location: "Downtown San Francisco",
    });

    await submitDecision("declined");
    await submitDecision("accepted");

    const stateAfterLateCallback = await handleVapiResult({
      workerId: "emp_john",
      attemptId: "att_stale",
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

    await submitDecision("declined");
    await submitDecision("accepted");

    const state = await handleVoiceosResult({
      success: true,
      scheduleUpdated: true,
      calendarEventId: "calendar_proof_99",
      slackMessageId: "slack_proof_99",
      gmailMessageId: "gmail_proof_99",
      spreadsheetId: "sheet_proof_99",
      spreadsheetUpdateRange: "'Shift Events'!A8:V8",
    });

    expect(state.status).toBe("COMPLETE");
    expect(state.proof.calendarEventId).toBe("calendar_proof_99");
    expect(state.proof.slackMessageId).toBe("slack_proof_99");
    expect(state.proof.gmailMessageId).toBe("gmail_proof_99");
    expect(state.proof.spreadsheetId).toBe("sheet_proof_99");
    expect(state.proof.smsMessageId).toMatch(/^sim-sms-/);
  });

  const command = {
    role: "Kitchen Assistant",
    date: "July 31",
    startTime: "6:00 PM",
    endTime: "10:00 PM",
    location: "Downtown San Francisco",
  };

  it("should reject VoiceOS success without complete real proof", async () => {
    await handleVoiceosCommand(command);
    await submitDecision("accepted");

    await expect(handleVoiceosResult({ success: true })).rejects.toThrow(
      "scheduleUpdated must be true",
    );

    // callId comes from placing the call and is real. What must not appear is
    // any VoiceOS proof, since VoiceOS supplied none.
    const { proof } = await getWorkflowState();
    expect(proof.scheduleUpdated).toBeUndefined();
    expect(proof.calendarEventId).toBeUndefined();
    expect(proof.slackMessageId).toBeUndefined();
    expect(proof.gmailMessageId).toBeUndefined();
    expect(proof.spreadsheetId).toBeUndefined();
    expect(proof.smsMessageId).toBeUndefined();
  });

  it("should not claim the SMS was sent without a message ID", async () => {
    await handleVoiceosCommand(command);
    await submitDecision("accepted");

    process.env.SIMULATE = "false";
    delete process.env.A1MOBILE_API_KEY;
    delete process.env.A1MOBILE_TEAM_KEY;
    delete process.env.A1_TEAM_KEY;

    const state = await handleVoiceosResult({
      success: true,
      scheduleUpdated: true,
      calendarEventId: "cal_1",
      slackMessageId: "slack_1",
      gmailMessageId: "gmail_1",
      spreadsheetId: "sheet_1",
      spreadsheetUpdateRange: "'Shift Events'!A8:V8",
    });

    // No a1mobile credentials here, so the send fails. The run must stop at
    // SENDING_SMS rather than invent a message id it never received.
    expect(state.status).toBe("SENDING_SMS");
    expect(state.proof.smsMessageId).toBeUndefined();
    expect(state.timeline.some((t) => t.message.includes("Rescue complete"))).toBe(false);
    expect(state.timeline.at(-1)?.message).toContain("Confirmation SMS to Maria Alvarez failed");
  });

  it("should send the confirmation SMS itself when VoiceOS supplies no id", async () => {
    process.env.SIMULATE = "true";
    try {
      await handleVoiceosCommand(command);
      await submitDecision("accepted");

      const state = await handleVoiceosResult({
        success: true,
        scheduleUpdated: true,
        calendarEventId: "cal_1",
        slackMessageId: "slack_1",
        gmailMessageId: "gmail_1",
        spreadsheetId: "sheet_1",
        spreadsheetUpdateRange: "'Shift Events'!A8:V8",
      });

      expect(state.status).toBe("COMPLETE");
      expect(state.proof.smsMessageId).toMatch(/^sim-sms-/);
      expect(state.timeline.at(-1)?.message).toContain("Rescue complete");
    } finally {
      delete process.env.SIMULATE;
    }
  });

  it("should text the worker who accepted, not whoever was mid-call", async () => {
    process.env.SIMULATE = "true";
    try {
      await handleVoiceosCommand(command);
      await submitDecision("declined");
      await submitDecision("accepted");

      const state = await handleVoiceosResult({
        success: true,
        scheduleUpdated: true,
        calendarEventId: "cal_1",
        slackMessageId: "slack_1",
        gmailMessageId: "gmail_1",
        spreadsheetId: "sheet_1",
        spreadsheetUpdateRange: "'Shift Events'!A8:V8",
      });

      expect(state.shift?.assignedWorkerId).toBe("emp_ahmed");
      expect(state.status).toBe("COMPLETE");
      expect(state.proof.smsMessageId).toBeTruthy();
    } finally {
      delete process.env.SIMULATE;
    }
  });

  it("should ignore a duplicate decline from a worker who is no longer being called", async () => {
    await handleVoiceosCommand(command);
    const firstAttempt = (await getWorkflowState()).activeAttemptId!;
    await submitDecision("declined");

    // Retried webhook for worker-1 while worker-2 is on the phone.
    await expect(
      handleVapiResult({
        workerId: "emp_maria",
        attemptId: firstAttempt,
        decision: "declined",
      }),
    ).rejects.toThrow("active call attempt");
    const state = await getWorkflowState();

    expect(state.currentWorkerId).toBe("emp_ahmed");
    expect(state.timeline.filter((t) => t.message.includes("Maria Alvarez declined"))).toHaveLength(1);
  });

  it("should reject an acceptance from someone who is not on the active attempt", async () => {
    await handleVoiceosCommand(command);
    await expect(submitDecision("accepted", "emp_ahmed")).rejects.toThrow(
      "active call attempt",
    );
    const state = await getWorkflowState();

    expect(state.shift?.assignedWorkerId).toBeNull();
    expect(state.currentWorkerId).toBe("emp_maria");
    expect(state.currentWorkerIndex).toBe(0);
  });

  it("should resolve the spoken shift window into absolute instants", async () => {
    const state = await handleVoiceosCommand(command);

    expect(state.shift?.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(state.shift?.timeZone).toBeTruthy();
    expect(new Date(state.shift!.endsAt!).getTime()).toBeGreaterThan(
      new Date(state.shift!.startsAt!).getTime(),
    );
  });

  it("should pre-render the window for the dashboard and the SMS", async () => {
    const state = await handleVoiceosCommand(command);

    // ShiftCard and the a1mobile message builders read these directly; an
    // unpopulated field renders as the literal string "undefined".
    expect(state.shift?.date).toContain("July");
    expect(state.shift?.startTime).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
    expect(state.shift?.endTime).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
  });

  it("should place a call when the manager command arrives", async () => {
    const state = await handleVoiceosCommand(command);

    expect(state.status).toBe("CALLING_WORKER");
    expect(state.proof.callId).toBeTruthy();
    expect(state.activeAttemptId).toBeTruthy();
  });

  it("should place a call for the next worker after a decline", async () => {
    await handleVoiceosCommand(command);
    const firstAttempt = (await getWorkflowState()).activeAttemptId;
    const state = await submitDecision("declined");

    expect(state.currentWorkerId).toBe("emp_ahmed");
    expect(state.proof.callId).toBeTruthy();
    expect(state.activeAttemptId).toBeTruthy();
    expect(state.activeAttemptId).not.toBe(firstAttempt);
  });

  it("should not keep dialling once the roster is spent", async () => {
    await handleVoiceosCommand(command);
    await submitDecision("declined");
    await submitDecision("declined");
    const state = await submitDecision("declined");

    expect(state.status).toBe("INCOMPLETE");
    expect(state.currentWorkerId).toBeNull();
    expect(state.timeline.at(-1)?.message).toContain("All workers declined");
  });

  it("should reject a malformed manager command", async () => {
    await expect(handleVoiceosCommand({ role: "Kitchen Assistant" } as never)).rejects.toThrow(
      /Missing required shift fields/,
    );
    expect((await getWorkflowState()).status).toBe("WAITING_FOR_MANAGER_COMMAND");
  });

  it("should reject blank Calendar or Slack proof IDs", async () => {
    await expect(
      handleVoiceosResult({
        success: true,
        scheduleUpdated: true,
        calendarEventId: "",
        slackMessageId: "slack_proof_99",
        gmailMessageId: "gmail_proof_99",
        spreadsheetId: "sheet_proof_99",
        spreadsheetUpdateRange: "'Shift Events'!A8:V8",
      }),
    ).rejects.toThrow("Real calendarEventId");
  });
});
