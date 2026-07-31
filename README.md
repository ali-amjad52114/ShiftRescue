# ShiftRescue

## Project description

ShiftRescue is a hackathon MVP that fills one uncovered shift through a voice-first, multilingual workflow. VoiceOS captures the manager's request, Vapi and OpenAI call workers through a1mobile, and the dashboard shows progress and proof.

## Exact workflow

```text
Manager gives a VoiceOS command
-> VoiceOS sends shift details to the backend
-> Backend selects a worker
-> Vapi starts a call using the a1mobile number
-> Vapi + OpenAI conducts a multilingual conversation
-> Worker decision returns to the backend
-> Backend calls the next worker or triggers VoiceOS actions
-> VoiceOS updates the schedule, Calendar, Slack, Gmail, and Google Sheets
-> a1mobile sends a confirmation SMS
-> Dashboard displays the workflow and proof
```

## Folder ownership & responsibilities

- **Person 1**: `src/integrations/a1mobile/` (telephony & SMS verification)
- **Person 2**: `src/integrations/vapi/` (voice agent prompt & tool calls)
- **Person 3**: `src/app/api/`, `src/lib/workflow/`, `src/data/`, `src/app/dashboard/`, `src/components/dashboard/` (workflow engine, dashboard frontend integration, and Vercel deployment)
- **Person 4**: `src/integrations/voiceos/` (VoiceOS desktop actions & command structuring)

See `docs/TEAM-OWNERSHIP.md` for shared-file coordination and suggested branch names.

## Required environment variables

Copy `.env.example` to `.env.local` and add sponsor credentials when they are available:

```env
OPENAI_API_KEY=
VAPI_API_KEY=
VAPI_ASSISTANT_ID=
A1MOBILE_API_KEY=
A1MOBILE_PHONE_NUMBER=
VOICEOS_API_KEY=
SHIFTRESCUE_SPREADSHEET_ID=
DEMO_WORKER_1_PHONE=
DEMO_WORKER_2_PHONE=
DEMO_WORKER_3_PHONE=
```

Never commit real credentials.

### Optional voice tuning

Every stage of the call pipeline can be swapped without a code change, so a
provider can be A/B'd against a real call. Defaults are the values that cover
all four languages (English, Spanish, Urdu, Punjabi).

```env
VAPI_OPENAI_MODEL=gpt-4o                # brain
VAPI_TRANSCRIBER_PROVIDER=openai        # e.g. azure, deepgram
VAPI_TRANSCRIBER_MODEL=gpt-4o-transcribe
VAPI_VOICE_PROVIDER=openai
VAPI_OPENAI_VOICE=alloy
VAPI_START_WAIT_SECONDS=0.2             # pause before the assistant may reply
VAPI_SILENCE_TIMEOUT_SECONDS=10         # dead air before Vapi hangs up
VAPI_MAX_CALL_SECONDS=300
VAPI_NOISY_ENVIRONMENT=false            # true if workers answer from loud places
VAPI_DENOISING=on                       # "off" to disable background-voice removal
VAPI_STOP_NUM_WORDS=                    # override the barge-in rule directly
VENUE_NAME=Harbour Street Kitchen       # spoken on every call
SHIFT_MAX_PAY_INCREASE=5                # negotiating room, per hour
```

Measure before and after with `npm run profile` — see `testing/README.md`.

## How shift details reach the assistant

Every fact the assistant may speak comes from one shift record and is rendered
once, on the way out:

```
src/lib/shifts/store.ts        ScheduledShift — startsAt/endsAt as ISO instants
  ↓  getShift(shiftId)
src/lib/workflow/coverage.ts   startCoverage() → state.shift
  ↓  spokenShiftWindow() renders instants into "Friday, July 31" / "6:00 PM"
src/lib/workflow/actions.ts    dialCurrentWorker()
  ↓  startA1MobileCall({ shift })
src/integrations/a1mobile/client.ts  buildCallContext() adds maxPay + venueName
  ↓  buildAssistantOverrides(context)
src/integrations/vapi/assistant.ts   variableValues + per-call system prompt
  ↓
src/integrations/vapi/prompt.md      {{date}} {{startTime}} {{pay}} {{maxPay}} …
```

A manager command (`/api/voiceos-command`) enters the same pipeline at
`state.shift` instead of at the store. `spokenShiftWindow()` in
[src/lib/time/schedule.ts](src/lib/time/schedule.ts) is the single place the
spoken forms are derived, so neither entry point can hand the assistant a blank
date.

## Call logs

Every call writes an append-only record: the exact greeting, system prompt and
variables the assistant was given, each final transcript line, the decision tool
it fired, the settled rate, and how the call ended.

- Store: [src/lib/calls/log.ts](src/lib/calls/log.ts) (Redis, last 50 calls)
- Local mirror: `logs/vapi-calls.jsonl` — gitignored, disable with `CALL_LOG_FILE=off`
- Read it: `GET /api/call-logs`, `GET /api/call-logs?attemptId=…` (operator login required)

Phone numbers are never written to the log.

## How to run the project

```bash
npm install
npm run dev
```

Open `http://localhost:3000` for the live dashboard (`/dashboard` renders the same view). The UI follows the design system in `DESIGN.md`. Run `npm run typecheck` to verify the shared TypeScript contracts and `npm run build` to create a production build.

## Integration status

- a1mobile outbound calling returns `mock-a1mobile-call-id`.
- a1mobile SMS returns `mock-a1mobile-message-id` with a `sent` status.
- Vapi shift calls return `mock-vapi-call-id`.
- VoiceOS uses the real local MCP bridge in `src/integrations/voiceos/` and rejects incomplete or mock Calendar, Slack, Gmail, and Google Sheets proof.
- The seeded staffing/payroll workbook compares scheduled and confirmed workers and calculates actual hours, variance, and pay with formulas. VoiceOS must append real before/after rows; seeded rows are demo data only.
- The workflow waits for a real a1mobile SMS ID instead of inventing completion proof.

The remaining a1mobile and Vapi stubs exist only so teammates can integrate in parallel. They must not be presented as real sponsor proof in the final demo.

## Final MVP boundary

The project supports only one manager VoiceOS command, one uncovered shift, three hardcoded workers, sequential calls, one decline, one acceptance, three demonstration languages, one VoiceOS schedule update, one Calendar event, one Slack message, one Gmail confirmation, one Google Sheets before/after update, one confirmation SMS, and one dashboard page.

Do not add authentication, databases, queues, microservices, worker ranking, parallel calling, production infrastructure, or features outside this boundary.
