# 2026-07-31 — Adopting the "Sunlit greenhouse editorial" design system

## What changed

The dashboard was a glassmorphic dark UI (`#0b0f19` canvas, blurred translucent cards,
cyan/emerald/amber/rose/purple accents, drop shadows, emoji icons). `DESIGN.md` specifies the
opposite system, so the whole surface layer was rewritten against it.

- `src/app/globals.css` — replaced wholesale. All tokens from `DESIGN.md` (colors, type scale,
  spacing, radii, surfaces) declared as custom properties, then a component vocabulary built only
  from those tokens.
- `src/app/layout.tsx` — added the app shell (paper-white nav bar, footer) and loaded the two
  substitute typefaces via `next/font/google`.
- `src/components/dashboard/DashboardView.tsx` — new; holds the polling logic, hero, forest status
  card and step rail. `app/page.tsx` and `app/dashboard/page.tsx` were byte-identical 99-line
  duplicates; both now render this one component.
- `src/components/dashboard/status.ts` — new; single source for status label, tone and step index.
- The four cards (`ShiftCard`, `WorkerStatus`, `WorkflowTimeline`, `ProofPanel`) — restyled, inline
  `style` props removed, emoji replaced with stroke SVG icons.

## Design decisions

**Typefaces.** `DESIGN.md` names Grenette and Graphik, both commercial and unavailable. It lists
substitutes; I took the first of each: **Fraunces** for display, **Inter** for UI, wired through
`next/font` as `--font-display` / `--font-ui` and consumed via the `--font-grenette` /
`--font-graphik` aliases so the token names still match the spec.

**Status colors.** The old UI used five hues to distinguish workflow states. The system permits one
chromatic accent per viewport, so state is now carried by the surface stack instead of hue:
sage = idle, chartreuse = active, forest = done, black hairline outline = halted. Vivid Green is
used only for the live-poll dot, which the spec reserves for data-viz/decorative use.

**Card titles use the sans, not the serif.** The spec bans the serif below 36px, and 36px card
titles would out-shout the hero. Card titles are Graphik 22px/500; the serif appears only in the
hero display headline.

**Hero stat card.** The spec's hero pairs a display headline with a Forest Stat Card. Ours holds the
live status plus three counters (workers called, language on the call, verified side effects) — all
derived from real workflow state, nothing synthesized. Four separate forest cards would have made
the page top-heavy in dark, so it is one card.

**Step rail.** Added a five-step rail (`Manager command → Worker calls → Acceptance → VoiceOS
actions → Confirmation SMS`) driven by the same status mapping. `docs/plan.md` requires "current
workflow status" to be visible; the rail renders that as position in the sequence rather than as a
bare enum string. It is flat top-border segments — no chart library, no animation.

**No shadows, two radii.** Every `box-shadow` was dropped. Radii are 4px (buttons, inputs, tags) and
16px (cards) only, per the spec's explicit ban on intermediate values. Card definition against the
sage canvas comes from the paper-white surface plus a 10% ink hairline.

**Mono for proof IDs.** `DESIGN.md` defines no monospace family. IDs are evidence and must be
readable character-by-character, so `ui-monospace` is used for proof values and timeline
timestamps only.

## Assumptions

- `/` stays the homepage (per commit `8c35a89`); `/dashboard` is kept as an alias so existing links
  and the deployed URL keep working.
- The `state` object returned by `GET /api/status` is stable enough to read `workers.length` and
  `currentWorkerIndex` from for the counters; both fall back safely if absent.

## Verification

`npm run typecheck`, `npm test` (6 passed), `npm run build` all pass. The three workflow states
(idle, mid-call after a decline, complete with four proof IDs) were driven through the real API
routes and checked in a browser at 1440px and 390px.

## Not done

The repo's `origin` is `git@github.com:ali-amjad52114/ShiftRescue.git`. That owner is not on the
authorized push list, so the work is committed locally and left unpushed.
