export type WorkerDecision =
  | "accepted"
  | "declined"
  | "needs_clarification";

export type WorkflowStatus =
  | "WAITING_FOR_MANAGER_COMMAND"
  | "SHIFT_CREATED"
  | "CALLING_WORKER"
  | "WORKER_DECLINED"
  | "WORKER_ACCEPTED"
  | "TRIGGERING_VOICEOS"
  | "VOICEOS_COMPLETE"
  | "SENDING_SMS"
  | "COMPLETE"
  | "INCOMPLETE";

export interface Employee {
  id: string;
  name: string;
  /** E.164. Never leaves the server — see publicWorkflowState(). */
  phone: string;
  language: string;
  role: string;
  active: boolean;
}

/** Kept as an alias: the workflow calls an employee a "worker" while on the phone. */
export type Worker = Employee;

export interface Shift {
  id: string;
  role: string;
  /** Absolute instants, plus the zone the shift was scheduled in. */
  startsAt?: string;
  endsAt?: string;
  timeZone?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  location: string;
  pay: string;
  assignedWorkerId: string | null;
}

/** One utterance from the live call, as Vapi streams it back. */
export interface TranscriptLine {
  id: string;
  /** Who spoke: the agent or the worker on the other end. */
  speaker: "agent" | "worker";
  text: string;
  timestamp: string;
}

export interface TimelineEvent {
  id: string;
  message: string;
  timestamp: string;
}

export interface WorkflowProof {
  callId?: string;
  scheduleUpdated?: boolean;
  calendarEventId?: string;
  slackMessageId?: string;
  gmailMessageId?: string;
  spreadsheetId?: string;
  spreadsheetUpdateRange?: string;
  smsMessageId?: string;
  /**
   * Recorded outcome rather than proof: true when VoiceOS reported that it could
   * not complete its side effects, so the rail can show that step as failed
   * instead of merely un-run.
   */
  voiceosFailed?: boolean;
}

export interface WorkflowState {
  status: WorkflowStatus;
  shift: Shift | null;
  workers: Worker[];
  currentWorkerIndex: number;
  currentWorkerId: string | null;
  /** Only a decision from this server-generated call attempt may mutate the run. */
  activeAttemptId: string | null;
  timeline: TimelineEvent[];
  /** Cleared whenever a new worker is dialled — it belongs to the current call. */
  transcript: TranscriptLine[];
  proof: WorkflowProof;
}
