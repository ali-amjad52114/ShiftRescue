import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";
import { createShift, listShifts } from "@/lib/shifts/store";

export async function GET() {
  return NextResponse.json({ shifts: await listShifts() });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  try {
    return NextResponse.json({ shift: await createShift(await req.json()) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid shift";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
