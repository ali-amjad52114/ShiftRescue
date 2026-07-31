import type { Shift, Worker, WorkerDecision } from "@/lib/workflow/types";

export type { WorkerDecision } from "@/lib/workflow/types";

/** Languages the assistant is allowed to speak. */
export type SupportedLanguage = "English" | "Spanish" | "Urdu" | "Punjabi";

/** Shift details handed to the assistant by the backend. Nothing else may be spoken. */
export interface ShiftCallContext {
  workerId: string;
  shiftId: string;
  attemptId: string;
  workerName: string;
  language: SupportedLanguage;
  role: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  pay: string;
}

/** The single structured result the backend expects from the call. */
export interface VapiDecisionResult {
  workerId: string;
  attemptId: string;
  decision: WorkerDecision;
}

export interface StartVapiShiftCallInput {
  workerId: string;
  workerName: string;
  phone: string;
  language: string;
  shift: Shift;
  attemptId?: string;
}

export interface StartVapiShiftCallResult {
  success: boolean;
  callId?: string;
  attemptId?: string;
  error?: string;
}

/** Vapi function-tool definition (subset we use). */
export interface VapiToolDefinition {
  type: "function";
  function: {
    name: VapiToolName;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
  server?: { url: string; timeoutSeconds?: number };
  /** Server-trusted values interpolated from assistant variableValues. */
  parameters?: Array<{ key: string; value: string }>;
  messages?: Array<{ type: string; content: string }>;
}

export type VapiToolName = "accept_shift" | "decline_shift" | "needs_clarification";

/** Shape of the tool-call webhook Vapi POSTs to our server URL. */
export interface VapiToolCallWebhook {
  message: {
    type: string;
    toolCalls?: Array<{
      id: string;
      type?: string;
      parameters?: Record<string, unknown>;
      arguments?: Record<string, unknown>;
      function: {
        name: string;
        arguments?: string | Record<string, unknown>;
        parameters?: string | Record<string, unknown>;
      };
    }>;
    toolCallList?: Array<{
      id: string;
      name?: string;
      arguments?: Record<string, unknown>;
      parameters?: Record<string, unknown>;
      function?: {
        name: string;
        arguments?: string | Record<string, unknown>;
        parameters?: string | Record<string, unknown>;
      };
    }>;
    call?: { id?: string; assistantOverrides?: { variableValues?: Record<string, unknown> } };
    assistant?: { variableValues?: Record<string, unknown> };
  };
}

/** What we send back to Vapi so the assistant can close the call politely. */
export interface VapiToolCallResponse {
  results: Array<{ toolCallId: string; result: string }>;
}

export type { Shift, Worker };
