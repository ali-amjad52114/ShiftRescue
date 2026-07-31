# 2026-07-31 — HCI review of the dashboard

Screenshot-driven review of every workflow state (idle, calling, complete, all-declined)
at 1440×900 and 390×844. Findings below are ordered by severity.

## 1. CRITICAL — the failure state claimed work that never happened

With all three workers declined, the rescue sequence rail rendered:

```
01 DONE · 02 DONE · 03 DONE · 04 DONE · 05 ACTIVE
```

Acceptance, the VoiceOS actions and the confirmation SMS had never run. The rail was
driven by a single `step` index, so every step below the current index rendered as
"done" — and `INCOMPLETE` was mapped to `step: 4`, marking four un-run steps complete.

This is the exact failure mode the hackathon scores hardest: *"a fabricated success is an
automatic critical flag ... if your agent says 'all booked!' and nothing happened on our
end, it can't place."* The dashboard was making that claim visually.

**Fix.** Replaced the single index with `railStates(status, hasAcceptance)`, which returns
a per-step state and never marks an un-run step done. A failed run now shows
`03 FAILED · 04 NOT RUN · 05 NOT RUN`. `hasAcceptance` (derived from
`shift.assignedWorkerId`) distinguishes the two failure shapes: everyone declined
(acceptance failed) versus VoiceOS failing after someone accepted (step 4 failed).
"Pending" is labelled **NOT RUN** — factual, where "pending" implied still-coming.

## 2. Failure was indistinguishable from success

"Rescue incomplete" sat in the same calm forest card as "Rescue complete", with the same
green status tag. A judge glancing at the screen could not tell the run had failed.

**Fix.** The status card switches to Ink Black (already in the palette — no invented error
hue) and carries an explicit sentence: *"No worker accepted. The shift is still uncovered
and nothing was scheduled."* The failed rail step gets a 4px ink top border, and the card
status tag goes solid black.

## 3. Destructive action was the most prominent control on the page

"Reset demo" — which wipes a live run's timeline and every proof ID — was the single
chartreuse filled button, the highest-affordance element on the page, one click, no
confirmation. During live judging an accidental click destroys the evidence.

**Fix.** Demoted to a ghost button and made two-step. The accent now appears only on the
confirm ("Yes, wipe this run"), where destroying state is the intended action, alongside
Cancel, an Escape handler, and a note saying what will be lost.

## 4. Timeline grew unbounded and drifted

A completed run logs 9–11 events, stretching the card and pushing the newest event —
the one that matters live — further down the page.

**Fix.** Capped at 340px with auto-scroll to the newest event, plus an event count. The
list only auto-scrolls when the viewer is already at the bottom; if they scrolled up to
read an earlier step, new events do not yank the view away.

## 5. Stale data looked live

If polling failed, the card kept showing the last good numbers under a calm green "Live"
badge.

**Fix.** The pill flips to black "Reconnecting" so frozen numbers are not read as current.

## 6. Copy that misdescribed state

- "Worker on the line" stayed after the call ended; now "Last worker called" unless a
  call is active.
- Call state showed "Idle" after every worker declined; now "Declined".
- "Language on the call" persisted with no call in progress; now the state-neutral
  "Call language".

## 7. Proof IDs broke mid-string on mobile

`cal_9f2b7a41` wrapped as `cal_9f2b7a4` / `1` at 390px — these IDs are the evidence a
judge reads. Proof rows now stack key-above-value below 560px, and `word-break:
break-all` became `overflow-wrap: anywhere`.

## Verified

`typecheck`, `test` (6 passed), `build` all pass. Failure, success, confirm-reset,
keyboard focus and mobile states were each re-screenshotted after the fixes.

## Not changed

Kept the two-column card grid, the hero, and the sage/forest/chartreuse system from
`DESIGN.md`. The redundancy between the hero status card and the shift card's status tag
was left alone — on a live dashboard, repeating status near the record it describes is
useful, not noise.
