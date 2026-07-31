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
  /** Highest rate the assistant may offer if the worker pushes back on pay. */
  maxPay: string;
  /** The negotiating room, spoken as an amount, e.g. "$5". */
  payHeadroom: string;
  /** Venue the call is on behalf of, so the prompt is not hardcoded to one. */
  venueName: string;
}

/** The single structured result the backend expects from the call. */
export interface VapiDecisionResult {
  workerId: string;
  attemptId: string;
  decision: WorkerDecision;
  /**
   * Rate the worker agreed to, when the assistant negotiated above the posted
   * one. Model-supplied and therefore untrusted — clamped server-side.
   */
  agreedPay?: string;
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

/** A call that finished, whether or not the worker ever decided anything. */
export interface VapiCallEnded {
  callId?: string;
  endedReason?: string;
}

/** Shape of the tool-call webhook Vapi POSTs to our server URL. */
export interface VapiToolCallWebhook {
  message: {
    type: string;
    endedReason?: string;
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
    role?: string;
    transcript?: string;
    transcriptType?: string;
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
