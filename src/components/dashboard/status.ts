export const WORKFLOW_STEPS = [
  "Manager command",
  "Worker calls",
  "Acceptance",
  "VoiceOS actions",
  "Confirmation SMS",
] as const;

type StatusTone = "idle" | "active" | "done" | "failed";

export type StepState = "done" | "active" | "failed" | "pending";

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
  INCOMPLETE: { label: "Rescue incomplete", tone: "failed", step: 2 },
};

export function statusMeta(status: string): StatusMeta {
  return STATUS_META[status] ?? { label: status.replace(/_/g, " ").toLowerCase(), tone: "idle", step: 0 };
}

export function statusTagClass(status: string): string {
  const { tone } = statusMeta(status);
  return tone === "idle" ? "status-tag" : `status-tag status-tag-${tone}`;
}

/**
 * State of every step in the rail.
 *
 * A step is only ever "done" when it actually happened. A failed run must not
 * render later steps as complete — the demo is scored on side effects that can
 * be independently confirmed, so claiming an un-run step is a fabricated success.
 *
 * `hasAcceptance` distinguishes the two ways a run can fail: every worker
 * declined (acceptance itself failed) versus VoiceOS failing after someone had
 * already accepted.
 */
export function railStates(status: string, hasAcceptance: boolean): StepState[] {
  const { step, tone } = statusMeta(status);

  if (tone === "failed") {
    const failedIndex = hasAcceptance ? 3 : 2;
    return WORKFLOW_STEPS.map((_, index) =>
      index < failedIndex ? "done" : index === failedIndex ? "failed" : "pending",
    );
  }

  return WORKFLOW_STEPS.map((_, index) =>
    index < step ? "done" : index === step ? "active" : "pending",
  );
}
