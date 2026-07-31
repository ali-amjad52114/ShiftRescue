import { NextResponse } from "next/server";
import { handleVapiResult } from "@/lib/workflow/actions";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const state = handleVapiResult(body);
    return NextResponse.json({
      success: true,
      status: state.status,
      state,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Invalid payload" },
      { status: 400 }
    );
  }
}
