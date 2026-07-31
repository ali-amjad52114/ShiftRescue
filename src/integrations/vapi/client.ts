import type { Shift } from "@/lib/workflow/types";

export async function startVapiShiftCall(input: {
  workerId: string;
  workerName: string;
  phone: string;
  language: string;
  shift: Shift;
}): Promise<{
  success: boolean;
  callId?: string;
  error?: string;
}> {
  void input;
  return {
    success: true,
    callId: "mock-vapi-call-id",
  };
}
