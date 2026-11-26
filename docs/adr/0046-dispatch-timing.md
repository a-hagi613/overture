---
status: accepted
---

# Dispatch timing

The 2026-11-26 rebuild (Epic #678, written down by #679; implemented by #681). It amends ADR 0010 (fixed pacing
limits), ADR 0029 (the user approves every send) and ADR 0018 (plans).

## Context

The local end-to-end run of 2026-11-26 found three self-imposed limits that blocked the product rather than protecting
anyone:

- **An approved send was booked hours out.** One application was scheduled 133 minutes after approval because the
  planner only placed sends inside an 08:00–20:00 window and spaced them 20 minutes apart.
- **A new account stayed paused.** `profiles.running` stayed false after onboarding finished, so the dispatcher
  rejected every send with `paused`, and there was no obvious control to start it.
- **The trial's three applications waited for no reason.** They are the thing the person just chose, and they run once
  per card.

The limits worth keeping protect users and employers: the daily cap, the company cooldown, the repost guard, the crowd
limits, the per-ATS hourly cap and the confirmation wait.

## Decision

1. **No send window.** An approved Application is eligible the moment it is approved. The planner assigns
   `scheduled_for` in approval order and never books a send into a future window; nothing waits for 08:00.
2. **5 minutes between one user's paid sends.** `limits.send_spacing_minutes` is 5, per user, and only paid sends
   count. Another user's spacing never delays anyone, so two people approving at once both go.
3. **The free trial's three are exempt.** The three picks may go **at once, in parallel**, one browser session each.
4. **Daily cap 10**, counted in sends, not approvals, resetting at the user's local midnight. A paid user's onboarding
   picks are capped at 10 for the same reason.
5. **Browser concurrency is uncapped.** `browser.max_concurrent_sessions` is 0 (no cap): the provider and the box bound
   it, and a 429 from Browser Use is retried with backoff without spending an attempt. An earlier testing-phase value
   of 1 is deleted.
6. **The account is switched on when onboarding ends.** Finishing the plan step (trial card check or Checkout) sets
   `profiles.running = 1` and clears the `onboarding` reason, so the approval the person just gave is dispatchable.
   The no-card finish does the same.
7. **Approval still never bypasses** the company cooldown, the repost guard, the crowd limits, the per-ATS cap, the
   one-in-flight rule or the frozen-plan check (§8.7, §9.3).
8. **A retry's earliest time is a lower bound**, as before: the planner gives it the first free slot at or after that
   time.

## Consequences

- Send timing is one rule per user, not a global schedule, so the planner is simpler: a slot is "now, or 5 minutes
  after this user's previous paid send".
- The Tracker shows "Queued · sends at <time>" only when a paid slot is actually booked, and "Queued · next in line"
  otherwise.
- Removing the window means a person who approves at 23:00 gets their application sent at 23:00; that is the owner's
  decision and the employer-facing pacing is unchanged (daily cap, cooldown, crowd limits).
- The trial's parallel sends are three browser sessions at once; the provider's 429 path covers a burst.

## Considered Options

- **Keep a day window but shorter.** Rejected: it still books a send hours out, which the person reads as broken.
- **20 minutes between all sends.** Rejected: it protects nobody and halves a paid user's useful day.
- **Spacing across users (one global queue).** Rejected: one user's picks must never delay another's.
- **A trial that also spaces its three.** Rejected: the trial is the onboarding payoff and is once per card.
