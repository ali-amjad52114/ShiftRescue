# ShiftRescue — Final Hackathon MVP Plan

## Exact Demo Workflow

```
Manager speaks a command through VoiceOS
        ↓
VoiceOS sends structured shift details to the backend
        ↓
Backend selects the first hardcoded worker
        ↓
Backend asks Vapi to start the call
        ↓
Vapi uses the a1mobile phone number
        ↓
Vapi + OpenAI conducts the multilingual conversation
        ↓
Vapi sends the worker’s decision back to the backend
        ↓
Backend decides the next task
        ↓
If declined: call the next worker
If accepted: trigger VoiceOS again
        ↓
VoiceOS updates the scheduling app, Calendar and Slack
        ↓
Backend asks a1mobile to send confirmation SMS
        ↓
Dashboard shows the verified results
```

---

## Important Architecture Clarification

### VoiceOS starts the workflow
The manager should not begin from the dashboard.  
The manager gives a command such as:  
*“Find coverage for today’s kitchen shift from 6 PM to 10 PM.”*  

VoiceOS extracts only the required shift details and sends them to the backend:
```json
{
  "role": "Kitchen Assistant",
  "date": "July 31",
  "startTime": "6:00 PM",
  "endTime": "10:00 PM",
  "location": "Downtown San Francisco"
}
```

### Backend controls the workflow
The backend does not perform voice conversations or desktop actions.  
It only:
- stores the current demo state,
- selects the next worker,
- starts the next call,
- receives the worker’s decision,
- determines what action happens next,
- triggers VoiceOS after acceptance,
- triggers confirmation SMS,
- exposes status to the dashboard.

### Vapi runs the conversation
Vapi:
- starts the outbound call using the a1mobile number,
- connects OpenAI,
- speaks in the worker’s preferred language,
- handles interruptions,
- collects a clear decision,
- sends the result to the backend.

### VoiceOS is used twice
- **First use: manager command**  
  Manager voice command → create uncovered shift → send structured details to backend
- **Second use: completing the business workflow**  
  Worker accepts → assign worker in scheduling app → create Calendar event → post Slack confirmation

---

## Person 1 — a1mobile

### Responsibility
Own the real phone number and SMS layer.

### Build
- Configure the a1mobile number.
- Make the number usable by Vapi.
- Confirm that outbound calls display or use the a1mobile number.
- Handle basic call-status information if provided.
- Send confirmation SMS after backend approval.
- Return call and SMS proof IDs.

### Inputs
From Vapi or backend:
```json
{
  "workerPhone": "+1...",
  "workerId": "worker-2"
}
```

For SMS:
```json
{
  "phone": "+1...",
  "message": "You are confirmed for the Kitchen Assistant shift from 6 PM to 10 PM."
}
```

### Outputs
```json
{
  "success": true,
  "callId": "call_123"
}
```
```json
{
  "success": true,
  "messageId": "sms_123",
  "status": "sent"
}
```

### Done When
- Vapi can place one real call using the a1mobile number.
- One confirmation SMS reaches a real phone.
- IDs or API responses can be shown as proof.

### Do Not Build
- Bulk calling
- Contact management
- Call campaigns
- Retry queues
- Call analytics
- Recording management
- Multiple providers
- Authentication
- Databases
- A frontend
- Production monitoring

---

## Person 2 — Vapi + OpenAI + Dashboard

### Part A — Vapi and OpenAI
Own the multilingual worker conversation.

#### Build
- One Vapi assistant.
- Connect the assistant to OpenAI.
- Use the a1mobile phone number.
- Accept shift details from the backend.
- Speak in English, Spanish and Urdu or Punjabi.
- Explain role, time, location and pay.
- Handle interruptions and unclear speech.
- Ask for a final clear decision.
- Return one structured result to the backend.

#### Required Result
```json
{
  "workerId": "worker-2",
  "decision": "accepted"
}
```

Allowed decisions:
- `accepted`
- `declined`
- `needs_clarification`

#### Required Tools
- `accept_shift`
- `decline_shift`
- `needs_clarification`

#### Do Not Invent
- Different pay
- Benefits
- Transportation
- Overtime
- Flexible hours
- Manager approval
- Information not supplied by the backend

---

### Part B — Dashboard & Production Deployment
The dashboard displays the workflow and acts as the project homepage (`/`).

#### Live Production Link
- **Homepage / Live Dashboard**: [https://shiftrescue.vercel.app](https://shiftrescue.vercel.app)
- **Primary Vercel Scope**: `krampiotrs-projects` (`KramPiotr`)

#### Build
- Current open shift
- Current worker being called
- Language being used
- Current workflow status
- Timeline of events
- Final proof IDs
- Reset Demo button

#### Example Timeline
- Manager command received
- Shift created
- Calling Maria in Spanish
- Maria declined
- Calling Ahmed in Urdu
- Ahmed accepted
- Schedule updated
- Calendar event created
- Slack message posted
- Confirmation SMS sent
- Rescue complete

#### Poll
`GET /api/status` every one or two seconds.

#### Done When
- Vapi returns accepted or declined.
- Dashboard displays backend state.
- Dashboard shows proof after completion.

#### Do Not Build
- Login
- User accounts
- Worker portal
- Multiple pages
- Analytics
- Charts
- Complex animations
- Editable schedules
- Custom speech infrastructure
- Automatic language detection unless trivial
- Backend workflow logic
- A general-purpose voice agent

---

## Person 3 — Minimal Workflow Backend

### Responsibility
Own the simple sequence connecting VoiceOS, Vapi, a1mobile and the dashboard.

Use:
- Next.js API routes
- One in-memory state file
- One shift
- Three hardcoded workers

### Required State
```
WAITING_FOR_MANAGER_COMMAND
  → SHIFT_CREATED
  → CALLING_WORKER_1
  → WORKER_1_DECLINED
  → CALLING_WORKER_2
  → WORKER_2_ACCEPTED
  → TRIGGERING_VOICEOS
  → VOICEOS_COMPLETE
  → SENDING_SMS
  → COMPLETE
```

### Hardcoded Workers
```javascript
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

### Minimal Endpoints
- `POST /api/voiceos-command`
- `POST /api/vapi-result`
- `POST /api/voiceos-result`
- `GET  /api/status`
- `POST /api/reset`

#### `POST /api/voiceos-command`
Receives the manager’s VoiceOS command:
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
Then:
1. Store the shift.
2. Select Worker 1.
3. Ask Vapi to start the call.
4. Update the timeline.

#### `POST /api/vapi-result`
Receives:
```json
{
  "workerId": "worker-1",
  "decision": "declined"
}
```
Rules:
- If declined, start the next worker call.
- If accepted, save the worker and trigger VoiceOS.
- If clarification is needed, allow one repeat.
- Ignore results received after someone has already accepted.

#### `POST /api/voiceos-result`
Receives:
```json
{
  "success": true,
  "scheduleUpdated": true,
  "calendarEventId": "calendar_123",
  "slackMessageId": "slack_123"
}
```
Then:
1. Store the proof.
2. Ask a1mobile to send confirmation SMS.
3. Mark the workflow complete after the SMS request succeeds.

#### `GET /api/status`
Returns:
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

### Done When
VoiceOS command → first call → decline → second call → acceptance → VoiceOS actions → SMS → dashboard proof

### Do Not Build
- Database
- Authentication
- Queues
- Redis
- Supabase
- LangGraph
- CrewAI
- Microservices
- Complex matching
- Multiple shifts
- Parallel calls
- Worker availability algorithms
- Qualification engines
- Production concurrency
- Retry infrastructure
- Generic workflow engine
- Security systems
- Deployment architecture

*A single in-memory object is enough.*

---

## Person 4 — VoiceOS

### Responsibility
Own both VoiceOS moments.

### Part A — Manager Command
The manager speaks:  
*“Find coverage for today’s Kitchen Assistant shift from 6 PM to 10 PM.”*

VoiceOS extracts:
- role
- date
- start time
- end time
- location
- pay if provided

VoiceOS sends the structured command to: `POST /api/voiceos-command`

### Part B — Actions After Acceptance
The backend sends:
```json
{
  "workerName": "Ahmed",
  "role": "Kitchen Assistant",
  "date": "July 31",
  "startTime": "6:00 PM",
  "endTime": "10:00 PM",
  "location": "Downtown San Francisco"
}
```

VoiceOS then:
1. Updates the scheduling application.
2. Creates a Google Calendar event.
3. Posts a Slack confirmation.

#### Required Visible Change
- **Shift status**: OPEN → FILLED
- **Assigned worker**: Ahmed

#### Calendar Event
```
Kitchen Assistant Shift — Ahmed
6:00 PM–10:00 PM
Downtown San Francisco
```

#### Slack Message
```
ShiftRescue completed: Ahmed accepted the Kitchen Assistant shift from 6 PM to 10 PM. The schedule and calendar were updated.
```

#### Output to Backend
```json
{
  "success": true,
  "scheduleUpdated": true,
  "calendarEventId": "calendar_123",
  "slackMessageId": "slack_123"
}
```

### Done When
- Manager can start the workflow using VoiceOS.
- An accepted worker causes at least one visible application update.
- VoiceOS returns proof to the backend.

### Do Not Build
- A full scheduling product
- A new calendar app
- A Slack client
- General-purpose VoiceOS tools
- Payroll
- Shift swapping
- Employee onboarding
- Manager approval systems
- Multiple workflows
- Complex browser automation
- Production recovery logic
- Actions unrelated to this demo

---

## Final MVP Boundary

The project includes only:
- one manager command,
- one uncovered shift,
- three hardcoded workers,
- one decline,
- one acceptance,
- multilingual calling,
- one scheduling update,
- one Calendar event,
- one Slack message,
- one confirmation SMS,
- one dashboard timeline.

*Nothing else should be added until this entire path works reliably.*

---

## Final Rule for All Coding Agents

> **Do not improve the architecture beyond what the demo needs.**  
> **Do not introduce production patterns, security systems, scalability work, abstractions or additional features.**  
> **A simple, slightly hardcoded end-to-end demo is better than a sophisticated system that fails during judging.**
