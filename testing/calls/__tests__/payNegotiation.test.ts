// Pay negotiation.
//
// The assistant may raise the rate to close a shift. It reports what it said
// out loud; the backend decides what the worker actually gets. Everything here
// is about that boundary, because a model that can set pay is a model that can
// promise a worker $40 an hour.

import { beforeEach, describe, expect, it } from "vitest";
import {
  formatPay,
  maxPayFor,
  parsePay,
  settleAgreedPay,
} from "../../../src/integrations/vapi/pay";
import { buildCallContext } from "../../../src/integrations/a1mobile/client";
import { buildShiftPrompt } from "../../../src/integrations/vapi/prompt";
import { buildVapiTools } from "../../../src/integrations/vapi/tools";
import { parseVapiToolCall } from "../../../src/integrations/vapi/webhook";
import { handleVapiResult } from "../../../src/lib/workflow/actions";
import { getWorkflowState, resetWorkflowState } from "../../../src/lib/workflow/state";
import { resetEmployees } from "../../../src/lib/employees/store";
import { startCoverage } from "../../../src/lib/workflow/coverage";
import { createShift, resetShifts } from "../../../src/lib/shifts/store";
import { toolCallEnvelope } from "../../latency/fixtures.ts";

describe("parsePay", () => {
  it("pulls the number out of the prose the rate is stored as", () => {
    expect(parsePay("$24 per hour")).toEqual({ amount: 24, symbol: "$", suffix: "per hour" });
    expect(parsePay("£18.50/hr")).toEqual({ amount: 18.5, symbol: "£", suffix: "/hr" });
  });

  it("returns null for a rate with no number in it", () => {
    expect(parsePay("negotiable")).toBeNull();
    expect(parsePay(undefined)).toBeNull();
    expect(parsePay("")).toBeNull();
  });
});

describe("formatPay", () => {
  it("renders back into the shape the original had", () => {
    const like = parsePay("$24 per hour")!;
    expect(formatPay(29, like)).toBe("$29 per hour");
    expect(formatPay(26.5, like)).toBe("$26.50 per hour");
  });
});

describe("maxPayFor", () => {
  it("is the posted rate plus the budget", () => {
    expect(maxPayFor("$24 per hour", 5)).toBe("$29 per hour");
  });

  it("defaults to five dollars of room", () => {
    expect(maxPayFor("$24 per hour")).toBe("$29 per hour");
  });

  it("disables negotiation on a rate it cannot parse, rather than inventing one", () => {
    expect(maxPayFor("negotiable")).toBe("negotiable");
  });
});

describe("settleAgreedPay", () => {
  it("accepts a raise inside the budget", () => {
    const outcome = settleAgreedPay("$24 per hour", "$26 per hour", 5);
    expect(outcome).toEqual({ pay: "$26 per hour", raise: 2, clamped: false });
  });

  it("accepts a raise exactly at the ceiling", () => {
    expect(settleAgreedPay("$24 per hour", "$29 per hour", 5).pay).toBe("$29 per hour");
    expect(settleAgreedPay("$24 per hour", "$29 per hour", 5).clamped).toBe(false);
  });

  it("clamps an assistant that promised more than it was allowed", () => {
    const outcome = settleAgreedPay("$24 per hour", "$40 per hour", 5);
    expect(outcome.pay).toBe("$29 per hour");
    expect(outcome.raise).toBe(5);
    expect(outcome.clamped).toBe(true);
  });

  it("ignores a rate at or below the posted one", () => {
    // A worker does not negotiate downwards; this is a mis-transcription.
    expect(settleAgreedPay("$24 per hour", "$20 per hour", 5).pay).toBe("$24 per hour");
    expect(settleAgreedPay("$24 per hour", "$24 per hour", 5).raise).toBe(0);
  });

  it("keeps the posted rate when the assistant reported nothing", () => {
    expect(settleAgreedPay("$24 per hour", undefined, 5).pay).toBe("$24 per hour");
  });

  it("keeps the posted rate when it is not a number to begin with", () => {
    expect(settleAgreedPay("negotiable", "$99 per hour", 5).pay).toBe("negotiable");
  });

  it("handles a bare number from the model", () => {
    expect(settleAgreedPay("$24 per hour", "26", 5).pay).toBe("$26 per hour");
  });
});

describe("what the assistant is told about pay", () => {
  const context = () =>
    buildCallContext({
      workerId: "emp_john",
      workerName: "John Byrne",
      language: "English",
      shiftId: "sh_1",
      attemptId: "att_1",
      shift: {
        role: "Server",
        location: "Downtown San Francisco",
        pay: "$24 per hour",
        date: "Friday, July 31",
        startTime: "6:00 PM",
        endTime: "11:00 PM",
      },
    });

  it("gets a ceiling and the headroom, both computed per call", () => {
    expect(context().maxPay).toBe("$29 per hour");
    expect(context().payHeadroom).toBe("$5");
  });

  it("is told the ceiling in the prompt and told not to say it", () => {
    const prompt = buildShiftPrompt(context());
    expect(prompt).toContain("$29 per hour");
    expect(prompt).toMatch(/Never state your ceiling out loud/i);
  });

  it("can report the agreed rate back through accept_shift", () => {
    const accept = buildVapiTools().find((t) => t.function.name === "accept_shift")!;
    expect(accept.function.parameters.properties).toHaveProperty("agreedPay");
  });
});

describe("the negotiated rate coming back", () => {
  beforeEach(async () => {
    process.env.DEMO_WORKER_1_PHONE = "+14155550101";
    process.env.DEMO_WORKER_2_PHONE = "+14155550102";
    process.env.DEMO_WORKER_3_PHONE = "+14155550103";
    process.env.SIMULATE = "true";
    process.env.CALL_LOG_FILE = "off";
    await resetEmployees();
    await resetShifts();
    await resetWorkflowState();

    const shift = await createShift({
      role: "Kitchen Assistant",
      startsAt: "2026-08-01T01:00:00.000Z",
      endsAt: "2026-08-01T06:00:00.000Z",
      location: "Downtown San Francisco",
      pay: "$24 per hour",
    });
    await startCoverage(shift.id);
  });

  it("is parsed off the tool call", () => {
    const parsed = parseVapiToolCall({
      message: {
        type: "tool-calls",
        toolCallList: [
          {
            id: "tc_1",
            name: "accept_shift",
            parameters: { workerId: "emp_maria", attemptId: "att_1", decision: "accepted" },
            function: { name: "accept_shift", arguments: JSON.stringify({ agreedPay: "$27 per hour" }) },
          },
        ],
      },
    } as never);

    expect(parsed?.result.agreedPay).toBe("$27 per hour");
  });

  it("raises the stored rate, so the confirmation text matches the call", async () => {
    const started = await getWorkflowState();
    await handleVapiResult({
      workerId: started.currentWorkerId!,
      attemptId: started.activeAttemptId!,
      decision: "accepted",
      agreedPay: "$27 per hour",
    });

    const state = await getWorkflowState();
    expect(state.shift?.pay).toBe("$27 per hour");
    expect(state.timeline.some((e) => e.message.includes("negotiated the rate to $27 per hour"))).toBe(true);
  });

  it("caps a rate the assistant had no authority to offer", async () => {
    const started = await getWorkflowState();
    await handleVapiResult({
      workerId: started.currentWorkerId!,
      attemptId: started.activeAttemptId!,
      decision: "accepted",
      agreedPay: "$45 per hour",
    });

    const state = await getWorkflowState();
    expect(state.shift?.pay).toBe("$29 per hour");
    expect(state.timeline.some((e) => e.message.includes("capped at the authorised maximum"))).toBe(true);
  });

  it("leaves the posted rate alone when nothing was negotiated", async () => {
    const started = await getWorkflowState();
    await handleVapiResult({
      workerId: started.currentWorkerId!,
      attemptId: started.activeAttemptId!,
      decision: "accepted",
      agreedPay: "$24 per hour",
    });

    const state = await getWorkflowState();
    expect(state.shift?.pay).toBe("$24 per hour");
    expect(state.timeline.some((e) => e.message.includes("negotiated"))).toBe(false);
  });

  it("survives a decline that carries a stray agreedPay", async () => {
    const started = await getWorkflowState();
    const envelope = toolCallEnvelope({
      workerId: started.currentWorkerId!,
      attemptId: started.activeAttemptId!,
      toolName: "decline_shift",
    });

    const parsed = parseVapiToolCall(envelope as never);
    await handleVapiResult(parsed!.result);

    const state = await getWorkflowState();
    expect(state.shift?.pay).toBe("$24 per hour");
  });
});
