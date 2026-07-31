# testing/

Tooling and tests for the voice agent. Nothing in here ships with the app or is
imported by `src/`.

```
testing/latency/
  timeline.ts      turn-latency model, percentiles, budgets, report formatting
  profiles.ts      per-provider latency estimates and the named stacks
  mockPipeline.ts  seeded simulation of a call, turn by turn
  probe.ts         times the real /api/vapi-result over HTTP
  vapiReport.ts    pulls a call you actually made and extracts real latencies
  fixtures.ts      realistic Vapi webhook payloads
  cli.ts           entry point
  __tests__/       unit tests + regression guards on the shipped config

testing/calls/__tests__/
  shiftData.test.ts        what the assistant is actually told about the shift
  payNegotiation.test.ts   the pay ceiling, and clamping what the model claims
  callLog.test.ts          the call log, including that it never breaks a call
  conversationFlow.test.ts noise handling and stopping early on a yes
```

## Commands

```bash
npm run profile                       # help
npm run profile simulate current      # stage breakdown of one call
npm run profile compare current tuned # price a change
npm run profile bargein               # interruption cost per stack
npm run profile probe                 # time the real tool webhook (dev server)
npm run profile report <callId>       # real latencies from a call you made
```

`report` needs `VAPI_API_KEY`. `probe` defaults to
`http://localhost:3000/api/vapi-result`; pass a URL to hit the deployment.

## What a "turn" means

Everything is measured over one window: **the worker stops speaking → the first
byte of the assistant's audio reaches the phone.** That window is broken into
six stages, each with a budget (`STAGE_BUDGET_MS` in `timeline.ts`):

| stage | budget | what it is |
| --- | --- | --- |
| endpointing | 300ms | deciding the worker has finished (`startSpeakingPlan.waitSeconds`) |
| stt | 150ms | final transcript |
| llmTtft | 450ms | model's first token |
| toolRoundTrip | 250ms | our webhook, on turns that fire a decision tool |
| ttsTtfb | 200ms | voice provider's first audio byte |
| transport | 120ms | SIP/PSTN out to the handset |

Under 900ms total feels immediate, under 1300ms is tolerable, above that the
worker starts saying "hello?".

Barge-in is tracked separately, because a call that talks over people does not
feel slow — it feels like it is not listening. Budget: 300ms of assistant audio
after the worker starts speaking.

## Honesty about the numbers

`profiles.ts` holds **estimates**, not measurements from this account. They are
seeded so `simulate` and `compare` produce something useful on day one, and they
are all in one file so they can be corrected.

`report <callId>` is the ground truth. Run it against a call you made, then
update `profiles.ts` to match. A real transcript only exposes the total gap per
turn, not the stage split — so use `report` for the truth and `simulate` for
where the truth is going.

`probe` measures the one stage the model cannot honestly estimate: our own
webhook, whose latency depends on the region, Redis, and what the handler does
before replying.

## What was found and changed

Running `compare current tuned` on the config as it was:

```
stage                              current       tuned             delta
--------------------------------------------------------------------------
endpointing (worker stopped?)        407ms       237ms     -170ms (-42%)
llm time-to-first-token              605ms       332ms     -273ms (-45%)
tool server round trip               865ms       325ms     -540ms (-62%)
--------------------------------------------------------------------------
plain reply, end to end             1983ms      1500ms     -483ms (-24%)
reply after a decision tool         2832ms      1798ms    -1034ms (-37%)

barge-in talk-over: 1020ms -> 390ms
```

Shipped in `src/`:

1. **`stopSpeakingPlan.numWords: 1` → `0`.** Above zero, Vapi waits for the
   transcriber to emit that many words before cutting the audio. On
   `gpt-4o-transcribe` that is ~780ms of talking over the worker. Voice-activity
   stopping does it in ~150ms. `backoffSeconds` 1 → 0.6, and
   `firstMessageInterruptionsEnabled` so someone can cut into the greeting.
2. **The next dial moved off the tool-response path.** Vapi keeps the assistant
   silent until `/api/vapi-result` replies. On a decline the handler was doing a
   Redis read, a full `POST /call/phone` to Vapi, and a Redis write before
   answering — dead air in the middle of a live conversation. The decision is
   now committed and answered immediately; the dial runs behind Next's `after()`.
   `handleVapiResult` still dials inline when no `defer` is passed, so the demo
   controls and existing tests are unchanged.
3. **`startSpeakingPlan.waitSeconds` 0.4 → 0.2** (env: `VAPI_START_WAIT_SECONDS`).
4. **`getWorkflowState()` reads the roster and the run state concurrently**
   instead of serially — one Redis round trip off the webhook path.
5. **Transcriber and voice provider are now env-configurable**
   (`VAPI_TRANSCRIBER_PROVIDER`, `VAPI_TRANSCRIBER_MODEL`, `VAPI_VOICE_PROVIDER`)
   so a swap can be A/B'd against `report` without a code change.

## Not changed, deliberately

- **Model stays `gpt-4o`.** `gpt-4o-mini` models ~270ms faster to first token
  and the call is a scripted decision tree, but the prompt leans hard on
  never-invent rules across four languages and that is a quality call to make
  against real transcripts, not a latency call. Flip it with
  `VAPI_OPENAI_MODEL=gpt-4o-mini` and compare.
- **Voice stays OpenAI `alloy`.** It is the single largest fixed cost (~480ms
  TTFB) and Cartesia or ElevenLabs Flash would take ~370ms off — but neither
  covers Punjabi, so they cannot call the whole roster. `npm run profile compare
  tuned azure` prices the realistic swap: Azure covers `ur-PK` and `pa-IN` and
  is roughly half the latency of OpenAI on both STT and TTS. Worth trying next,
  with a listen test on Urdu and Punjabi before it ships.
- **The barge-in budget is not met**, even tuned: ~390ms against a 300ms target.
  The remainder is media transport, which no config change removes. The test in
  `mockPipeline.test.ts` asserts this rather than moving the budget to make the
  report green.

## Noisy lines, and stopping early on a yes

Two conversation problems, both fixed in config plus prompt.

**The assistant could not hear the worker over background conversation.** Two
causes, and fixing one without the other makes the call worse:

- `startSpeakingPlan.waitSeconds` endpoints on *silence*. In a room where
  someone else is talking the line is never silent, so the assistant hears
  speech forever and never decides the worker has finished. Added
  `transcriptionEndpointingPlan`, which endpoints on what was actually
  transcribed. It is language-agnostic, unlike Vapi's smart-endpointing models,
  which matters when half these calls are not in English.
- `backgroundDenoisingEnabled: true` strips background *voices*, not just hiss,
  before the transcriber hears them. This is also what makes voice-activity
  barge-in (`numWords: 0`) survivable at all on a live line.

There is a real trade here and no setting wins both ways: `numWords: 0` gives
the fast barge-in the latency work was after, but on a noisy line background
chatter also stops the assistant mid-sentence. `VAPI_NOISY_ENVIRONMENT=true`
flips the pair together — `numWords: 2`, longer `voiceSeconds`, longer
no-punctuation wait.

It is an expensive switch. `npm run profile bargein`:

```
barge-in (tuned)          worker talked over for   390ms
barge-in (noisy venue)    worker talked over for  1370ms
```

That is worse than the config we started from, because waiting for two
transcribed words costs two words of speaking time on top of the interim
transcript. So: try denoising on its own first, and only reach for the switch if
a real call still shows the assistant failing to hear the worker. If you do turn
it on, `npm run profile report <callId>` will show the talk-over count climbing
in exchange.

**The assistant kept reading the script after the worker said yes.** The prompt
was a rigid six-step list ending in a full read-back of role, date, both times
and location — to someone who had already accepted. Rewritten to three beats
(greet → shift → decision) with an explicit `STOP AS SOON AS YOU HAVE A YES`
rule, a one-line confirmation instead of a recap, and a one-sentence close. The
tool result in `webhook.ts` now orders an immediate `endCall`, which matters
because Vapi feeds it back as the last thing the model reads before closing.

Verify it on a real call: `npm run profile report <callId>` now prints

```
  conversation shape
    decision after 3 assistant turns, 12s in
    hung up 4.1s after the decision
```

`turnsToDecision` above 4 means it kept talking after it had an answer.
`secondsFromDecisionToHangup` above 6 means the closing prompt or
`silenceTimeoutSeconds` is still holding the line open.

## Two bugs found on the schedule → assistant path

Both only affected a rescue started from the calendar's "find cover" button. A
run started by a manager command went down a different code path and worked,
which is why they survived testing.

1. **`startCoverage()` never dialled.** It set the status to `CALLING_WORKER`,
   wrote "Calling Maria in Spanish" to the timeline, and returned. Nobody's
   phone rang. It now calls `dialActiveWorker()`, behind `after()` so the button
   still returns immediately.
2. **The spoken date and times were dropped.** `toWorkflowShift()` copied only
   the ISO instants, and `dialCurrentWorker()` passed the missing strings
   through as `""`. The worker would have heard "we have a Kitchen Assistant
   shift on ,  to ,  at Downtown San Francisco". Both now go through
   `spokenShiftWindow()`, and a test asserts the greeting never contains an
   empty field.

## Other things worth knowing

- **`/api/vapi-result` is unauthenticated.** Anything that can guess a
  `workerId` and `attemptId` can post a decision. The attempt guard makes that
  hard, not impossible. Vapi can sign webhooks with a shared secret
  (`server.secret` + `X-Vapi-Secret`); this is not wired up.
- **`monitorCallAttempt` polls every 3s for up to 90s per call** in an
  unawaited promise. On Vercel that promise is killed when the response is sent,
  so on serverless the end-of-call webhook is doing all the real work. It is
  harmless but it is not the safety net the comment implies.
- **`syncScheduleAssignment()`** in `src/lib/workflow/coverage.ts` is exported
  and never called. An accepted rescue does not currently mark the shift covered
  on the calendar.
- **The end-of-call hangup delay** was `silenceTimeoutSeconds: 20`, now 10 via
  `VAPI_SILENCE_TIMEOUT_SECONDS`. That is the timer that keeps a finished call
  open when neither side says anything.
