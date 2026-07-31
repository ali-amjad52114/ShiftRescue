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
}

const STATUS_META: Record<string, StatusMeta> = {
  WAITING_FOR_MANAGER_COMMAND: { label: "Waiting for manager command", tone: "idle" },
  SHIFT_CREATED: { label: "Shift created", tone: "active" },
  CALLING_WORKER: { label: "Calling worker", tone: "active" },
  WORKER_DECLINED: { label: "Worker declined", tone: "active" },
  WORKER_ACCEPTED: { label: "Worker accepted", tone: "active" },
  TRIGGERING_VOICEOS: { label: "Triggering VoiceOS", tone: "active" },
  VOICEOS_COMPLETE: { label: "VoiceOS complete", tone: "active" },
  SENDING_SMS: { label: "Confirmation SMS not sent", tone: "failed" },
  COMPLETE: { label: "Rescue complete", tone: "done" },
  INCOMPLETE: { label: "Rescue incomplete", tone: "failed" },
};

export function statusMeta(status: string): StatusMeta {
  return STATUS_META[status] ?? { label: status.replace(/_/g, " ").toLowerCase(), tone: "idle" };
}

export function statusTagClass(status: string): string {
  const { tone } = statusMeta(status);
  return tone === "idle" ? "status-tag" : `status-tag status-tag-${tone}`;
}

export interface RailProof {
  callId?: string;
  calendarEventId?: string;
  slackMessageId?: string;
  gmailMessageId?: string;
  spreadsheetId?: string;
  spreadsheetUpdateRange?: string;
  smsMessageId?: string;
  voiceosFailed?: boolean;
}

/** Every id VoiceOS has to return before its step counts as done. */
const VOICEOS_PROOF = [
  "calendarEventId",
  "slackMessageId",
  "gmailMessageId",
  "spreadsheetId",
  "spreadsheetUpdateRange",
] as const;

/**
 * State of every step in the rail, derived from what actually happened rather
 * than from the status label.
 *
 * A step is only ever "done" when the side effect that defines it produced
 * proof. This is the rule the whole demo is scored on: claiming an un-run step
 * is a fabricated success, so the VoiceOS step stays "not run" until all five
 * of its ids exist, no matter how far the rest of the run has got.
 */
export function railStates(
  status: string,
  proof: RailProof,
  hasAcceptance: boolean,
): StepState[] {
  const started = status !== "WAITING_FOR_MANAGER_COMMAND";
  const calling = status === "CALLING_WORKER";
  const dead = status === "INCOMPLETE";

  const voiceosDone = VOICEOS_PROOF.every((key) => Boolean(proof[key]));
  const called = Boolean(proof.callId) || hasAcceptance;

  // The send happens inside the acceptance request, so the dashboard can only
  // ever observe SENDING_SMS after it failed — there is no window to poll
  // during. Treat it as the failure it is rather than a step still running.
  const smsFailed = status === "SENDING_SMS";

  return [
    started ? "done" : "pending",
    called ? "done" : calling ? "active" : dead ? "failed" : "pending",
    hasAcceptance ? "done" : dead ? "failed" : calling ? "active" : "pending",
    voiceosDone ? "done" : proof.voiceosFailed ? "failed" : hasAcceptance ? "active" : "pending",
    proof.smsMessageId ? "done" : smsFailed ? "failed" : "pending",
  ];
}
