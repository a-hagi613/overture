---
status: accepted
---

# Durable onboarding picks, one tracked Application per pick

Implements issue #687 under the owner's 2026-11-26 direction (issue #678). It works with ADR 0018 (plans), ADR 0029
(the user approves every send) and ADR 0046 (dispatch timing, the account is switched on when onboarding ends).

## Context

The onboarding picks were held in `posting_user_state` as saved ids and the Application rows were only created after
the Stripe card check returned. Three things followed from that:

- A Posting that closed while the person was in Checkout had no employer or title left to prepare or show.
- A refresh, a second tab or a double return ran preparation again with only the client's ids to rely on, so exactly
  one Application per pick depended on timing rather than storage.
- The return path went back to onboarding to prepare and then to Ready, not to the Tracker the person expects.

## Decision

1. **Picks are written before Stripe, with a snapshot.** `onboarding_batches` holds one durable batch per account and
   `onboarding_picks` holds one row per chosen Posting with `companyName`, `postingTitle`, `postingUrl`, `applyUrl`
   and the display fields copied at pick time. The employer and title therefore survive a Posting that closes during
   Checkout, and a closed pick still gets one tracked Application in the Tracker.
2. **Storage is plan-agnostic.** A pick row stores no plan limit. `onboardingPickLimitFor` reads the batch's plan (the
   free trial 3, a paid plan the daily cap of 10) and the UI label is **Send all**, never a count.
3. **Every return settles the same batch.** `POST /api/onboarding/settle` verifies a supplied Setup session, prepares
   the stored picks, switches the account on and returns one outcome per pick. Preparation reuses an existing
   Application for a pick and `applications_user_posting_unique` keeps it to one row, so a refresh, two tabs, a double
   return or a repeated webhook can only create one Application per pick and at most one trial grant.
4. **Outcomes stay distinct.** `prepared`, `pending` (a delayed or unfinished webhook; the picks stay), `cancelled`
   (nothing charged; the picks stay), `already_trialed`, `already_used`, `card_not_verified` and a failed pick with its
   reason are separate results. A pending or failed settle never clears the picks.
5. **A clean return lands on `/tracker`.** The Setup success URL points at `/tracker?card=verified&session=…`; the
   Tracker settles it, clears the parameters and shows each pick's live status (Preparing, Needs your answer, Ready to
   send, Sending, Applied). A paid Checkout returns to `/tracker?billing=success`. It never returns to onboarding.
6. **Send all uses the same approval as Ready.** `POST /api/ready/send-all` approves every ready Application whose
   plan is all the user's own answers, holds plans with newly drafted prose for individual review, and leaves the send
   timing to ADR 0046 (the trial's three at once, paid sends five minutes apart).
7. **The save boundary keeps one pick per employer.** A batch can hold several postings from one employer, so
   `PUT /api/onboarding/matches` groups them by the job's canonical employer key (`company_slug`, falling back to the
   normalised company name; the same `company_key` match ordering stores), keeps the best posting under the ADR 0045
   order and drops the rest. A posting whose employer already has an open Application is dropped unless that posting
   is the Application itself. The saved picks view reports `droppedPicks`, and the matches screen follows the saved
   selection so it never claims more picks than the Tracker will hold (issue #759).

## Consequences

- The Tracker, Ready and Home read the same Applications; the picks table is the durable request, not a second source
  of display truth.
- A Posting that closes during Checkout leaves a Closed entry with the snapshot rather than a missing pick.
- The client can no longer create an Application by sending ids alone: `PUT /api/onboarding/matches` snapshots, and
  `POST /api/onboarding/settle` prepares.
- The plan choice from #709 only has to set `onboarding_batches.plan_kind` and change the limit and the screen copy.

## Considered Options

- **Keep saved ids and create Applications after Stripe.** Rejected: a Posting that closes during Checkout leaves no
  employer or title, and idempotency depends on the client.
- **Store the picks in the client (localStorage).** Rejected: a refresh or a second tab loses them, and the server can
  never guarantee one Application per pick.
- **Return to onboarding and redirect after preparing.** Rejected: the owner's direction is the Tracker, and an
  onboarding flash makes a finished purchase look unfinished.
