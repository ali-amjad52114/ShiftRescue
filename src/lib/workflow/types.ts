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

export interface Worker {
  id: string;
  name: string;
  phone: string;
  language: string;
}

export interface Shift {
  id: string;
  role: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  pay: string;
  assignedWorkerId: string | null;
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
  smsMessageId?: string;
}

export interface WorkflowState {
  status: WorkflowStatus;
  shift: Shift | null;
  workers: Worker[];
  currentWorkerIndex: number;
  currentWorkerId: string | null;
  timeline: TimelineEvent[];
  proof: WorkflowProof;
}
