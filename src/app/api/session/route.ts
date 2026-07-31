import { NextResponse } from "next/server";
import { SESSION_COOKIE, checkCredentials, issueToken } from "@/lib/auth/session";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!checkCredentials(body?.username, body?.password)) {
    return NextResponse.json(
      { success: false, error: "Incorrect username or password" },
      { status: 401 },
    );
  }

  const token = issueToken();
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, token.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: token.maxAge,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
