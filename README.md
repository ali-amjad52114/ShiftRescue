# ShiftRescue

ShiftRescue is a hackathon MVP that fills an uncovered shift through a voice-first, multilingual workflow. A manager starts the rescue with VoiceOS, workers receive sequential calls through Vapi and a1mobile, and an acceptance triggers the scheduling, calendar, Slack, and SMS confirmation steps.

## Demo workflow

```text
Manager speaks a command through VoiceOS
        |
        v
VoiceOS sends structured shift details to the backend
        |
        v
Backend selects the first hardcoded worker
        |
        v
Backend asks Vapi to start the call
        |
        v
Vapi uses the a1mobile phone number
        |
        v
Vapi + OpenAI conducts the multilingual conversation
        |
        v
Vapi sends the worker's decision back to the backend
        |
        v
Backend decides the next task
        |
        v
Declined: call the next worker
Accepted: trigger VoiceOS again
        |
        v
VoiceOS updates the scheduling app, Google Calendar, and Slack
        |
        v
Backend asks a1mobile to send a confirmation SMS
        |
        v
Dashboard shows the verified results
```

## Architecture

### VoiceOS starts and completes the workflow

The manager begins with a spoken command such as:

> Find coverage for today's Kitchen Assistant shift from 6 PM to 10 PM.

VoiceOS extracts the required shift details and sends them to the backend:

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

After a worker accepts, VoiceOS is used again to update the scheduling application, create a Google Calendar event, and post a Slack confirmation.

### Backend orchestrates the sequence

The minimal Next.js backend:

- stores the current in-memory demo state;
- selects the next hardcoded worker;
- starts each Vapi call;
- receives and evaluates worker decisions;
- triggers VoiceOS after an acceptance;
- requests the confirmation SMS; and
- exposes status and proof IDs to the dashboard.

It does not conduct voice conversations or perform desktop actions itself.

### Vapi and OpenAI conduct the conversation

The Vapi assistant calls from the a1mobile number, speaks in the worker's preferred language, explains the supplied shift details, handles interruptions, and returns one structured decision:

```json
{
  "workerId": "worker-2",
  "decision": "accepted"
}
```

Allowed decisions are `accepted`, `declined`, and `needs_clarification`. The assistant must not invent pay, benefits, transportation, overtime, flexible hours, approval requirements, or other details not supplied by the backend.

### a1mobile provides telephony and SMS

a1mobile owns the real phone-number layer used for outbound Vapi calls and sends the final confirmation SMS. Call and message IDs are retained as demo proof.

### Dashboard displays progress

The dashboard is read-only apart from a **Reset Demo** control. It polls `GET /api/status` every one or two seconds and displays:

- the open shift;
- the worker currently being called;
- the conversation language;
- workflow status;
- an event timeline; and
- final call, calendar, Slack, and SMS proof IDs.

## Workflow state

```text
WAITING_FOR_MANAGER_COMMAND
-> SHIFT_CREATED
-> CALLING_WORKER_1
-> WORKER_1_DECLINED
-> CALLING_WORKER_2
-> WORKER_2_ACCEPTED
-> TRIGGERING_VOICEOS
-> VOICEOS_COMPLETE
-> SENDING_SMS
-> COMPLETE
```

## Demo workers

```ts
const workers = [
  {
    id: "worker-1",
    name: "Maria",
    phone: "TEST_PHONE_1",
    language: "Spanish"
  },
  {
    id: "worker-2",
    name: "Ahmed",
    phone: "TEST_PHONE_2",
    language: "Urdu"
  },
  {
    id: "worker-3",
    name: "John",
    phone: "TEST_PHONE_3",
    language: "English"
  }
];
```

## API contract

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/voiceos-command` | Receive the manager's structured shift command and begin calling workers |
| `POST` | `/api/vapi-result` | Receive a worker decision and continue the sequence |
| `POST` | `/api/voiceos-result` | Store scheduling, calendar, and Slack proof, then request an SMS |
| `GET` | `/api/status` | Return the current state, worker, language, timeline, and proof IDs |
| `POST` | `/api/reset` | Reset the in-memory demo state |

### Vapi result

```json
{
  "workerId": "worker-1",
  "decision": "declined"
}
```

If the worker declines, the backend calls the next worker. If the worker accepts, the backend saves the assignment and triggers VoiceOS. A clarification may be repeated once. Results received after an acceptance are ignored.

### VoiceOS result

```json
{
  "success": true,
  "scheduleUpdated": true,
  "calendarEventId": "calendar_123",
  "slackMessageId": "slack_123"
}
```

The backend stores the proof, requests the confirmation SMS, and marks the workflow complete after the SMS request succeeds.

### Status response

```json
{
  "status": "COMPLETE",
  "currentWorker": "Ahmed",
  "language": "Urdu",
  "timeline": [],
  "proof": {
    "callId": "call_123",
    "calendarEventId": "calendar_123",
    "slackMessageId": "slack_123",
    "smsMessageId": "sms_123"
  }
}
```

## Team responsibilities

### Person 1 - a1mobile

- Configure the a1mobile phone number for Vapi.
- Verify one real outbound call.
- Send one real confirmation SMS.
- Return call and SMS proof IDs.

### Person 2 - Vapi, OpenAI, and dashboard

- Build one multilingual Vapi assistant using OpenAI.
- Support English, Spanish, and Urdu or Punjabi.
- Return a clear structured worker decision.
- Build the single-page status dashboard and timeline.

### Person 3 - workflow backend

- Build the five Next.js API routes.
- Maintain one in-memory state object.
- Orchestrate one shift across three hardcoded workers.
- Connect VoiceOS, Vapi, a1mobile, and the dashboard.

### Person 4 - VoiceOS

- Capture and structure the manager's voice command.
- Update the scheduling application after acceptance.
- Create the Google Calendar event and Slack message.
- Return visible proof to the backend.

## Definition of done

The demo succeeds when this complete path works reliably:

```text
VoiceOS command
-> first worker call
-> decline
-> second worker call
-> acceptance
-> VoiceOS application actions
-> confirmation SMS
-> dashboard proof
```

## MVP boundary

This project intentionally includes only:

- one manager command;
- one uncovered shift;
- three hardcoded workers;
- one decline and one acceptance;
- multilingual calling;
- one scheduling update;
- one calendar event;
- one Slack message;
- one confirmation SMS; and
- one dashboard timeline.

Do not add databases, authentication, queues, Redis, worker-matching algorithms, parallel calls, microservices, generic workflow engines, production concurrency, retry infrastructure, or unrelated features until the end-to-end demo is reliable.

> A simple, slightly hardcoded end-to-end demo is better than a sophisticated system that fails during judging.
