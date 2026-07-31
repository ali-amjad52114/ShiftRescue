import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    success: true,
    status: "SHIFT_CREATED",
    message: "mock voiceos-command response",
  });
}
