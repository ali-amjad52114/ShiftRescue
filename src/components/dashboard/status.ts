export const WORKFLOW_STEPS = [
  "Manager command",
  "Worker calls",
  "Acceptance",
  "VoiceOS actions",
  "Confirmation SMS",
] as const;

type StatusTone = "idle" | "active" | "done" | "halted";

interface StatusMeta {
  label: string;
  tone: StatusTone;
  /** Index into WORKFLOW_STEPS that is currently in progress; 5 means all done. */
  step: number;
}

const STATUS_META: Record<string, StatusMeta> = {
  WAITING_FOR_MANAGER_COMMAND: { label: "Waiting for manager command", tone: "idle", step: 0 },
  SHIFT_CREATED: { label: "Shift created", tone: "active", step: 1 },
  CALLING_WORKER: { label: "Calling worker", tone: "active", step: 1 },
  WORKER_DECLINED: { label: "Worker declined", tone: "active", step: 1 },
  WORKER_ACCEPTED: { label: "Worker accepted", tone: "active", step: 2 },
  TRIGGERING_VOICEOS: { label: "Triggering VoiceOS", tone: "active", step: 3 },
  VOICEOS_COMPLETE: { label: "VoiceOS complete", tone: "active", step: 3 },
  SENDING_SMS: { label: "Sending SMS", tone: "active", step: 4 },
  COMPLETE: { label: "Rescue complete", tone: "done", step: 5 },
  INCOMPLETE: { label: "Rescue incomplete", tone: "halted", step: 4 },
};

export function statusMeta(status: string): StatusMeta {
  return STATUS_META[status] ?? { label: status.replace(/_/g, " ").toLowerCase(), tone: "idle", step: 0 };
}

export function statusTagClass(status: string): string {
  const { tone } = statusMeta(status);
  return tone === "idle" ? "status-tag" : `status-tag status-tag-${tone}`;
}
