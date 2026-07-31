import type { VapiToolDefinition } from "./types";

/**
 * Where Vapi POSTs tool calls. Must be publicly reachable (Vercel URL in prod).
 * Points at the existing /api/vapi-result route, which accepts both the Vapi
 * tool-call envelope and a plain { workerId, decision } body.
 */
export function toolServerUrl(): string {
  const base =
    process.env.VAPI_TOOL_SERVER_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return `${base.replace(/\/$/, "")}/api/vapi-result`;
}

const workerIdParameter = {
  type: "object" as const,
  properties: {
    workerId: {
      type: "string",
      description: "The worker ID supplied by the backend for this call, for example worker-2.",
    },
  },
  required: ["workerId"],
};

/**
 * The three decision tools. Each one produces exactly one structured result:
 * { workerId, decision }.
 */
export function buildVapiTools(): VapiToolDefinition[] {
  const server = { url: toolServerUrl() };

  return [
    {
      type: "function",
      function: {
        name: "accept_shift",
        description:
          "Call when the worker has clearly agreed to take the shift. Use only after an explicit yes.",
        parameters: workerIdParameter,
      },
      server,
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
        parameters: workerIdParameter,
      },
      server,
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
            ...workerIdParameter.properties,
            reason: {
              type: "string",
              description: "Short reason, for example: audio unclear, worker undecided.",
            },
          },
          required: ["workerId"],
        },
      },
      server,
      messages: [
        { type: "request-start", content: "" },
        { type: "request-failed", content: "" },
      ],
    },
  ];
}

export const vapiToolNames = ["accept_shift", "decline_shift", "needs_clarification"] as const;
