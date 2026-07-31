import { NextResponse } from "next/server";
import { listShifts, VENUE_NAME, VENUE_LOCATION } from "@/lib/shifts/store";
import { listEmployees } from "@/lib/employees/store";
import { getWorkflowState } from "@/lib/workflow/state";
import { isRescueActive } from "@/lib/workflow/coverage";
import { DEFAULT_TIME_ZONE } from "@/lib/time/schedule";
import { isAuthenticated } from "@/lib/auth/session";

/**
 * A development placeholder is not a completed action. docs/API-CONTRACTS.md
 * states that ids containing `sim-` or `mock-` are not proof, so a simulated
 * run must not light up the same chips a real one does.
 */
function confirmed(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "" && !/(^|[-_])(sim|mock)-/i.test(value);
}

/**
 * Everything the schedule screen needs. Public, so it carries display names
 * only — never phone numbers.
 */
export async function GET() {
  const [shifts, employees, state, canManage] = await Promise.all([
    listShifts(),
    listEmployees(),
    getWorkflowState(),
    isAuthenticated(),
  ]);

  const active = isRescueActive(state);

  return NextResponse.json({
    canManage,
    venue: { name: VENUE_NAME, location: VENUE_LOCATION, timeZone: DEFAULT_TIME_ZONE },
    shifts,
    people: employees.map(({ id, name, language, role, active: isActive }) => ({
      id,
      name,
      language,
      role,
      active: isActive,
    })),
    rescue: {
      active,
      shiftId: state.shift?.id ?? null,
      status: state.status,
      callingName: active && state.currentWorkerId
        ? state.workers.find((w) => w.id === state.currentWorkerId)?.name ?? null
        : null,
      callingLanguage: active && state.currentWorkerId
        ? state.workers.find((w) => w.id === state.currentWorkerId)?.language ?? null
        : null,
      timeline: state.timeline,
      transcript: state.transcript ?? [],
      confirmedBySms: confirmed(state.proof.smsMessageId),
      // What the connected apps actually confirmed. Booleans only: the IDs
      // themselves are operator detail and stay in the admin console.
      completed: {
        schedule: Boolean(state.proof.scheduleUpdated),
        calendar: confirmed(state.proof.calendarEventId),
        slack: confirmed(state.proof.slackMessageId),
        email: confirmed(state.proof.gmailMessageId),
        sheet: confirmed(state.proof.spreadsheetId),
        sms: confirmed(state.proof.smsMessageId),
      },
      voiceosFailed: Boolean(state.proof.voiceosFailed),
    },
  });
}
