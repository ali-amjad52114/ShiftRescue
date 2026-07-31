# API Contracts

All route implementations are placeholders. Responses containing `mock` are not sponsor proof.

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
  "workerId": "worker-1",
  "decision": "declined"
}
```

Allowed decisions are `accepted`, `declined`, and `needs_clarification`.

## VoiceOS result

`POST /api/voiceos-result`

```json
{
  "success": true,
  "scheduleUpdated": true,
  "calendarEventId": "calendar_123",
  "slackMessageId": "slack_123"
}
```

## Current status

`GET /api/status`

Returns the current in-memory workflow state.

## Reset demo

`POST /api/reset`

Restores the initial in-memory workflow state.
