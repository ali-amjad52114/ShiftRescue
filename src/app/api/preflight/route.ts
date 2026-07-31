import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";
import { toolServerUrl } from "@/integrations/vapi";
import { callableEmployees, listEmployees } from "@/lib/employees/store";
import { storageMode } from "@/lib/redis";
import { listShifts } from "@/lib/shifts/store";
import { DEFAULT_TIME_ZONE } from "@/lib/time/schedule";

const set = (name: string) => Boolean(process.env[name]?.trim());

/**
 * Is this deployment actually able to run a demo?
 *
 * Public, and reports booleans rather than values — no secret is echoed back.
 * It has to be reachable without signing in, because the most common failure it
 * catches is a missing APP_PASSWORD, which is the thing that makes signing in
 * impossible in the first place.
 */
export async function GET() {
  const onVercel = process.env.VERCEL === "1";
  const storage = storageMode();
  const webhook = toolServerUrl();
  const webhookIsPublic = !webhook.startsWith("http://localhost");

  const [roster, callable, shifts, signedIn] = await Promise.all([
    listEmployees(),
    callableEmployees(),
    listShifts(),
    isAuthenticated(),
  ]);

  // callableEmployees() deliberately keeps people with no number on the roster —
  // the call layer reports that honestly rather than hiding them. For a demo it
  // is still a problem, because each one burns a turn in the queue.
  const reachable = callable.filter((e) => e.phone.trim() !== "").length;

  const now = Date.now();
  const openUpcoming = shifts.filter(
    (s) => !s.assignedEmployeeId && new Date(s.startsAt).getTime() > now,
  ).length;

  const checks = {
    // Without Redis on Vercel every route throws: the webhook and the browser
    // land on different instances and cannot see each other's state.
    sharedState: onVercel ? storage === "redis" : true,
    // A deployment left on the built-in demo credentials, where the session
    // signing key is a constant published in this repo. Fine on a laptop;
    // set APP_PASSWORD and APP_SESSION_SECRET for anything reachable.
    ownCredentials: !onVercel || (set("APP_PASSWORD") && set("APP_SESSION_SECRET")),
    // Vapi has to be able to reach this deployment to deliver decisions and the
    // end-of-call report.
    webhookReachable: webhookIsPublic,
    vapiCredentials: set("VAPI_API_KEY") && set("VAPI_ASSISTANT_ID") && set("VAPI_PHONE_NUMBER_ID"),
    a1mobileCredentials:
      set("A1MOBILE_API_KEY") || set("A1MOBILE_TEAM_KEY") || set("A1_TEAM_KEY"),
    a1mobileNumber: set("A1MOBILE_PHONE_NUMBER"),
    // A simulated run produces sim- ids, which are explicitly not sponsor proof.
    realCallsEnabled: process.env.SIMULATE !== "true",
    outboundDialling: process.env.ORIGINATION !== "inbound",
    rosterCallable: reachable > 0 && reachable === callable.length,
    haveShiftToRescue: openUpcoming > 0,
  };

  const failing = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  return NextResponse.json({
    ready: failing.length === 0,
    failing,
    checks,
    context: {
      runtime: onVercel ? "vercel" : "local",
      storage,
      timeZone: DEFAULT_TIME_ZONE,
      activeStaff: roster.filter((e) => e.active).length,
      callableStaff: callable.length,
      openUpcomingShifts: openUpcoming,
      // The exact origin is only interesting to an operator, and a private
      // tunnel URL is not something to hand out publicly.
      webhookUrl: signedIn ? webhook : undefined,
    },
  });
}
