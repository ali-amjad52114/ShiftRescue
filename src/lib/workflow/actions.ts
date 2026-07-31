import { sendShiftConfirmationSms } from "../../integrations/a1mobile/client";
import { startVapiShiftCall } from "../../integrations/vapi";
import {
  DEFAULT_TIME_ZONE,
  formatSpokenDate,
  formatSpokenTime,
  resolveShiftWindow,
} from "../time/schedule";
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
    addTimelineEntry(state, "All workers declined. Shift rescue incomplete.");
    return false;
  }

  const nextWorker = state.workers[nextIndex];
  state.currentWorkerIndex = nextIndex;
  state.currentWorkerId = nextWorker.id;
  state.status = "CALLING_WORKER";
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

    const result = await startVapiShiftCall({
      workerId: worker.id,
      workerName: worker.name,
      phone: worker.phone,
      language: worker.language,
      shift: state.shift,
    });

    if (result.success) {
      state.proof = { ...state.proof, callId: result.callId };
      return;
    }

    addTimelineEntry(state, `Could not reach ${worker.name}: ${result.error}`);
    if (!advanceToNextWorker(state)) return;
  }
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

  const shift: Shift = {
    id: `shift_${Date.now()}`,
    role: payload.role,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    timeZone: window.timeZone,
    // The instants are the truth. These are the same window pre-rendered in the
    // venue's zone for the dashboard card and the confirmation SMS, which both
    // want a spoken string rather than an ISO timestamp. Derived here because
    // this is the only place a Shift is created, so they cannot drift apart.
    date: formatSpokenDate(window.startsAt, window.timeZone),
    startTime: formatSpokenTime(window.startsAt, window.timeZone),
    endTime: formatSpokenTime(window.endsAt, window.timeZone),
    location: payload.location,
    pay: payload.pay || "$24 per hour",
    assignedWorkerId: null,
  };

  state.shift = shift;
  state.status = "SHIFT_CREATED";
  state.timeline = [];
  state.proof = {};

  addTimelineEntry(state, `Manager command received: Uncovered ${shift.role} shift created`);

  // Automatically start with Worker 1
  if (state.workers.length > 0) {
    state.currentWorkerIndex = 0;
    const worker1 = state.workers[0];
    state.currentWorkerId = worker1.id;
    state.status = "CALLING_WORKER";
    addTimelineEntry(state, `Calling ${worker1.name} in ${worker1.language}`);
    await dialCurrentWorker(state);
  }

  return updateWorkflowState(state);
}

export async function handleVapiResult(payload: {
  workerId: string;
  decision: WorkerDecision;
}) {
  const state = await getWorkflowState();

  // If already complete or worker accepted, ignore late calls
  if (state.status === "COMPLETE" || state.status === "WORKER_ACCEPTED" || state.status === "TRIGGERING_VOICEOS" || state.status === "VOICEOS_COMPLETE") {
    return state;
  }

  const workerIndex = state.workers.findIndex((w) => w.id === payload.workerId);
  const worker = workerIndex >= 0 ? state.workers[workerIndex] : state.workers[state.currentWorkerIndex];
  const workerName = worker ? worker.name : payload.workerId;

  // A duplicate or retried webhook from an earlier worker would otherwise
  // advance the queue a second time and skip a worker who was never called.
  if (payload.decision === "declined" && workerIndex >= 0 && workerIndex !== state.currentWorkerIndex) {
    return state;
  }

  if (payload.decision === "declined") {
    state.status = "WORKER_DECLINED";
    addTimelineEntry(state, `${workerName} declined shift`);

    if (advanceToNextWorker(state)) {
      await dialCurrentWorker(state);
    }
  } else if (payload.decision === "accepted") {
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

    // Trigger VoiceOS action step
    state.status = "TRIGGERING_VOICEOS";
    addTimelineEntry(state, `Triggering VoiceOS to update Schedule, Calendar, Slack, Gmail, and Google Sheets`);
  } else if (payload.decision === "needs_clarification") {
    addTimelineEntry(state, `Call with ${workerName} required clarification`);
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
  smsMessageId?: string;
}) {
  const state = await getWorkflowState();

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
    };
    state.status = "VOICEOS_COMPLETE";
    addTimelineEntry(state, "VoiceOS updated the schedule app, Google Calendar, Slack, Gmail, and Google Sheets");

    const smsMessageId = payload.smsMessageId?.trim();
    if (smsMessageId) {
      state.proof.smsMessageId = smsMessageId;
      state.status = "COMPLETE";
      addTimelineEntry(state, "Confirmation SMS sent via a1mobile. Rescue complete!");
    } else {
      // VoiceOS did not send the text, so the backend does it now. This is the
      // last step of the rescue and was the one thing nothing had ever run.
      state.status = "SENDING_SMS";
      addTimelineEntry(state, "Requesting a1mobile to send the confirmation SMS");
      await sendConfirmationSms(state);
    }
  } else {
    state.status = "INCOMPLETE";
    addTimelineEntry(state, "VoiceOS failed to update backend systems");
  }

  return updateWorkflowState(state);
}
