import type { Shift, Worker } from "@/lib/workflow/types";

export async function completeShiftWithVoiceOS(input: {
  worker: Worker;
  shift: Shift;
}): Promise<{
  success: boolean;
  scheduleUpdated?: boolean;
  calendarEventId?: string;
  slackMessageId?: string;
  error?: string;
}> {
  void input;
  return {
    success: true,
    scheduleUpdated: true,
    calendarEventId: "mock-calendar-event-id",
    slackMessageId: "mock-slack-message-id",
  };
}
