import { describe, it, expect, beforeEach } from "vitest";
import { getWorkflowState, resetWorkflowState } from "../state";
import { resetEmployees } from "../../employees/store";
import { createShift, getShift, resetShifts, updateShift } from "../../shifts/store";
import { startCoverage, isRescueActive, releaseRescuedShift } from "../coverage";
import { handleVapiResult } from "../actions";

/**
 * The schedule's "Find coverage" button is the primary way a rescue starts, and
 * this module had no tests at all — which is how it shipped setting
 * CALLING_WORKER and writing "Calling Maria in Spanish" to the timeline without
 * ever placing a call. The suite was green because every other test drove
 * handleVoiceosCommand, which does dial.
 */
describe("Coverage from the schedule", () => {
  let openShiftId: string;

  beforeEach(async () => {
    process.env.DEMO_WORKER_1_PHONE = "+14155550101";
    process.env.DEMO_WORKER_2_PHONE = "+14155550102";
    process.env.DEMO_WORKER_3_PHONE = "+14155550103";
    process.env.SIMULATE = "true";
    await resetEmployees();
    await resetShifts();
    await resetWorkflowState();

    const shift = await createShift({
      role: "Kitchen Assistant",
      startsAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(),
      location: "Downtown San Francisco",
      pay: "$24 per hour",
    });
    openShiftId = shift.id;
  });

  it("should actually place a call, not just say it is calling", async () => {
    const state = await startCoverage(openShiftId);

    expect(state.status).toBe("CALLING_WORKER");
    expect(state.currentWorkerId).toBe("emp_maria");
    // The call is the point. A timeline entry without a call id is the exact
    // fabricated success this is here to prevent.
    expect(state.proof.callId).toBeTruthy();
    expect(state.activeAttemptId).toBeTruthy();
    expect(state.timeline.some((t) => t.message.includes("Calling Maria Alvarez"))).toBe(true);
  });

  it("should pin the run to the shift that was clicked", async () => {
    const state = await startCoverage(openShiftId);
    expect(state.shift?.id).toBe(openShiftId);
    expect(state.shift?.role).toBe("Kitchen Assistant");
  });

  it("should refuse a second rescue while one is already running", async () => {
    const other = await createShift({
      role: "Server",
      startsAt: new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
    });

    await startCoverage(openShiftId);
    await expect(startCoverage(other.id)).rejects.toThrow("already running");

    // The run in flight is untouched.
    const state = await getWorkflowState();
    expect(state.shift?.id).toBe(openShiftId);
    expect(isRescueActive(state)).toBe(true);
  });

  it("should refuse a shift that already has somebody on it", async () => {
    const covered = await createShift({
      role: "Server",
      startsAt: new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
      assignedEmployeeId: "emp_john",
    });

    await expect(startCoverage(covered.id)).rejects.toThrow("already covered");
  });

  it("should refuse a shift that does not exist", async () => {
    await expect(startCoverage("sh_nope")).rejects.toThrow("No shift with id");
  });

  it("should mark the schedule covered once a worker accepts", async () => {
    const started = await startCoverage(openShiftId);

    await handleVapiResult({
      workerId: started.currentWorkerId!,
      attemptId: started.activeAttemptId!,
      decision: "accepted",
    });

    const scheduled = await getShift(openShiftId);
    expect(scheduled?.assignedEmployeeId).toBe("emp_maria");
  });

  it("should clear the previous attempt id when a new rescue starts", async () => {
    const first = await startCoverage(openShiftId);
    await handleVapiResult({
      workerId: first.currentWorkerId!,
      attemptId: first.activeAttemptId!,
      decision: "accepted",
    });

    const next = await createShift({
      role: "Server",
      startsAt: new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
    });
    const second = await startCoverage(next.id);

    // Carrying the old attempt forward would let the first worker's stale
    // webhook mutate the new run.
    expect(second.activeAttemptId).not.toBe(first.activeAttemptId);
    expect(second.proof.callId).not.toBe(first.proof.callId);
  });

  it("should hand the shift back when the rescue is cleared", async () => {
    const started = await startCoverage(openShiftId);
    await handleVapiResult({
      workerId: started.currentWorkerId!,
      attemptId: started.activeAttemptId!,
      decision: "accepted",
    });
    expect((await getShift(openShiftId))?.assignedEmployeeId).toBe("emp_maria");

    await releaseRescuedShift(await getWorkflowState());

    // The gap the demo exists to close has to be there again, or the next run
    // has nothing to rescue.
    expect((await getShift(openShiftId))?.assignedEmployeeId).toBeNull();
  });

  it("should not un-assign a shift somebody else was since put on", async () => {
    const started = await startCoverage(openShiftId);
    await handleVapiResult({
      workerId: started.currentWorkerId!,
      attemptId: started.activeAttemptId!,
      decision: "accepted",
    });

    // A manager reassigns it by hand afterwards.
    await updateShift(openShiftId, { assignedEmployeeId: "emp_john" });
    await releaseRescuedShift(await getWorkflowState());

    expect((await getShift(openShiftId))?.assignedEmployeeId).toBe("emp_john");
  });

  it("should not claim to be calling people it has no number for", async () => {
    // Staff with no number stay on the roster on purpose — the call layer is
    // where that gets reported. What must not happen is the run sitting on
    // CALLING_WORKER forever, or a call id appearing for a call never placed.
    delete process.env.DEMO_WORKER_1_PHONE;
    delete process.env.DEMO_WORKER_2_PHONE;
    delete process.env.DEMO_WORKER_3_PHONE;
    process.env.SIMULATE = "false";
    await resetEmployees();
    await resetWorkflowState();

    const state = await startCoverage(openShiftId);

    expect(state.status).toBe("INCOMPLETE");
    expect(state.proof.callId).toBeUndefined();
    expect(state.timeline.filter((t) => t.message.includes("Could not reach"))).toHaveLength(3);
    expect(state.timeline.at(-1)?.message).toContain("All workers declined");
  });
});
