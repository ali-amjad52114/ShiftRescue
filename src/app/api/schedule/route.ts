import { NextResponse } from "next/server";
import { listShifts, VENUE_NAME, VENUE_LOCATION } from "@/lib/shifts/store";
import { listEmployees } from "@/lib/employees/store";
import { getWorkflowState } from "@/lib/workflow/state";
import { isRescueActive } from "@/lib/workflow/coverage";
import { DEFAULT_TIME_ZONE } from "@/lib/time/schedule";
import { isAuthenticated } from "@/lib/auth/session";

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
      confirmedBySms: Boolean(state.proof.smsMessageId),
    },
  });
}
