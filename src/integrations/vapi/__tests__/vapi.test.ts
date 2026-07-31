import { describe, expect, it, vi } from "vitest";
import { buildBasePrompt, buildFirstMessage, buildShiftPrompt, resolveLanguage } from "../prompt";
import { interpolate, loadPromptSections, parsePromptMarkdown } from "../promptFile";
import { buildVapiTools, toolServerUrl, vapiToolNames } from "../tools";
import {
  parseVapiToolCall,
  parseVapiCallEnded,
  buildToolCallResponse,
  handleVapiWebhook,
  isVapiToolCallPayload,
} from "../webhook";
import type { ShiftCallContext } from "../types";

const context: ShiftCallContext = {
  workerId: "worker-2",
  shiftId: "shift-1",
  attemptId: "att-worker-2-1",
  workerName: "Ahmed",
  language: "Urdu",
  role: "Kitchen Assistant",
  date: "July 31",
  startTime: "6:00 PM",
  endTime: "10:00 PM",
  location: "Downtown San Francisco",
  pay: "$24 per hour",
};

describe("resolveLanguage", () => {
  it("maps the demo worker languages", () => {
    expect(resolveLanguage("Spanish")).toBe("Spanish");
    expect(resolveLanguage("urdu")).toBe("Urdu");
    expect(resolveLanguage("pa")).toBe("Punjabi");
    expect(resolveLanguage("")).toBe("English");
  });
});

describe("buildShiftPrompt", () => {
  it("includes every backend-supplied shift fact", () => {
    const prompt = buildShiftPrompt(context);
    for (const fact of [
      context.role,
      context.date,
      context.startTime,
      context.endTime,
      context.location,
      context.pay,
      context.workerId,
    ]) {
      expect(prompt).toContain(fact);
    }
  });

  it("forbids the invented topics", () => {
    const prompt = buildShiftPrompt(context).toLowerCase();
    for (const topic of ["benefits", "transportation", "overtime", "flexible hours", "manager approval"]) {
      expect(prompt).toContain(topic);
    }
    expect(prompt).toContain("never invent");
  });
});

describe("buildVapiTools", () => {
  it("exposes exactly the three required tools", () => {
    const names = buildVapiTools().map((tool) => tool.function.name);
    expect(names).toEqual([...vapiToolNames]);
  });

  it("keeps worker and attempt ids out of model-controlled parameters", () => {
    for (const tool of buildVapiTools()) {
      expect(tool.function.parameters.required).not.toContain("workerId");
      expect(tool.function.parameters.properties).not.toHaveProperty("workerId");
      expect(tool.parameters).toEqual(
        expect.arrayContaining([
          { key: "workerId", value: "{{ workerId }}" },
          { key: "attemptId", value: "{{ attemptId }}" },
        ]),
      );
    }
  });
});

describe("parseVapiToolCall", () => {
  it("returns the structured result for accept_shift", () => {
    const parsed = parseVapiToolCall({
      message: {
        type: "tool-calls",
        toolCallList: [
          {
            id: "call_1",
            name: "accept_shift",
            arguments: { workerId: "worker-2", attemptId: "att-2" },
          },
        ],
      },
    });

    expect(parsed?.result).toEqual({
      workerId: "worker-2",
      attemptId: "att-2",
      decision: "accepted",
    });
  });

  it("parses stringified arguments and maps decline and clarification", () => {
    const declined = parseVapiToolCall({
      message: {
        type: "tool-calls",
        toolCalls: [
          {
            id: "call_2",
            type: "function",
            function: {
              name: "decline_shift",
              arguments: '{"workerId":"worker-1","attemptId":"att-1"}',
            },
          },
        ],
      },
    });
    expect(declined?.result.decision).toBe("declined");

    const unclear = parseVapiToolCall({
      message: {
        type: "tool-calls",
        toolCallList: [
          {
            id: "call_3",
            name: "needs_clarification",
            parameters: { workerId: "worker-3", attemptId: "att-3" },
          },
        ],
      },
    });
    expect(unclear?.result.decision).toBe("needs_clarification");
  });

  it("parses function.parameters from alternate Vapi webhook shapes", () => {
    const parsed = parseVapiToolCall({
      message: {
        type: "tool-calls",
        toolCallList: [
          {
            id: "call_parameters",
            function: {
              name: "decline_shift",
              parameters: {
                workerId: "worker-1",
                attemptId: "att-parameters",
              },
            },
          },
        ],
      },
    });

    expect(parsed?.result).toEqual({
      workerId: "worker-1",
      attemptId: "att-parameters",
      decision: "declined",
    });
  });

  it("falls back to the call variable values when workerId is missing", () => {
    const parsed = parseVapiToolCall({
      message: {
        type: "tool-calls",
        toolCallList: [{ id: "call_4", name: "accept_shift", arguments: {} }],
        call: {
          assistantOverrides: {
            variableValues: { workerId: "worker-2", attemptId: "att-2" },
          },
        },
      },
    });

    expect(parsed?.result.workerId).toBe("worker-2");
    expect(parsed?.result.attemptId).toBe("att-2");
  });

  it("ignores non tool-call messages", () => {
    expect(parseVapiToolCall({ message: { type: "status-update" } })).toBeNull();
  });
});

describe("buildToolCallResponse", () => {
  it("returns a result keyed to the tool call id", () => {
    const response = buildToolCallResponse("call_1", "accepted");
    expect(response.results[0].toolCallId).toBe("call_1");
    expect(response.results[0].result.length).toBeGreaterThan(0);
  });
});

describe("prompt.md", () => {
  it("supplies every section the assistant reads", () => {
    const sections = loadPromptSections();
    for (const key of [
      "systemPrompt",
      "basePrompt",
      "greeting.English",
      "greeting.Spanish",
      "greeting.Urdu",
      "greeting.Punjabi",
    ]) {
      expect(sections[key], `prompt.md is missing "## ${key}"`).toBeTruthy();
    }
  });

  it("splits on headings and drops the editor documentation", () => {
    const sections = parsePromptMarkdown(
      "Docs above the first heading.\n\n## greeting.English\n\nHi {{workerName}}.\n\n## systemPrompt\n\nBody here.\n"
    );
    expect(sections).toEqual({
      "greeting.English": "Hi {{workerName}}.",
      systemPrompt: "Body here.",
    });
  });

  it("fills known placeholders and leaves typos visible", () => {
    expect(interpolate("Hi {{workerName}}, {{oops}}", { workerName: "Ahmed" })).toBe(
      "Hi Ahmed, {{oops}}"
    );
  });

  it("greets each worker in their own language with their name", () => {
    expect(buildFirstMessage(context)).toContain("Ahmed");
    expect(buildFirstMessage({ ...context, language: "Spanish" })).toContain("Hola");
    expect(buildFirstMessage(context)).not.toContain("{{");
  });

  it("leaves no unfilled placeholders in the per-call prompt", () => {
    expect(buildShiftPrompt(context)).not.toContain("{{");
    expect(buildBasePrompt().length).toBeGreaterThan(0);
  });
});

describe("toolServerUrl", () => {
  it("targets the existing vapi-result route", () => {
    expect(toolServerUrl()).toMatch(/\/api\/vapi-result$/);
  });

  it("is the same url every tool posts to", () => {
    for (const tool of buildVapiTools()) {
      expect(tool.server?.url).toBe(toolServerUrl());
    }
  });
});

describe("handleVapiWebhook", () => {
  const acceptPayload = {
    message: {
      type: "tool-calls",
      toolCallList: [
        {
          id: "call_9",
          name: "accept_shift",
          arguments: { workerId: "worker-2", attemptId: "att-2" },
        },
      ],
    },
  };

  it("delivers the decision and replies so the assistant can close", async () => {
    const deliver = vi.fn();
    const { status, body } = await handleVapiWebhook(acceptPayload, { onDecision: deliver });

    expect(deliver).toHaveBeenCalledWith({
      workerId: "worker-2",
      attemptId: "att-2",
      decision: "accepted",
    });
    expect(status).toBe(200);
    expect(body).toEqual(buildToolCallResponse("call_9", "accepted"));
  });

  it("acks non tool-call messages without delivering anything", async () => {
    const deliver = vi.fn();
    const { status } = await handleVapiWebhook({ message: { type: "status-update" } }, { onDecision: deliver });

    expect(deliver).not.toHaveBeenCalled();
    expect(status).toBe(200);
  });

  it("returns an honest spoken failure when the backend reducer throws", async () => {
    const deliver = vi.fn(() => {
      throw new Error("state write failed");
    });
    const { status, body } = await handleVapiWebhook(acceptPayload, { onDecision: deliver });

    expect(status).toBe(200);
    expect(body).toMatchObject({
      results: [{ toolCallId: "call_9", result: expect.stringContaining("could not be recorded") }],
    });
  });
});

describe("end-of-call reports", () => {
  const endedPayload = {
    message: {
      type: "end-of-call-report",
      endedReason: "customer-did-not-answer",
      call: { id: "call_abc" },
    },
  };

  it("extracts the call id and reason", () => {
    expect(parseVapiCallEnded(endedPayload)).toEqual({
      callId: "call_abc",
      endedReason: "customer-did-not-answer",
    });
  });

  it("ignores every other message type", () => {
    expect(parseVapiCallEnded({ message: { type: "speech-update" } })).toBeNull();
    expect(parseVapiCallEnded({ message: { type: "conversation-update" } })).toBeNull();
  });

  it("hands the ended call to the workflow so a no-answer cannot stall it", async () => {
    const onDecision = vi.fn();
    const onCallEnded = vi.fn();
    const { status } = await handleVapiWebhook(endedPayload, { onDecision, onCallEnded });

    expect(onCallEnded).toHaveBeenCalledWith({
      callId: "call_abc",
      endedReason: "customer-did-not-answer",
    });
    expect(onDecision).not.toHaveBeenCalled();
    expect(status).toBe(200);
  });

  it("still acks when no call-ended handler is wired", async () => {
    const { status } = await handleVapiWebhook(endedPayload, { onDecision: vi.fn() });
    expect(status).toBe(200);
  });
});

describe("isVapiToolCallPayload", () => {
  it("separates the tool-call envelope from a plain decision body", () => {
    expect(isVapiToolCallPayload({ message: { type: "tool-calls" } })).toBe(true);
    expect(isVapiToolCallPayload({ workerId: "worker-2", decision: "accepted" })).toBe(false);
    expect(isVapiToolCallPayload(null)).toBe(false);
  });
});
