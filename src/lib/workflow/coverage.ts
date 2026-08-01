import { getShift, updateShift, type ScheduledShift } from "../shifts/store";
import { callableEmployees } from "../employees/store";
import { spokenShiftWindow } from "../time/schedule";
import { beginCalling, type DecisionOptions } from "./actions";
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

/**
 * Hand the shift back when a rescue is cleared, so the gap the demo exists to
 * close is there again. Without this, resetting leaves the shift covered and
 * there is nothing left to rescue on the next run.
 *
 * Only ever undoes an assignment this run made: a shift somebody else has since
 * been put on is left alone.
 */
export async function releaseRescuedShift(state: WorkflowState): Promise<void> {
  const shiftId = state.shift?.id;
  const workerId = state.shift?.assignedWorkerId;
  if (!shiftId || !workerId) return;

  const scheduled = await getShift(shiftId);
  if (scheduled?.assignedEmployeeId !== workerId) return;

  await updateShift(shiftId, { assignedEmployeeId: null });
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
export interface StartCoverageOptions extends DecisionOptions {
  /** Replace whoever is already on the shift, rather than filling an empty one. */
  replacement?: boolean;
}

export async function startCoverage(
  shiftId: string,
  options: StartCoverageOptions = {},
): Promise<WorkflowState> {
  const shift = await getShift(shiftId);
  if (!shift) throw new Error(`No shift with id ${shiftId}`);

  const replacedWorkerId = options.replacement ? shift.assignedEmployeeId : null;
  if (options.replacement && !replacedWorkerId) {
    throw new Error("That shift has nobody assigned to replace");
  }
  if (!options.replacement && shift.assignedEmployeeId) {
    throw new Error("That shift is already covered");
  }

  const state = await getWorkflowState();
  if (isRescueActive(state) && state.shift?.id !== shiftId) {
    throw new Error("A rescue is already running for another shift");
  }

  const excludedWorkerIds = replacedWorkerId ? [replacedWorkerId] : [];
  const excluded = new Set(excludedWorkerIds);
  const workers = (await callableEmployees()).filter((worker) => !excluded.has(worker.id));

  // Capture the assignee before opening the shift. Keeping this inside the
  // coverage operation prevents the browser from erasing the only record of
  // who must be excluded before the call queue is built.
  if (replacedWorkerId) {
    await updateShift(shiftId, { assignedEmployeeId: null });
  }

  const workflowShift = toWorkflowShift({
    ...shift,
    assignedEmployeeId: null,
  });

  const next: WorkflowState = {
    ...state,
    shift: workflowShift,
    workers,
    excludedWorkerIds,
    status: "SHIFT_CREATED",
    currentWorkerIndex: -1,
    currentWorkerId: null,
    activeAttemptId: null,
    timeline: [
      {
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        message: replacedWorkerId
          ? `Looking for a replacement for the ${shift.role} shift`
          : `Looking for cover for the ${shift.role} shift`,
        timestamp: new Date().toISOString(),
      },
    ],
    proof: {},
  };

  // Ring them through the one dial path, which appends to the timeline opened
  // above rather than replacing it — so a replacement run still says it is
  // looking for a replacement. beginCalling persists the run before dialling
  // and refuses to dial twice, and the route passes after(), so the button
  // returns as soon as the run is recorded rather than waiting on the Vapi
  // round trip.
  return beginCalling(next, options);
}

// Mirroring an acceptance onto the schedule lives in actions.ts, next to the
// decision that causes it — see assignOnSchedule(). Having a second copy here
// meant the webhook route wrote the assignment twice.
