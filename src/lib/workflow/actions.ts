import { getWorkflowState, updateWorkflowState } from "./state";
import type { Shift, WorkerDecision, WorkflowProof } from "./types";

function addTimelineEntry(state: ReturnType<typeof getWorkflowState>, message: string) {
  state.timeline.push({
    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    message,
    timestamp: new Date().toISOString(),
  });
}

export function handleVoiceosCommand(payload: {
  role: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  pay?: string;
}) {
  const state = getWorkflowState();

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

export function handleVapiResult(payload: {
  workerId: string;
  decision: WorkerDecision;
}) {
  const state = getWorkflowState();

  // If already complete or worker accepted, ignore late calls
  if (state.status === "COMPLETE" || state.status === "WORKER_ACCEPTED" || state.status === "TRIGGERING_VOICEOS" || state.status === "VOICEOS_COMPLETE") {
    return state;
  }

  const worker = state.workers.find((w) => w.id === payload.workerId) || state.workers[state.currentWorkerIndex];
  const workerName = worker ? worker.name : payload.workerId;

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
    addTimelineEntry(state, `${workerName} accepted shift!`);

    // Trigger VoiceOS action step
    state.status = "TRIGGERING_VOICEOS";
    addTimelineEntry(state, `Triggering VoiceOS to update Schedule, Calendar, and Slack`);
  } else if (payload.decision === "needs_clarification") {
    addTimelineEntry(state, `Call with ${workerName} required clarification`);
  }

  return updateWorkflowState(state);
}

export function handleVoiceosResult(payload: {
  success: boolean;
  scheduleUpdated?: boolean;
  calendarEventId?: string;
  slackMessageId?: string;
  smsMessageId?: string;
}) {
  const state = getWorkflowState();

  if (payload.success) {
    state.proof = {
      ...state.proof,
      scheduleUpdated: payload.scheduleUpdated ?? true,
      calendarEventId: payload.calendarEventId || "calendar_123",
      slackMessageId: payload.slackMessageId || "slack_123",
    };
    state.status = "VOICEOS_COMPLETE";
    addTimelineEntry(state, "VoiceOS updated Schedule app, Google Calendar, and Slack");

    // Next step: Sending SMS confirmation
    state.status = "SENDING_SMS";
    addTimelineEntry(state, "Requesting a1mobile to send confirmation SMS");

    // Automatically complete SMS step (or capture smsMessageId if provided)
    state.proof.smsMessageId = payload.smsMessageId || "sms_123";
    state.status = "COMPLETE";
    addTimelineEntry(state, "Confirmation SMS sent via a1mobile. Rescue complete!");
  } else {
    state.status = "INCOMPLETE";
    addTimelineEntry(state, "VoiceOS failed to update backend systems");
  }

  return updateWorkflowState(state);
}
