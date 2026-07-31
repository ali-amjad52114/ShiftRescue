# a1mobile integration (Person 1)

Public surface, unchanged from the original stubs so `src/lib/workflow/` needs no edits:

```ts
startA1MobileCall({ workerId, phone, language, shiftId }) // -> { success, callId?, mode?, error? }
sendA1MobileSms({ phone, message })                       // -> { success, messageId?, status?, error? }
```

`SIMULATE=true` makes both return fake IDs without touching the network, so the
backend and dashboard can be developed without burning real calls.

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
