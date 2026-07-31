# a1mobile integration (Person 1)

Public surface, unchanged from the original stubs so `src/lib/workflow/` needs no edits:

```ts
startA1MobileCall({ workerId, phone, language, shiftId, attemptId?, workerName?, shift? })
  // -> { success, callId?, attemptId?, mode?, error? }

sendShiftConfirmationSms({ phone, language, workerName, shift })
  // -> { success, messageId?, status?, error? }   localized, send on acceptance

sendA1MobileSms({ phone, message })
  // -> { success, messageId?, status?, error? }

getCallOutcome(callId)                 // -> CallStatus, one shot
waitForCallOutcome(callId, { timeoutMs, intervalMs })  // -> CallStatus, polls
```

`SIMULATE=true` makes these return fake IDs without touching the network, so the
backend and dashboard can be developed without burning real calls.

## Attempt IDs

Every call attempt gets an `attemptId` (generated if not supplied, and always
returned). Pass it into the workflow state as `activeAttemptId`, have the
assistant echo it back with the decision, and **reject any decision whose
attemptId is not the active one**.

Without this, one duplicate `declined` webhook advances the worker index twice
and skips a worker live on stage. Vapi does deliver duplicate events.

## Call outcomes

A call can end without any decision — nobody answered, voicemail picked up, the
trunk failed, or they hung up mid-sentence. `getCallOutcome` classifies
`endedReason` into something the workflow can act on:

| Outcome | Meaning | What the workflow should do |
|---|---|---|
| `in-progress` | still live | wait |
| `answered` | a human picked up (may still have made no decision) | wait for the tool, then time out |
| `no-answer` | did not answer, busy, voicemail | treat as a failed attempt, move on |
| `failed` | SIP or pipeline error | record the error honestly, move on |
| `unknown` | ended with no reason given | treat as failed rather than hanging |

`answered` does **not** mean a decision was made. Without this, a worker who
ignores the call leaves the demo waiting forever, which looks identical to a
crash.

## Origination

**a1mobile has no outbound-call API.** Its documented surface is claim number,
point webhook (inbound), verify number, and send SMS. So `startA1MobileCall`
branches on `ORIGINATION`:

- `outbound` — `POST https://api.vapi.ai/call/phone` over a BYO SIP trunk built
  from the Telnyx credentials a1mobile issued. Unproven until the spike passes.
- `inbound` — sends an a1mobile SMS inviting the worker to call the demo number
  back. Every step is a documented, supported API.

Callers never learn which mode ran. Flipping the flag touches only this folder.

## Scripts

Both need `.env` at the repo root. Run from the repo root.

```bash
# claim a number, point its webhook, verify a phone, send a text
node --env-file=.env src/integrations/a1mobile/cli.mjs verify +1XXXXXXXXXX
node --env-file=.env src/integrations/a1mobile/cli.mjs confirm +1XXXXXXXXXX 123456
node --env-file=.env src/integrations/a1mobile/cli.mjs sms +1XXXXXXXXXX "hello"

# outbound spike: build the Vapi trunk, then place one real call
node --env-file=.env src/integrations/a1mobile/spike-sip-trunk.mjs trunk
node --env-file=.env src/integrations/a1mobile/spike-sip-trunk.mjs call +1XXXXXXXXXX
```

Only OTP-verified numbers may be called or texted. Verify every demo phone
before anything else — it gates the entire flow.

**Calls and texts come from different numbers.** Calls go out as our claimed
number `+16676650161` over the SIP trunk. SMS goes out as a1mobile's shared
sender `+19102121210` — tested, and it ignores both `from` and `sender` in the
request body, so this is not configurable. Say "sent through a1mobile", not
"from our a1mobile number", when describing the SMS.

`spike-sip-trunk.mjs trunk` resolves `sip.telnyx.com` to A records first,
because Vapi rejects FQDNs in `gateways` with a 400.

## Variables passed to the assistant (Person 2)

Every outbound call sends these as `assistantOverrides.variableValues`, so the
prompt should template them rather than hardcoding shift details — otherwise the
call and the SMS describe different jobs.

| Variable | Example |
|---|---|
| `{{workerName}}` | `Maria` |
| `{{language}}` | `Spanish` |
| `{{role}}` | `Kitchen Assistant` |
| `{{date}}` | `Friday, July 31` |
| `{{startTime}}` / `{{endTime}}` | `6:00 PM` / `10:00 PM` |
| `{{location}}` | `Downtown San Francisco` |
| `{{pay}}` | `$24 per hour` |
| `{{workerId}}` / `{{shiftId}}` | `worker-1` / `shift-1` |

Values come from `src/data/demo-data.ts` and the workflow's shift, so the single
source of truth is the backend, not the assistant.

## Languages

SMS copy is localized in `messages.ts` for English, Spanish, Urdu and Hindi,
including the role name, weekday/month and pay phrasing — so an Urdu call is not
followed by an English text. Unknown roles, unparseable dates and unknown
languages pass through in English rather than being mangled.

Hindi exists because Urdu speech-to-text is weak on most transcribers. If the
voice agent has to move to Hindi, the texts follow with no code change.

```bash
npx --yes tsx src/integrations/a1mobile/smoke.ts   # offline, no network
```

## Wiring the decision tools (Person 2 + Person 3)

The `attemptId` above only protects you if the assistant sends it back. Vapi has
a documented feature for exactly this — see
https://docs.vapi.ai/tools/static-variables-and-aliases

A tool has **two** `parameters` fields. `function.parameters` is the JSON schema
the model fills in; the **top-level `parameters` array** is set by us and is
never shown to the model. Trusted values belong in the second one, so the LLM
cannot invent or override them:

```json
{
  "type": "function",
  "function": {
    "name": "decline_shift",
    "parameters": {
      "type": "object",
      "properties": { "reason": { "type": "string" } }
    }
  },
  "server": { "url": "https://YOUR-TUNNEL/api/vapi-result", "timeoutSeconds": 20 },
  "parameters": [
    { "key": "workerId",  "value": "{{ workerId }}" },
    { "key": "attemptId", "value": "{{ attemptId }}" },
    { "key": "decision",  "value": "declined" }
  ]
}
```

`{{ workerId }}` and `{{ attemptId }}` resolve from the `variableValues` we send
at call creation. Vapi classifies those as server-trusted, and static values
override any same-named key the model produces. The model only supplies `reason`.

### Parsing the tool call — read this before writing the route

**Vapi's own docs disagree about where tool arguments live.** `/tools/custom-tools`
shows `toolCallList[].arguments`, `/server-url/events` shows
`toolCallList[].parameters`, community code uses
`toolCallList[].function.arguments`, and the OpenAPI schema leaves the item as an
empty object. Do not pick one — read defensively:

```ts
const call = body.message.toolCallList[0];
const toolCallId = call.id;
const name = call.name ?? call.function?.name;
let args = call.arguments ?? call.parameters
        ?? call.function?.arguments ?? call.function?.parameters ?? {};
if (typeof args === "string") args = JSON.parse(args);
```

Event type is at `body.message.type === "tool-calls"`; the call id is a sibling
at `body.message.call.id`.

### Responding

```json
{ "results": [{ "toolCallId": "<same id from the request>", "result": "Got it." }] }
```

Three rules that are easy to get wrong:
- **`result` must be a string**, not an object. `JSON.stringify` anything else.
- **Single line only** — line breaks cause parse errors.
- **Always return HTTP 200, even on failure.** Any other status is ignored
  entirely; signal problems with `"error": "..."` instead of `"result"`.

Default server timeout is 20 seconds.

## Open items for the team

1. **`docs/API-CONTRACTS.md` has no origination flag.** If the spike fails we
   run `ORIGINATION=inbound`, and the backend needs to expect a worker to call
   *in* rather than be dialed. Behaviour is otherwise identical.
2. **Decisions arrive via `POST /api/vapi-result`.** A Vapi *server tool* firing
   mid-call would let the dashboard update while the worker is still talking,
   which is a much stronger demo beat than waiting for the call to end.
   Person 2/3 call.
3. **No idempotency guard.** Vapi delivers duplicate and overlapping events. Two
   `declined` payloads for one call will advance `currentWorkerIndex` twice and
   skip a worker live on stage. Suggest an `attemptId` stamped per call attempt,
   with `/api/vapi-result` ignoring anything stale.
4. **`.env.example` gained** `VAPI_PHONE_NUMBER_ID`, `A1MOBILE_SIP_USERNAME`,
   `A1MOBILE_SIP_PASSWORD`, `ORIGINATION`, `SIMULATE`. It is a shared file —
   flagging rather than assuming.
