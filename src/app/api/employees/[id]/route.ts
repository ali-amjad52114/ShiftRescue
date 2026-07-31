import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";
import { deleteEmployee, updateEmployee } from "@/lib/employees/store";

type Context = { params: Promise<{ id: string }> };

async function guard() {
  return (await isAuthenticated())
    ? null
    : NextResponse.json({ success: false, error: "Sign in required" }, { status: 401 });
}

export async function PATCH(req: Request, { params }: Context) {
  const denied = await guard();
  if (denied) return denied;
  try {
    const { id } = await params;
    return NextResponse.json({ employee: await updateEmployee(id, await req.json()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid update";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Context) {
  const denied = await guard();
  if (denied) return denied;
  try {
    const { id } = await params;
    await deleteEmployee(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not remove";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
