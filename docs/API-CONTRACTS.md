# API Contracts

The workflow uses real a1mobile call/SMS proof when `SIMULATE=false`.
Responses containing `mock` or `sim-` are development-only and are not sponsor proof.
The UI strikes those values through and labels them, so a simulated run can never
be mistaken for a real one.

## Ordering

A rescue starts from the schedule (`/api/coverage`) or from a spoken manager
command (`/api/voiceos-command`). Both converge on the same engine and place the
same real call.

On acceptance the backend does two things **immediately**, without waiting for
anything external: it marks the shift covered in the schedule, and it sends the
a1mobile confirmation SMS. These are the half of the loop this service owns end to
end, and nothing here can wake VoiceOS — the MCP bridge is passive and has to be
polling. Gating them behind it would mean an accepted shift never reaching the
worker.

VoiceOS proof is therefore **additive**: `/api/voiceos-result` records the external
mirror ids and never changes whether the shift is covered. Its rail step stays
"not run" until all five ids exist.

## Start coverage for a scheduled shift

`POST /api/coverage` — **signed in**

```json
{ "shiftId": "sh_a1b2c3d4" }
```

Refuses with 400 when the shift is already covered, does not exist, or another
rescue is in flight. The engine holds one run at a time.

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

The spoken window is resolved to absolute instants, then matched against the
schedule. An unassigned shift with the same role and the **exact** same window is
reused; anything else is booked as a new shift at the time asked for. Snapping to
a nearby slot would make the assistant say one thing while the schedule meant
another.

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
same endpoint, as is its `end-of-call-report` — which is the only signal that a
worker never answered once the serverless function has returned.

A decision whose `attemptId` is not the active one is rejected with 400.

## Operator override

`POST /api/admin/decision` — **signed in**

```json
{ "decision": "accepted" }
```

Records a decision by hand when a call connected but the tool webhook never
arrived. The attempt id is read from server state, never accepted from the caller:
it is deliberately stripped from `/api/status` so a leaked webhook cannot advance
the queue, and this route works because it is authenticated, not because it knows
the id. Returns 409 when no call is in progress.

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

Rejected with 400 when any value is blank, when `scheduleUpdated` is not true, or
when **no shift has been accepted** — proof cannot be posted onto an empty run.
Partial results record nothing at all.

`{ "success": false }` records the failure without undoing an acceptance that
really happened. The rail then shows the VoiceOS step as failed while the shift
stays covered.

The backend, not VoiceOS, sends the a1mobile confirmation SMS and stores the
message ID returned by a1mobile. VoiceOS never supplies SMS proof.

## Register the Vapi webhook

`POST /api/admin/vapi-sync` — **signed in**

Pushes this deployment's prompt, decision tools and `server.url` onto the Vapi
assistant. Run after every deploy and after any prompt or tool change. Refuses
when the resolved URL is localhost, which Vapi cannot reach.

## Deployment readiness

`GET /api/preflight`

Booleans only — no secret is echoed back. Public, because the most common failure
it catches is a missing `APP_PASSWORD`, which is what makes signing in impossible
in the first place. The exact webhook URL is included only when signed in.

## Current status

`GET /api/status`

The current workflow state with employee phone numbers and the active attempt ID
removed. State uses Upstash Redis when configured and otherwise falls back to the
local process; Redis is **required** on Vercel, where several instances serve
requests and cannot share an in-process object.

## Schedule

`GET /api/schedule`

Everything the schedule screen needs: shifts, people (display names only, never
phone numbers), and the live rescue including its timeline and proof.

## Reset

`POST /api/reset` — **signed in**

Clears the current rescue and hands its shift back, so the demo is repeatable.
Only ever un-assigns a shift this run covered; one somebody else has since been
put on is left alone. Signed in because an open endpoint that wipes live state is
not something to leave exposed during judging.
