# Demo QA guide

How to test ShiftRescue by hand, and what each scenario is *supposed* to do.

The governing rule, from `docs/hackathon-pitch.md`: **a fabricated success is an
automatic critical flag.** So for every scenario below, the question is not only
"did it work" but "when it didn't work, did the screen say so". A step that reads
**done** without a side effect behind it is a bug, and a worse one than a crash.

---

## 0. Before you touch anything

### Set up

| Where | What |
|---|---|
| Vercel env | `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `APP_PASSWORD`, `APP_SESSION_SECRET`, `PUBLIC_BASE_URL`, `VAPI_*`, `A1MOBILE_*`, `DEMO_WORKER_1..3_PHONE`, `SIMULATE=false`, `ORIGINATION=outbound` |
| a1mobile | All three demo numbers OTP-verified. Cold outreach is not permitted — see `docs/A1MOBILE-TELEPHONY.md` |
| Phones | All three physically present, unlocked, ringer on |

### Check

1. Open `/login` and sign in. Defaults are **`admin` / `admin123`**; override with
   `APP_USERNAME` / `APP_PASSWORD`. **A session is required even locally** — every
   action route returns 401 without the cookie, so nothing on `/` will work until
   you have signed in.
2. Go to `/admin`. The **Deployment readiness** card must say **Ready**.
   Anything showing `Fix` explains its own consequence — fix it before continuing.
3. Click **Register webhook with Vapi**. It should report the URL it registered.

**Do not skip step 3.** It is what makes Vapi send the end-of-call report. Without
it, on Vercel there is no process left alive after the response to notice that a
worker never picked up — and scenario S2 hangs forever instead of moving on.

4. Click **Reset the current rescue** for a clean slate. This also hands back the
   shift a previous run covered, so there is a gap to rescue again.

---

## 1. The screens

| Route | Purpose | Signed out |
|---|---|---|
| `/` | The product. Week calendar, coverage counts, live call banner, receipts. | Read-only, no buttons |
| `/team` | Staff directory — the only place phone numbers are returned. | Redirects to `/login` |
| `/admin` | Operator console. Readiness, rescue state, manual overrides, reset. | Redirects to `/login` |

Both `/` and `/admin` poll (2s and 1.5s). Nothing needs refreshing by hand.

---

## 2. Scenarios

### S1 — Happy path: decline, then accept

The demo. Run it end to end at least once before showing anyone.

| Step | Do | Expect |
|---|---|---|
| 1 | Open `/` | A hatched **Unfilled** block, and an attention banner naming it. Counts read e.g. `19 shifts · 18 covered · 1 unfilled` |
| 2 | Click **Find coverage** | Block turns *filling*. Live banner: **Calling Maria Alvarez** *speaking Spanish*. **Worker 1's phone rings.** |
| 3 | Answer as Maria, decline | Timeline: `Maria Alvarez declined shift` → `Calling Ahmed Khan in Urdu`. Worker 2's phone rings within ~2s |
| 4 | Answer as Ahmed, let the assistant read the shift back, then accept | Timeline: `Ahmed Khan accepted shift!` → `Schedule updated…` → `Confirmation SMS sent via a1mobile. Rescue complete!` |
| 5 | Look at `/` | **The block is now covered and says "Ahmed Khan."** Unfilled count drops to 0 |
| 6 | Look at Ahmed's phone | **A real SMS arrives, in Urdu** |
| 7 | Click the covered block | *What happened* lists **Confirmation text sent** with a real a1mobile id |
| 8 | If VoiceOS ran | Calendar / Slack / Gmail / Sheets rows appear too, and `/admin` rail shows `04 · done` |

**If step 2 does not ring a phone**, the wiring regressed — that is the exact bug
this build fixed. Check `/admin` proof for a `callId`; if the timeline says
"Calling…" but no call id exists, no call was placed.

**If VoiceOS is not running**, steps 1, 2, 3 and 5 of the rail are `done` and step
4 (VoiceOS actions) stays **not run**. That is correct. It must never read `done`.

---

### S2 — Nobody answers

Let all three calls ring out to voicemail.

- Each produces `X did not answer; trying the next worker`.
- After the third: status **Rescue incomplete**, the block returns to **Unfilled**.
- Rail: `03 · failed`, `04 · not run`, `05 · not run`.
- **No SMS is sent. No proof id appears.**

This is the scenario that silently hangs if you skipped **Register webhook with
Vapi**. If the run sits on `CALLING_WORKER` for more than ~40s after the last
phone stops ringing, that is the cause.

---

### S3 — Ambiguous answer

Answer and say *"maybe"*, *"let me check"*, or *"call me back"*.

- The assistant must **not** treat this as acceptance.
- Expect `needs_clarification` → `X could not confirm availability; trying the next worker`.
- The queue moves on exactly as it does for a decline.

Silence must behave the same way. `prompt.md` states this explicitly:
*"'Maybe', 'I will check', 'call me back', and silence are not acceptances."*

---

### S4 — Planted friction (what judges will actually do)

Ask the assistant something outside the shift details: a lift there, whether
there's overtime, benefits, or a higher rate.

- It must decline to invent, and steer back to a yes or no.
- Check the Vapi transcript afterwards. **Any invented fact is a scoring failure**,
  even if the workflow completed perfectly.

Also try interrupting mid-sentence — barge-in is configured
(`stopSpeakingPlan.numWords: 1`) and it should stop talking and listen.

---

### S5 — Two rescues at once

With a rescue live, click **Find coverage** on a different shift.

- Expect the button to read **Busy**, and a notice:
  *"A rescue is already running for another shift."*
- The run in flight is untouched — confirm the live banner still names the original
  shift.

The engine holds one run at a time on purpose. A second run would silently replace
the first mid-call.

---

### S6 — Duplicate or spoofed decision

```bash
curl -X POST $BASE/api/vapi-result -H 'content-type: application/json' \
  -d '{"workerId":"emp_maria","attemptId":"att_forged","decision":"accepted"}'
```

- Expect **400**, `"Decision does not match the active call attempt"`.
- The queue must not advance. Vapi genuinely does deliver duplicates, and a
  double-advance would skip a worker live on stage.

`attemptId` is minted server-side and stripped from `/api/status`, so it cannot be
guessed from anything public. That is also why the operator override at
`/admin` is a separate signed-in route rather than a payload you can post.

---

### S7 — VoiceOS reports partial success

```bash
curl -X POST $BASE/api/voiceos-result -H 'content-type: application/json' \
  -d '{"success":true,"scheduleUpdated":true,"calendarEventId":"cal_1",
       "slackMessageId":"","gmailMessageId":"g","spreadsheetId":"s",
       "spreadsheetUpdateRange":"r"}'
```

- Expect **400**. No proof is recorded at all — not even the ids that were present.
- The same call with **no accepted shift** is also refused: proof cannot be
  injected onto an empty run.

Try **VoiceOS failed** in the console too: the acceptance and the SMS survive
(they really happened), the rail marks the VoiceOS step **failed**, and the
receipts panel says the mirrored updates do not exist.

---

### S8 — The SMS fails

Hard to force deliberately; if it happens:

- The run stops at **Confirmation SMS not sent**.
- **No `smsMessageId` is invented.** Rail marks step `05 · failed`, not step 4.
- The shift stays covered and the timeline says the send failed — because the
  acceptance was real even though the text was not delivered.

---

### S9 — Auth and privacy boundary

Signed out, in a private window:

- `/` renders read-only — no **Find coverage**, no **Add shift**.
- `/team` and `/admin` redirect to `/login`.
- `GET /api/employees` → **401**.
- `POST /api/reset` → **401**. Nobody can wipe your run mid-judging.

Then confirm no phone number leaks:

```bash
curl -s $BASE/api/status   | grep -c '+1'   # expect 0
curl -s $BASE/api/schedule | grep -c '+1'   # expect 0
```

---

### S10 — Multi-instance state

Mid-run, hard-refresh and open a second browser.

- Both must show the same run at the same step.
- If state resets or flickers to "waiting", `KV_REST_API_*` is missing on Vercel
  and the webhook and the browser are talking to different instances.

---

### S11 — Simulated run (rehearsal without burning calls)

Set `SIMULATE=true` and redeploy to rehearse the flow with no telephony. Drive
decisions from `/admin` → **Record a decision by hand**.

- Every id comes back as `sim-…`, struck through and labelled
  **SIMULATED · NOT PROOF**, with a warning under the panel.
- Preflight reports **1 to fix**: *"SIMULATE is off — sim- ids are not sponsor proof."*

**Never demo in this mode.** The labelling exists so a rehearsal screenshot can
never be mistaken for a real run.

---

## 3. Pre-demo checklist

- [ ] `/admin` readiness card reads **Ready**
- [ ] **Register webhook with Vapi** clicked *against this deployment*
- [ ] All three phones OTP-verified, present, ringer on
- [ ] S1 rehearsed end to end on the deployed URL
- [ ] **Reset the current rescue** immediately before presenting
- [ ] `/` open on the projector, an **Unfilled** block visible

## 4. If it goes wrong live

| Symptom | Cause | Do |
|---|---|---|
| "Calling…" but no phone rings | Vapi credentials or SIP trunk | `/admin` → readiness. No `callId` means no call was placed |
| Call connects, decision never registers | Webhook URL not registered | `/admin` → **Record a decision by hand** |
| Stuck on `CALLING_WORKER` after the call ended | End-of-call report not reaching us | Same manual override; re-register the webhook afterwards |
| Everything 500s | Redis missing on Vercel | Nothing to do live — this is a deploy-time fix |
| Wrong worker named | Roster order in `/team` | Reorder before demoing, not during |

The manual override exists precisely so a webhook failure does not end the demo.
It records the same decision through the same reducer — it does not fake a call
that never happened, and the proof panel still only shows what actually returned.
