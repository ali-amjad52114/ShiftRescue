import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";
import { createEmployee, listEmployees } from "@/lib/employees/store";

async function guard() {
  return (await isAuthenticated())
    ? null
    : NextResponse.json({ success: false, error: "Sign in required" }, { status: 401 });
}

/** Gated: this is the only place phone numbers are returned. */
export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  return NextResponse.json({ employees: await listEmployees() });
}

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  try {
    return NextResponse.json({ employee: await createEmployee(await req.json()) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid employee";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
