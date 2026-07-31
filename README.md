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
-> VoiceOS updates the schedule, Calendar, and Slack
-> a1mobile sends a confirmation SMS
-> Dashboard displays the workflow and proof
```

## Folder ownership

- Person 1: `src/integrations/a1mobile/`
- Person 2: `src/integrations/vapi/`, `src/app/dashboard/`, and `src/components/dashboard/`
- Person 3: `src/app/api/`, `src/lib/workflow/`, and `src/data/`
- Person 4: `src/integrations/voiceos/`

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
DEMO_WORKER_1_PHONE=
DEMO_WORKER_2_PHONE=
DEMO_WORKER_3_PHONE=
```

Never commit real credentials.

## How to run the project

```bash
npm install
npm run dev
```

Open `http://localhost:3000` for the project page or `http://localhost:3000/dashboard` for the dashboard placeholder. Run `npm run typecheck` to verify the shared TypeScript contracts and `npm run build` to create a production build.

## Currently mocked integrations

- a1mobile outbound calling returns `mock-a1mobile-call-id`.
- a1mobile SMS returns `mock-a1mobile-message-id` with a `sent` status.
- Vapi shift calls return `mock-vapi-call-id`.
- VoiceOS completion returns mock schedule, Calendar, and Slack proof.
- All five API routes return clearly labeled mock responses.

Mocks exist only so teammates can integrate in parallel. They must not be presented as real sponsor proof in the final demo.

## Final MVP boundary

The project supports only one manager VoiceOS command, one uncovered shift, three hardcoded workers, sequential calls, one decline, one acceptance, three demonstration languages, one VoiceOS schedule update, one Calendar event, one Slack message, one confirmation SMS, one dashboard page, and one in-memory workflow state.

Do not add authentication, databases, queues, microservices, worker ranking, parallel calling, production infrastructure, or features outside this boundary.
