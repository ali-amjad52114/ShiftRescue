export async function startA1MobileCall(input: {
  workerId: string;
  phone: string;
  language: string;
  shiftId: string;
}): Promise<{
  success: boolean;
  callId?: string;
  error?: string;
}> {
  void input;
  return {
    success: true,
    callId: "mock-a1mobile-call-id",
  };
}

export async function sendA1MobileSms(input: {
  phone: string;
  message: string;
}): Promise<{
  success: boolean;
  messageId?: string;
  status?: "sent" | "delivered";
  error?: string;
}> {
  void input;
  return {
    success: true,
    messageId: "mock-a1mobile-message-id",
    status: "sent",
  };
}
