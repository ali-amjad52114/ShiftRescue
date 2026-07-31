// What the assistant is actually told about the shift.
//
// The regression these guard against: a rescue started from the schedule got a
// shift carrying only absolute instants, and the spoken date, start time and
// end time were passed through as empty strings. The worker heard "we have a
// Kitchen Assistant shift on ,  to ,  at Downtown San Francisco".

import { beforeEach, describe, expect, it } from "vitest";
import { buildCallContext } from "../../../src/integrations/a1mobile/client";
import { buildFirstMessage, buildShiftPrompt } from "../../../src/integrations/vapi/prompt";
import { buildAssistantOverrides } from "../../../src/integrations/vapi/assistant";
import { spokenShiftWindow } from "../../../src/lib/time/schedule";
import { startCoverage } from "../../../src/lib/workflow/coverage";
import { getWorkflowState, resetWorkflowState } from "../../../src/lib/workflow/state";
import { resetEmployees } from "../../../src/lib/employees/store";
import { createShift, resetShifts } from "../../../src/lib/shifts/store";

describe("spokenShiftWindow", () => {
  it("renders instants into the venue's own wall clock", () => {
    const spoken = spokenShiftWindow({
      startsAt: "2026-08-01T01:00:00.000Z", // 6pm Jul 31 in Los Angeles
      endsAt: "2026-08-01T06:00:00.000Z",
      timeZone: "America/Los_Angeles",
    });

    expect(spoken.date).toBe("Friday, July 31");
    expect(spoken.startTime).toBe("6:00 PM");
    expect(spoken.endTime).toBe("11:00 PM");
  });

  it("prefers strings the shift already carries", () => {
    const spoken = spokenShiftWindow({
      startsAt: "2026-08-01T01:00:00.000Z",
      endsAt: "2026-08-01T06:00:00.000Z",
      timeZone: "America/Los_Angeles",
      date: "Friday",
      startTime: "6 PM",
      endTime: "11 PM",
    });

    expect(spoken).toEqual({ date: "Friday", startTime: "6 PM", endTime: "11 PM" });
  });

  it("treats a blank stored string as missing rather than as a value", () => {
    const spoken = spokenShiftWindow({
      startsAt: "2026-08-01T01:00:00.000Z",
      endsAt: "2026-08-01T06:00:00.000Z",
      timeZone: "America/Los_Angeles",
      date: "   ",
    });
    expect(spoken.date).toBe("Friday, July 31");
  });

  it("returns empty strings when there is nothing at all to render", () => {
    expect(spokenShiftWindow({})).toEqual({ date: "", startTime: "", endTime: "" });
  });
});

describe("a shift started from the schedule", () => {
  beforeEach(async () => {
    process.env.DEMO_WORKER_1_PHONE = "+14155550101";
    process.env.DEMO_WORKER_2_PHONE = "+14155550102";
    process.env.DEMO_WORKER_3_PHONE = "+14155550103";
    process.env.SIMULATE = "true";
    process.env.CALL_LOG_FILE = "off";
    await resetEmployees();
    await resetShifts();
    await resetWorkflowState();
  });

  it("carries spoken date and times into the workflow, not just instants", async () => {
    const shift = await createShift({
      role: "Kitchen Assistant",
      startsAt: "2026-08-01T01:00:00.000Z",
      endsAt: "2026-08-01T06:00:00.000Z",
      location: "Downtown San Francisco",
      pay: "$24 per hour",
    });

    await startCoverage(shift.id);
    const state = await getWorkflowState();

    expect(state.shift?.date).toBe("Friday, July 31");
    expect(state.shift?.startTime).toBe("6:00 PM");
    expect(state.shift?.endTime).toBe("11:00 PM");
  });
});

describe("what reaches the assistant", () => {
  const shift = {
    role: "Kitchen Assistant",
    location: "Downtown San Francisco",
    pay: "$24 per hour",
    date: "Friday, July 31",
    startTime: "6:00 PM",
    endTime: "11:00 PM",
  };

  const context = () =>
    buildCallContext({
      workerId: "emp_ahmed",
      workerName: "Ahmed Khan",
      language: "Urdu",
      shiftId: "sh_1",
      attemptId: "att_1",
      shift,
    });

  it("puts every shift fact in the spoken greeting", () => {
    const greeting = buildFirstMessage(context());
    for (const fact of ["Ahmed Khan", "Kitchen Assistant", "Friday, July 31", "6:00 PM", "11:00 PM", "$24"]) {
      expect(greeting).toContain(fact);
    }
  });

  it("never leaves a placeholder unfilled in the greeting or the prompt", () => {
    expect(buildFirstMessage(context())).not.toMatch(/\{\{/);
    expect(buildShiftPrompt(context())).not.toMatch(/\{\{/);
  });

  it("never speaks an empty field where a shift detail belongs", () => {
    // "shift on ,  to ," is what a dropped date looks like out loud.
    expect(buildFirstMessage(context())).not.toMatch(/\son\s*,/);
  });

  it("sends the same facts as Vapi variableValues", () => {
    const overrides = buildAssistantOverrides(context());
    expect(overrides.variableValues.date).toBe("Friday, July 31");
    expect(overrides.variableValues.startTime).toBe("6:00 PM");
    expect(overrides.variableValues.endTime).toBe("11:00 PM");
    expect(overrides.variableValues.pay).toBe("$24 per hour");
    expect(overrides.variableValues.attemptId).toBe("att_1");
  });

  it("takes the venue name from config rather than hardcoding it", () => {
    expect(context().venueName).toBeTruthy();
    expect(buildShiftPrompt(context())).toContain(context().venueName);
  });
});
