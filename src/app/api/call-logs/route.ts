import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";
import { clearCallLogs, getCallLog, listCallLogs } from "@/lib/calls/log";

/**
 * Call log for the ops console.
 *
 * Behind the operator login: the entries carry the full system prompt and every
 * word both sides said, which is more than the public dashboard should expose.
 * Phone numbers are never written to the log in the first place.
 *
 *   GET  /api/call-logs                 latest calls, newest first
 *   GET  /api/call-logs?attemptId=att_… one call in full
 *   GET  /api/call-logs?limit=50
 *   DELETE /api/call-logs               clear
 */
export async function GET(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ success: false, error: "Sign in required" }, { status: 401 });
  }

  const url = new URL(req.url);
  const attemptId = url.searchParams.get("attemptId");

  if (attemptId) {
    const entry = await getCallLog(attemptId);
    if (!entry) {
      return NextResponse.json({ success: false, error: "No such call" }, { status: 404 });
    }
    return NextResponse.json({ success: true, call: entry });
  }

  const limit = Number(url.searchParams.get("limit") ?? 20);
  const calls = await listCallLogs(Number.isFinite(limit) ? Math.min(limit, 50) : 20);
  return NextResponse.json({ success: true, calls });
}

export async function DELETE() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ success: false, error: "Sign in required" }, { status: 401 });
  }
  await clearCallLogs();
  return NextResponse.json({ success: true });
}
