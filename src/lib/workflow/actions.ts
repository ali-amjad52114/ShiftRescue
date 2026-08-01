import {
  sendShiftConfirmationSms,
  startA1MobileCall,
} from "../../integrations/a1mobile/client";
import { classifyEndedReason, waitForCallOutcome } from "../../integrations/a1mobile/status";
import {
  DEFAULT_TIME_ZONE,
  formatSpokenDate,
  formatSpokenTime,
  resolveShiftWindow,
} from "../time/schedule";
import { assignShift, createShift, listShifts, type ScheduledShift } from "../shifts/store";
import { callableEmployees } from "../employees/store";
import { getWorkflowState, updateWorkflowState } from "./state";
import type { Shift, WorkerDecision, WorkflowState } from "./types";

function addTimelineEntry(state: WorkflowState, message: string) {
  state.timeline.push({
    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    message,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Points the queue at the next worker. Returns false when the roster is spent,
 * leaving the run INCOMPLETE.
 */
function advanceToNextWorker(state: WorkflowState): boolean {
  const nextIndex = state.currentWorkerIndex + 1;

  if (nextIndex >= state.workers.length) {
    state.status = "INCOMPLETE";
    state.currentWorkerId = null;
    state.activeAttemptId = null;
    addTimelineEntry(state, "All workers declined. Shift rescue incomplete.");
    return false;
  }

  const nextWorker = state.workers[nextIndex];
  state.currentWorkerIndex = nextIndex;
  state.currentWorkerId = nextWorker.id;
  state.activeAttemptId = null;
  state.status = "CALLING_WORKER";
  state.transcript = []; // a new call is a new conversation
  addTimelineEntry(state, `Calling ${nextWorker.name} in ${nextWorker.language}`);
  return true;
}

/**
 * Dials whoever the queue points at, moving on if the call cannot be placed at
 * all. A dead number must not strand the rescue on a worker who never rings.
 * Vapi answers as soon as the call is queued, so this returns while the
 * conversation is still live; the decision arrives later via the webhook.
 */
async function dialCurrentWorker(state: WorkflowState): Promise<void> {
  while (state.shift && state.status === "CALLING_WORKER") {
    const worker = state.workers[state.currentWorkerIndex];
    if (!worker) return;

    const { role, location, pay, date, startTime, endTime, startsAt, endsAt, timeZone } = state.shift;
    const zone = timeZone || DEFAULT_TIME_ZONE;
    const result = await startA1MobileCall({
      workerId: worker.id,
      workerName: worker.name,
      phone: worker.phone,
      language: worker.language,
      shiftId: state.shift.id,
      shift: {
        role,
        location,
        pay,
        // Shifts are stored as instants now, so the spoken forms are rendered
        // from them. Passing the legacy fields raw sent empty strings and the
        // assistant read the placeholders aloud: "the date is", "start time is".
        date: date || (startsAt ? formatSpokenDate(startsAt, zone) : ""),
        startTime: startTime || (startsAt ? formatSpokenTime(startsAt, zone) : ""),
        endTime: endTime || (endsAt ? formatSpokenTime(endsAt, zone) : ""),
      },
    });

    if (result.success && result.callId && result.attemptId) {
      state.proof = { ...state.proof, callId: result.callId };
      state.activeAttemptId = result.attemptId;
      // Persist before starting the monitor: a call can fail immediately, and
      // the monitor must not read the pre-call state and exit permanently.
      await updateWorkflowState(state);
      monitorCallAttempt(result.callId, result.attemptId, worker.id);
      return;
    }

    addTimelineEntry(
      state,
      `Could not reach ${worker.name}: ${result.error || "call provider returned no proof"}`,
    );
    if (!advanceToNextWorker(state)) return;
  }
}

/**
 * Point the queue at the first worker and dial.
 *
 * Shared by both entry points — the schedule's "Find coverage" button and a
 * spoken VoiceOS command — so a rescue started either way places the same real
 * call. Keeping this in one place is the whole point: the schedule path used to
 * announce "Calling Maria" in the timeline and never ring anyone.
 */
export async function beginCalling(state: WorkflowState): Promise<void> {
  if (state.workers.length === 0) {
    state.status = "INCOMPLETE";
    state.currentWorkerIndex = -1;
    state.currentWorkerId = null;
    state.activeAttemptId = null;
    addTimelineEntry(state, "No eligible active staff on the roster to call.");
    return;
  }

  const first = state.workers[0];
  state.currentWorkerIndex = 0;
  state.currentWorkerId = first.id;
  state.activeAttemptId = null;
  state.status = "CALLING_WORKER";
  addTimelineEntry(state, `Calling ${first.name} in ${first.language}`);
  await dialCurrentWorker(state);
}

/**
 * Mirror an acceptance onto the schedule. This store is our own system of
 * record, so the calendar fills the moment someone says yes rather than waiting
 * on VoiceOS — which may not be running at all. Only ever writes an assignment
 * the workflow actually recorded.
 */
async function assignOnSchedule(state: WorkflowState): Promise<void> {
  const shiftId = state.shift?.id;
  const workerId = state.shift?.assignedWorkerId;
  if (!shiftId || !workerId) return;
  await assignShift(shiftId, workerId);
}

/**
 * A call can end without invoking a decision tool. Monitor the real Vapi call
 * in the long-lived local demo process and advance only if this exact attempt
 * is still active after the call has ended.
 */
function monitorCallAttempt(callId: string, attemptId: string, workerId: string): void {
  if (callId.startsWith("sim-") || callId.startsWith("mock-")) return;

  void (async () => {
    const outcome = await waitForCallOutcome(callId);
    if (outcome.outcome === "in-progress") return;

    // Give a tool webhook that fired at hangup a short chance to win the race.
    if (outcome.outcome === "answered") {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    const current = await getWorkflowState();
    if (
      current.status !== "CALLING_WORKER" ||
      current.currentWorkerId !== workerId ||
      current.activeAttemptId !== attemptId
    ) {
      return;
    }

    const worker = current.workers[current.currentWorkerIndex];
    const name = worker?.name ?? workerId;
    if (outcome.outcome === "no-answer") {
      addTimelineEntry(current, `${name} did not answer; trying the next worker`);
    } else if (outcome.outcome === "answered") {
      addTimelineEntry(current, `Call with ${name} ended without a clear decision; trying the next worker`);
    } else {
      addTimelineEntry(
        current,
        `Call with ${name} could not complete${outcome.endedReason ? ` (${outcome.endedReason})` : ""}; trying the next worker`,
      );
    }

    current.activeAttemptId = null;
    if (advanceToNextWorker(current)) {
      await dialCurrentWorker(current);
    }
    await updateWorkflowState(current);
  })();
}

/**
 * Texts the worker who took the shift. The message id that comes back is the
 * proof the dashboard shows, so a failed send leaves the run in SENDING_SMS
 * rather than inventing one — the same rule the VoiceOS proof follows.
 */
async function sendConfirmationSms(state: WorkflowState): Promise<void> {
  const worker =
    state.workers.find((w) => w.id === state.shift?.assignedWorkerId) ??
    state.workers[state.currentWorkerIndex];

  if (!worker || !state.shift) return;

  const { role, location, pay, date, startTime, endTime, startsAt, endsAt, timeZone } = state.shift;
  const zone = timeZone || DEFAULT_TIME_ZONE;

  const result = await sendShiftConfirmationSms({
    phone: worker.phone,
    language: worker.language,
    workerName: worker.name,
    shift: {
      role,
      location,
      pay,
      date: date || (startsAt ? formatSpokenDate(startsAt, zone) : ""),
      startTime: startTime || (startsAt ? formatSpokenTime(startsAt, zone) : ""),
      endTime: endTime || (endsAt ? formatSpokenTime(endsAt, zone) : ""),
    },
  });

  if (!result.success || !result.messageId) {
    addTimelineEntry(state, `Confirmation SMS to ${worker.name} failed: ${result.error}`);
    return;
  }

  state.proof.smsMessageId = result.messageId;
  state.status = "COMPLETE";
  addTimelineEntry(state, "Confirmation SMS sent via a1mobile. Rescue complete!");
}

const REQUIRED_COMMAND_FIELDS = ["role", "date", "startTime", "endTime", "location"] as const;

/**
 * VoiceOS describes a shift in words, so the run has to be attached to a real
 * row in the schedule — otherwise the calendar shows no gap being worked and
 * the acceptance has nothing to fill in.
 *
 * An existing slot is reused only when the role and the window match exactly.
 * Snapping "6 PM to 10 PM" onto a nearby 6-11 rota slot would make the assistant
 * say one thing while the schedule meant another, so anything else is booked as
 * a new shift at the time the manager actually asked for.
 */
async function resolveScheduledShift(input: {
  role: string;
  startsAt: string;
  endsAt: string;
  location: string;
  pay: string;
}): Promise<ScheduledShift> {
  const existing = (await listShifts()).find(
    (candidate) =>
      !candidate.assignedEmployeeId &&
      candidate.role.toLowerCase() === input.role.toLowerCase() &&
      candidate.startsAt === input.startsAt &&
      candidate.endsAt === input.endsAt,
  );

  return existing ?? createShift(input);
}

export async function handleVoiceosCommand(payload: {
  role: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  pay?: string;
}) {
  // These endpoints are public webhooks. A malformed command used to produce a
  // shift with "undefined" fields that the dashboard rendered as real detail.
  const missing = REQUIRED_COMMAND_FIELDS.filter(
    (field) => typeof payload?.[field] !== "string" || payload[field].trim() === "",
  );
  if (missing.length > 0) {
    throw new Error(`Missing required shift fields: ${missing.join(", ")}`);
  }

  const state = await getWorkflowState();

  // VoiceOS hands over whatever the manager said ("Friday", "6 PM"), so the
  // spoken window is resolved to absolute instants before anything stores it.
  const window = resolveShiftWindow({
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime,
  });

  // The run is pinned to a real row in the schedule so the calendar shows the
  // gap being worked, and so an acceptance has something to fill in.
  const scheduled = await resolveScheduledShift({
    role: payload.role,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    location: payload.location,
    pay: payload.pay || "$24 per hour",
  });

  const shift: Shift = {
    id: scheduled.id,
    role: scheduled.role,
    startsAt: scheduled.startsAt,
    endsAt: scheduled.endsAt,
    timeZone: scheduled.timeZone,
    // The instants are the truth. These are the same window pre-rendered in the
    // venue's zone for the dashboard card and the confirmation SMS, which both
    // want a spoken string rather than an ISO timestamp. Derived here because
    // this is the only place a Shift is created, so they cannot drift apart.
    date: formatSpokenDate(scheduled.startsAt, scheduled.timeZone),
    startTime: formatSpokenTime(scheduled.startsAt, scheduled.timeZone),
    endTime: formatSpokenTime(scheduled.endsAt, scheduled.timeZone),
    location: scheduled.location,
    pay: scheduled.pay || payload.pay || "$24 per hour",
    assignedWorkerId: null,
  };

  state.shift = shift;
  // A new manager command is ordinary coverage, even if the previous run was
  // a replacement. Rebuild from the source roster so an old exclusion cannot
  // leak into this run through hydrated workflow state.
  state.workers = await callableEmployees();
  state.excludedWorkerIds = [];
  state.status = "SHIFT_CREATED";
  state.timeline = [];
  state.proof = {};
  state.activeAttemptId = null;

  addTimelineEntry(state, `Manager command received: Uncovered ${shift.role} shift created`);

  await beginCalling(state);

  return updateWorkflowState(state);
}

export async function handleVapiResult(payload: {
  workerId: string;
  attemptId: string;
  decision: WorkerDecision;
}) {
  const state = await getWorkflowState();

  // Once somebody has taken the shift, a later decision from another attempt is
  // just a call finishing behind us. Keyed on the assignment rather than a list
  // of statuses so it cannot be missed when the status flow changes.
  if (state.shift?.assignedWorkerId || state.status === "COMPLETE") {
    return state;
  }

  const workerIndex = state.workers.findIndex((w) => w.id === payload.workerId);
  const worker = workerIndex >= 0 ? state.workers[workerIndex] : undefined;
  const workerName = worker ? worker.name : payload.workerId;

  // Both values are server-trusted Vapi tool parameters. Reject missing,
  // spoofed, duplicate, and late callbacks before they can mutate the queue.
  if (
    state.status !== "CALLING_WORKER" ||
    payload.workerId !== state.currentWorkerId ||
    payload.attemptId !== state.activeAttemptId
  ) {
    throw new Error("Decision does not match the active call attempt");
  }

  if (payload.decision === "declined") {
    state.activeAttemptId = null;
    state.status = "WORKER_DECLINED";
    addTimelineEntry(state, `${workerName} declined shift`);

    if (advanceToNextWorker(state)) {
      await dialCurrentWorker(state);
    }
  } else if (payload.decision === "accepted") {
    state.activeAttemptId = null;
    state.status = "WORKER_ACCEPTED";
    if (state.shift) {
      state.shift.assignedWorkerId = payload.workerId;
    }
    // Credit the worker who actually accepted. Without this the dashboard kept
    // showing whoever was mid-call and named the wrong person as covering.
    if (workerIndex >= 0) {
      state.currentWorkerIndex = workerIndex;
      state.currentWorkerId = payload.workerId;
    }
    addTimelineEntry(state, `${workerName} accepted shift!`);

    // The schedule is our own system of record, so it fills straight away. The
    // VoiceOS mirrors — Calendar, Slack, Gmail, Sheets — report separately and
    // add their own proof; the shift is covered whether or not they ever do.
    await assignOnSchedule(state);
    addTimelineEntry(state, `Schedule updated: ${workerName} now covers the ${state.shift?.role ?? "shift"} shift`);

    // Texting the worker is the last step of the loop we control end to end, so
    // it is not gated behind an external system that may not be listening.
    state.status = "SENDING_SMS";
    addTimelineEntry(state, "Requesting a1mobile to send the confirmation SMS");
    await sendConfirmationSms(state);
  } else if (payload.decision === "needs_clarification") {
    state.activeAttemptId = null;
    addTimelineEntry(state, `${workerName} could not confirm availability; trying the next worker`);
    if (advanceToNextWorker(state)) {
      await dialCurrentWorker(state);
    }
  }

  return updateWorkflowState(state);
}

/**
 * Vapi's end-of-call report, which arrives even when no decision tool was ever
 * called. This is the same recovery monitorCallAttempt() performs by polling,
 * and the two are deliberately kept side by side: the poller needs a
 * long-lived process, while this works on serverless, where a background
 * promise is killed as soon as the response is sent. Whichever arrives first
 * advances the queue, and the attempt guards below stop the other repeating it.
 */
export async function handleVapiCallEnded(event: {
  callId?: string;
  endedReason?: string;
}) {
  const state = await getWorkflowState();

  // A decision already moved the run on, so this report is just the call
  // hanging up afterwards.
  if (state.status !== "CALLING_WORKER") return state;

  // A late report from an earlier attempt must not skip the worker now ringing.
  if (event.callId && state.proof.callId && event.callId !== state.proof.callId) {
    return state;
  }

  const worker = state.workers[state.currentWorkerIndex];
  const workerName = worker ? worker.name : "the worker";
  const outcome = classifyEndedReason(event.endedReason, "ended");

  addTimelineEntry(
    state,
    outcome === "no-answer"
      ? `${workerName} did not answer; trying the next worker`
      : `Call with ${workerName} ended without a clear decision; trying the next worker`,
  );

  state.activeAttemptId = null;
  if (advanceToNextWorker(state)) {
    await dialCurrentWorker(state);
  }

  return updateWorkflowState(state);
}

export async function handleVoiceosResult(payload: {
  success: boolean;
  scheduleUpdated?: boolean;
  calendarEventId?: string;
  slackMessageId?: string;
  gmailMessageId?: string;
  spreadsheetId?: string;
  spreadsheetUpdateRange?: string;
}) {
  const state = await getWorkflowState();

  // VoiceOS mirrors an acceptance that already happened. Without this, proof
  // could be posted at any time onto an empty run and the dashboard would show
  // Calendar and Slack ids for a shift nobody ever took.
  if (!state.shift?.assignedWorkerId) {
    throw new Error("No accepted shift to report VoiceOS results for");
  }

  if (payload.success) {
    // A successful result must include proof from every VoiceOS side effect.
    // Never fall back to invented IDs or silently accept partial completion.
    if (!payload.scheduleUpdated) {
      throw new Error("scheduleUpdated must be true for a successful VoiceOS result");
    }

    const calendarEventId = payload.calendarEventId?.trim();
    const slackMessageId = payload.slackMessageId?.trim();
    const gmailMessageId = payload.gmailMessageId?.trim();
    const spreadsheetId = payload.spreadsheetId?.trim();
    const spreadsheetUpdateRange = payload.spreadsheetUpdateRange?.trim();
    if (!calendarEventId || !slackMessageId || !gmailMessageId || !spreadsheetId || !spreadsheetUpdateRange) {
      throw new Error(
        "Real calendarEventId, slackMessageId, gmailMessageId, spreadsheetId, and spreadsheetUpdateRange values are required for a successful VoiceOS result",
      );
    }

    state.proof = {
      ...state.proof,
      scheduleUpdated: true,
      calendarEventId,
      slackMessageId,
      gmailMessageId,
      spreadsheetId,
      spreadsheetUpdateRange,
      voiceosFailed: false,
    };
    addTimelineEntry(state, "VoiceOS updated the schedule app, Google Calendar, Slack, Gmail, and Google Sheets");
  } else {
    // An acceptance that really happened is not undone by a mirror failing.
    // Record it so the rail can mark the VoiceOS step failed, and only call the
    // whole run incomplete when nobody had taken the shift in the first place.
    state.proof = { ...state.proof, voiceosFailed: true };
    addTimelineEntry(state, "VoiceOS failed to update backend systems");
    if (!state.shift?.assignedWorkerId) {
      state.status = "INCOMPLETE";
    }
  }

  return updateWorkflowState(state);
}
