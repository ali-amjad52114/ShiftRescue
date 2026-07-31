import { getShift, assignShift, type ScheduledShift } from "../shifts/store";
import { spokenShiftWindow } from "../time/schedule";
import { dialActiveWorker, type DecisionOptions } from "./actions";
import { getWorkflowState, updateWorkflowState } from "./state";
import type { Shift, WorkflowState } from "./types";

/** Statuses where a rescue is under way and a second one must not start. */
const ACTIVE_STATUSES = new Set([
  "SHIFT_CREATED",
  "CALLING_WORKER",
  "WORKER_DECLINED",
  "WORKER_ACCEPTED",
  "TRIGGERING_VOICEOS",
  "VOICEOS_COMPLETE",
  "SENDING_SMS",
]);

export function isRescueActive(state: WorkflowState): boolean {
  return ACTIVE_STATUSES.has(state.status);
}

function toWorkflowShift(shift: ScheduledShift): Shift {
  return {
    id: shift.id,
    role: shift.role,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    timeZone: shift.timeZone,
    // A scheduled shift stores only instants. The spoken forms are what the
    // assistant reads out and what the confirmation text repeats, so they are
    // rendered here rather than left for the dial to discover missing.
    ...spokenShiftWindow(shift),
    location: shift.location,
    pay: shift.pay,
    assignedWorkerId: shift.assignedEmployeeId,
  };
}

/**
 * Begin working the roster for an existing scheduled shift.
 *
 * The engine holds one run at a time, so a second request while a rescue is in
 * flight is refused rather than silently replacing the run in progress.
 */
export async function startCoverage(
  shiftId: string,
  options: DecisionOptions = {},
): Promise<WorkflowState> {
  const shift = await getShift(shiftId);
  if (!shift) throw new Error(`No shift with id ${shiftId}`);
  if (shift.assignedEmployeeId) throw new Error("That shift is already covered");

  const state = await getWorkflowState();
  if (isRescueActive(state) && state.shift?.id !== shiftId) {
    throw new Error("A rescue is already running for another shift");
  }

  const next: WorkflowState = {
    ...state,
    shift: toWorkflowShift(shift),
    status: "SHIFT_CREATED",
    currentWorkerIndex: -1,
    currentWorkerId: null,
    timeline: [],
    transcript: [],
    proof: {},
  };

  if (next.workers.length === 0) {
    next.timeline = [event("No active staff on the roster to call")];
    next.status = "INCOMPLETE";
    return updateWorkflowState(next);
  }

  const first = next.workers[0];
  next.currentWorkerIndex = 0;
  next.currentWorkerId = first.id;
  next.status = "CALLING_WORKER";
  next.activeAttemptId = null;
  next.timeline = [
    event(`Looking for cover for the ${shift.role} shift`),
    event(`Calling ${first.name} in ${first.language}`),
  ];

  // Actually ring them. dialActiveWorker persists the run before dialling and
  // refuses to dial twice, and the route passes after(), so the button returns
  // as soon as the run is recorded rather than waiting on the Vapi round trip.
  return dialActiveWorker(next, options);
}

function event(message: string) {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    message,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Mirror an accepted rescue onto the schedule so the calendar shows the shift
 * as covered. Only ever writes an assignment the workflow actually recorded.
 */
export async function syncScheduleAssignment(state: WorkflowState): Promise<void> {
  const shiftId = state.shift?.id;
  const workerId = state.shift?.assignedWorkerId;
  if (!shiftId || !workerId) return;
  await assignShift(shiftId, workerId);
}
