# API Contracts

The workflow uses real a1mobile call/SMS proof when `SIMULATE=false`.
Responses containing `mock` or `sim-` are development-only and are not sponsor proof.

## Manager command

`POST /api/voiceos-command`

```json
{
  "role": "Kitchen Assistant",
  "date": "July 31",
  "startTime": "6:00 PM",
  "endTime": "10:00 PM",
  "location": "Downtown San Francisco",
  "pay": "$24 per hour"
}
```

## Vapi result

`POST /api/vapi-result`

```json
{
  "workerId": "emp_maria",
  "attemptId": "att_emp_maria_...",
  "decision": "declined"
}
```

Allowed decisions are `accepted`, `declined`, and `needs_clarification`.
`workerId` and `attemptId` are injected as server-trusted Vapi tool parameters;
the model cannot choose them. Vapi's `tool-calls` envelope is accepted at the
same endpoint.

## VoiceOS result

`POST /api/voiceos-result`

```json
{
  "success": true,
  "scheduleUpdated": true,
  "calendarEventId": "calendar_real_id",
  "slackMessageId": "slack_real_id",
  "gmailMessageId": "gmail_real_id",
  "spreadsheetId": "sheet_real_id",
  "spreadsheetUpdateRange": "'Shift Events'!A8:V8"
}
```

The backend, not VoiceOS, sends the final a1mobile confirmation SMS and stores
the message ID returned by a1mobile.

## Current status

`GET /api/status`

Returns the current workflow state with employee phone numbers and the active
attempt ID removed. State uses Upstash Redis when configured and otherwise
falls back to the local process.

## Reset demo

`POST /api/reset`

Restores the initial in-memory workflow state.
