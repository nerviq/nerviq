# Day-30 gate — measurement adjustment, recorded 2026-07-29

Written **before** the measurement window closes and before any number is
read, so it cannot be mistaken for post-hoc lawyering. It applies a rule the
sprint plan already contains; it does not invent one.

## What happened

`@nerviq/cli@1.32.0` was published on **2026-07-29 at 13:30:30Z** — day 1 of
the gate's measurement window (Jul 29 – Aug 04, `docs/SPRINT_30D_2026-07.md`
§Gate).

## Why it matters

The plan's own cross-check list says:

> publish-day exclusion (ignore the 48h after any publish — mirror refetch
> spike)

A publish triggers registry mirrors to refetch every version. That spike is
supply-side noise, indistinguishable from demand in the raw weekly number,
and it now lands inside the window the gate reads.

## The adjustment

**Gate #1 (≥150 real weekly downloads) is measured on 2026-07-31 → 2026-08-04
(5 days), not the full 7.**

- Exclude 2026-07-29 and 2026-07-30 (the 48h post-publish window).
- The noise floor stays as frozen in `baseline.json`: **N = 87.25/week**.
- Prorate the floor to the shortened window: `N₅ = 87.25 × 5/7 = 62.3`.
- **Gate #1 passes iff `W₅ − 62.3 ≥ 150 × 5/7 = 107.1`.**

Prorating both sides keeps the bar identical in per-day terms. It does not
lower it.

## Publish budget

The plan capped sprint publishes at 2 (v1.31 + one more) to keep mirror noise
flat. **v1.32.0 is the second and last.** No further publish before 2026-08-04
without invalidating this measurement — including patch releases.

## What is unchanged

- Gate #2 (≥50 GitHub stars) — unaffected by publishing.
- Gate #3 (≥1 genuine inbound lead) — unaffected by publishing.
- The thresholds themselves, the anti-gaming clauses, and the
  no-third-option rule.

## Honest note on cause

The v1.32.0 release was worth shipping on its merits — it repaired 29 broken
source URLs that were actively misleading anyone who clicked "source" on a
check. But it was released *into* the measurement window, which is a
sequencing mistake: the plan's own rules made this foreseeable and nobody
checked the calendar before pressing publish. Recorded here rather than
argued away later.
