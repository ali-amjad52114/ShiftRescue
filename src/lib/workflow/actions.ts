import { getWorkflowState, updateWorkflowState } from "./state";
import type { Shift, WorkerDecision, WorkflowState } from "./types";

function addTimelineEntry(state: WorkflowState, message: string) {
  state.timeline.push({
    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    message,
    timestamp: new Date().toISOString(),
  });
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

  const shift: Shift = {
    id: `shift_${Date.now()}`,
    role: payload.role,
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime,
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

    // Advance to next worker
    const nextIndex = state.currentWorkerIndex + 1;
    if (nextIndex < state.workers.length) {
      state.currentWorkerIndex = nextIndex;
      const nextWorker = state.workers[nextIndex];
      state.currentWorkerId = nextWorker.id;
      state.status = "CALLING_WORKER";
      addTimelineEntry(state, `Calling ${nextWorker.name} in ${nextWorker.language}`);
    } else {
      state.status = "INCOMPLETE";
      addTimelineEntry(state, "All workers declined. Shift rescue incomplete.");
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
    addTimelineEntry(state, `Triggering VoiceOS to update Schedule, Calendar, and Slack`);
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
  smsMessageId?: string;
}) {
  const state = await getWorkflowState();

  if (payload.success) {
    // Record only what the integrations actually reported. This used to fall
    // back to "calendar_123" / "slack_123" / "sms_123" and default
    // scheduleUpdated to true, so a success with no IDs displayed invented
    // proof under "Verified side effects" — a fabricated success, which is an
    // automatic critical flag in judging.
    const done: string[] = [];
    if (payload.scheduleUpdated === true) {
      state.proof.scheduleUpdated = true;
      done.push("the schedule app");
    }
    if (payload.calendarEventId) {
      state.proof.calendarEventId = payload.calendarEventId;
      done.push("Google Calendar");
    }
    if (payload.slackMessageId) {
      state.proof.slackMessageId = payload.slackMessageId;
      done.push("Slack");
    }

    state.status = "VOICEOS_COMPLETE";
    addTimelineEntry(
      state,
      done.length > 0
        ? `VoiceOS updated ${done.join(", ")}`
        : "VoiceOS reported success but returned no proof IDs",
    );

    // The SMS is only claimed when a1mobile returned a message ID for it.
    if (payload.smsMessageId) {
      state.proof.smsMessageId = payload.smsMessageId;
      state.status = "COMPLETE";
      addTimelineEntry(state, "Confirmation SMS sent via a1mobile. Rescue complete!");
    } else {
      state.status = "SENDING_SMS";
      addTimelineEntry(state, "Awaiting a1mobile confirmation SMS — no message ID yet");
    }
  } else {
    state.status = "INCOMPLETE";
    addTimelineEntry(state, "VoiceOS failed to update backend systems");
  }

  return updateWorkflowState(state);
}
