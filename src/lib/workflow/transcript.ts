import { getWorkflowState, updateWorkflowState } from "./state";
import type { TranscriptLine, WorkflowState } from "./types";

/** Keep the panel bounded; a long call should not grow the stored state forever. */
const MAX_LINES = 60;

/**
 * Append a line of the live conversation.
 *
 * Only ever records what an integration actually reported — nothing here
 * invents dialogue, so an unwired call shows an empty transcript rather than a
 * plausible-looking script.
 */
export async function appendTranscriptLine(input: {
  speaker: "agent" | "worker";
  text: string;
  workerId?: string;
}): Promise<WorkflowState> {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text === "") throw new Error("A transcript line needs text");
  if (input.speaker !== "agent" && input.speaker !== "worker") {
    throw new Error('speaker must be "agent" or "worker"');
  }

  const state = await getWorkflowState();

  // No call in progress means this line belongs to nothing on screen. Storing
  // it would surface a stray utterance inside the next call's conversation.
  if (!state.currentWorkerId) return state;

  // A line arriving for a worker who is no longer on the phone belongs to a
  // finished call and must not be shown against the current one.
  if (input.workerId && state.currentWorkerId && input.workerId !== state.currentWorkerId) {
    return state;
  }

  const line: TranscriptLine = {
    id: `line_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    speaker: input.speaker,
    text,
    timestamp: new Date().toISOString(),
  };

  const transcript = [...(state.transcript ?? []), line].slice(-MAX_LINES);
  return updateWorkflowState({ ...state, transcript });
}

/** A new call starts a new conversation. */
export function clearedTranscript(state: WorkflowState): WorkflowState {
  return { ...state, transcript: [] };
}
