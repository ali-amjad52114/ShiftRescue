// Realistic Vapi payloads, shared by the HTTP probe and the vitest suites so
// the thing being timed is the same shape as the thing production receives.

export interface ToolCallFixtureInput {
  workerId: string;
  attemptId: string;
  toolName: "accept_shift" | "decline_shift" | "needs_clarification";
  callId?: string;
}

/**
 * The envelope Vapi POSTs for a decision tool. `parameters` carries the
 * server-trusted values (workerId, attemptId, decision) that the assistant is
 * not allowed to make up; `arguments` carries anything the model supplied.
 */
export function toolCallEnvelope(input: ToolCallFixtureInput) {
  const decision =
    input.toolName === "accept_shift"
      ? "accepted"
      : input.toolName === "decline_shift"
        ? "declined"
        : "needs_clarification";

  return {
    message: {
      type: "tool-calls",
      call: {
        id: input.callId ?? "call_probe_0001",
        assistantOverrides: {
          variableValues: { workerId: input.workerId, attemptId: input.attemptId },
        },
      },
      toolCallList: [
        {
          id: "toolcall_probe_0001",
          name: input.toolName,
          parameters: {
            workerId: input.workerId,
            attemptId: input.attemptId,
            decision,
          },
          function: { name: input.toolName, arguments: "{}" },
        },
      ],
    },
  };
}

/** The end-of-call report, which arrives even when no tool ever fired. */
export function endOfCallEnvelope(callId: string, endedReason = "customer-ended-call") {
  return {
    message: {
      type: "end-of-call-report",
      call: { id: callId },
      endedReason,
    },
  };
}
