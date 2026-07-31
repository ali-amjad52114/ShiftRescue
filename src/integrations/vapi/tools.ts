import type { VapiToolDefinition } from "./types";

/**
 * Where Vapi POSTs tool calls. Must be publicly reachable (Vercel URL in prod).
 * Points at the existing /api/vapi-result route, which accepts both the Vapi
 * tool-call envelope and a plain { workerId, decision } body.
 */
export function toolServerUrl(): string {
  const base =
    process.env.VAPI_TOOL_SERVER_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return `${base.replace(/\/$/, "")}/api/vapi-result`;
}

const noModelParameters = {
  type: "object" as const,
  properties: {},
  required: [],
};

function trustedParameters(decision: string) {
  return [
    { key: "workerId", value: "{{ workerId }}" },
    { key: "attemptId", value: "{{ attemptId }}" },
    { key: "decision", value: decision },
  ];
}

/**
 * The three decision tools. Each one produces exactly one structured result:
 * { workerId, decision }.
 */
export function buildVapiTools(): VapiToolDefinition[] {
  const server = { url: toolServerUrl(), timeoutSeconds: 20 };

  return [
    {
      type: "function",
      function: {
        name: "accept_shift",
        description:
          "Call when the worker has clearly agreed to take the shift. Use only after an explicit yes.",
        parameters: {
          type: "object" as const,
          properties: {
            agreedPay: {
              type: "string",
              description:
                "The hourly rate the worker agreed to, exactly as you said it out loud, for example '$26 per hour'. Use the posted rate if pay was never negotiated. Anything above the authorised ceiling is rejected by the backend.",
            },
          },
          required: [],
        },
      },
      server,
      parameters: trustedParameters("accepted"),
      messages: [
        { type: "request-start", content: "" },
        { type: "request-failed", content: "" },
      ],
    },
    {
      type: "function",
      function: {
        name: "decline_shift",
        description:
          "Call when the worker has clearly refused the shift. Use only after an explicit no.",
        parameters: noModelParameters,
      },
      server,
      parameters: trustedParameters("declined"),
      messages: [
        { type: "request-start", content: "" },
        { type: "request-failed", content: "" },
      ],
    },
    {
      type: "function",
      function: {
        name: "needs_clarification",
        description:
          "Call when no clear yes or no was reached: unclear speech, the worker is unsure, or they asked for something outside the shift details.",
        parameters: {
          type: "object" as const,
          properties: {
            reason: {
              type: "string",
              description: "Short reason, for example: audio unclear, worker undecided.",
            },
          },
          required: [],
        },
      },
      server,
      parameters: trustedParameters("needs_clarification"),
      messages: [
        { type: "request-start", content: "" },
        { type: "request-failed", content: "" },
      ],
    },
  ];
}

export const vapiToolNames = ["accept_shift", "decline_shift", "needs_clarification"] as const;
