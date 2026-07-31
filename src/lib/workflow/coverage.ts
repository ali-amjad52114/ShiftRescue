import { getShift, updateShift, type ScheduledShift } from "../shifts/store";
import { beginCalling } from "./actions";
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
export async function startCoverage(shiftId: string): Promise<WorkflowState> {
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
    activeAttemptId: null,
    timeline: [
      {
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        message: `Looking for cover for the ${shift.role} shift`,
        timestamp: new Date().toISOString(),
      },
    ],
    proof: {},
  };

  // Dialling goes through the workflow engine rather than being reimplemented
  // here. This screen used to write "Calling Maria" into the timeline and place
  // no call at all, which looked identical to a working rescue.
  await beginCalling(next);

  return updateWorkflowState(next);
}
