import { describe, expect, it, vi } from "vitest";
import { buildBasePrompt, buildFirstMessage, buildShiftPrompt, resolveLanguage } from "../prompt";
import { interpolate, loadPromptSections, parsePromptMarkdown } from "../promptFile";
import { buildVapiTools, toolServerUrl, vapiToolNames } from "../tools";
import {
  parseVapiToolCall,
  buildToolCallResponse,
  handleVapiWebhook,
  isVapiToolCallPayload,
} from "../webhook";
import type { ShiftCallContext } from "../types";

const context: ShiftCallContext = {
  workerId: "worker-2",
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

  it("requires workerId on every tool", () => {
    for (const tool of buildVapiTools()) {
      expect(tool.function.parameters.required).toContain("workerId");
    }
  });
});

describe("parseVapiToolCall", () => {
  it("returns the structured result for accept_shift", () => {
    const parsed = parseVapiToolCall({
      message: {
        type: "tool-calls",
        toolCallList: [
          { id: "call_1", name: "accept_shift", arguments: { workerId: "worker-2" } },
        ],
      },
    });

    expect(parsed?.result).toEqual({ workerId: "worker-2", decision: "accepted" });
  });

  it("parses stringified arguments and maps decline and clarification", () => {
    const declined = parseVapiToolCall({
      message: {
        type: "tool-calls",
        toolCalls: [
          {
            id: "call_2",
            type: "function",
            function: { name: "decline_shift", arguments: '{"workerId":"worker-1"}' },
          },
        ],
      },
    });
    expect(declined?.result.decision).toBe("declined");

    const unclear = parseVapiToolCall({
      message: {
        type: "tool-calls",
        toolCallList: [
          { id: "call_3", name: "needs_clarification", arguments: { workerId: "worker-3" } },
        ],
      },
    });
    expect(unclear?.result.decision).toBe("needs_clarification");
  });

  it("falls back to the call variable values when workerId is missing", () => {
    const parsed = parseVapiToolCall({
      message: {
        type: "tool-calls",
        toolCallList: [{ id: "call_4", name: "accept_shift", arguments: {} }],
        call: { assistantOverrides: { variableValues: { workerId: "worker-2" } } },
      },
    });

    expect(parsed?.result.workerId).toBe("worker-2");
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
      toolCallList: [{ id: "call_9", name: "accept_shift", arguments: { workerId: "worker-2" } }],
    },
  };

  it("delivers the decision and replies so the assistant can close", async () => {
    const deliver = vi.fn();
    const { status, body } = await handleVapiWebhook(acceptPayload, deliver);

    expect(deliver).toHaveBeenCalledWith({ workerId: "worker-2", decision: "accepted" });
    expect(status).toBe(200);
    expect(body).toEqual(buildToolCallResponse("call_9", "accepted"));
  });

  it("acks non tool-call messages without delivering anything", async () => {
    const deliver = vi.fn();
    const { status } = await handleVapiWebhook({ message: { type: "status-update" } }, deliver);

    expect(deliver).not.toHaveBeenCalled();
    expect(status).toBe(200);
  });

  it("reports 502 when the backend reducer throws", async () => {
    const deliver = vi.fn(() => {
      throw new Error("state write failed");
    });
    const { status, body } = await handleVapiWebhook(acceptPayload, deliver);

    expect(status).toBe(502);
    expect(body).toMatchObject({ success: false, error: "state write failed" });
  });
});

describe("isVapiToolCallPayload", () => {
  it("separates the tool-call envelope from a plain decision body", () => {
    expect(isVapiToolCallPayload({ message: { type: "tool-calls" } })).toBe(true);
    expect(isVapiToolCallPayload({ workerId: "worker-2", decision: "accepted" })).toBe(false);
    expect(isVapiToolCallPayload(null)).toBe(false);
  });
});
