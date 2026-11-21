---
status: accepted
---

# The user approves every send

The owner's ruling of 2026-11-21. It amends ADR 0004 ("Overture is fully automatic"), ADR 0012 (a new Status and
Stage) and the M1 gate in ADR 0019 and SPEC §2.

## Context

Overture was specified to submit on its own: the only thing a user was asked mid-pipeline was a Review. A wrong
send cannot be taken back, a real application uses the user's real name and email (ADR 0028), and in the testing
phase the owner wants to see each application before it goes. Every part of the pipeline before Submit (finding,
matching, preparing, answering, the cover letter) already produces a complete plan without a browser, so the plan can
be shown and approved before any browser session starts.

## Decision

**No Application is ever submitted without the user's explicit approval.** Overture finds, matches and prepares
every Application and plans every answer; the user approves; only then does a cloud browser fill and submit the
form. The product truth becomes: Overture *prepares every application and sends it when you approve*.

**The user approves the plan, not a filled browser form.** The approval card shows the job and employer, the exact
resume file (its revision), every answer as it will be typed, and the cover letter. Pressing Send freezes that plan:
the full send plan is stored with its SHA-256, and that frozen plan is what the browser later fills. At send time the
live-form check (preflight, #156) compares the live form with the *approved* plan, not a fresh one. Any difference
stops before Submit and returns the Application to the user:

- a new required factual question → a Review, then back to Ready;
- changed options, a new one-off required field or a removed field → back to Ready with what changed;
- a different employer or posting identity → skipped with its reason, as before (§10.3);
- a resume revision or a Fact used by the plan that changed since approval → back to Ready, found before a browser
  opens when it can be.

Overture never sends on a difference and never re-plans silently: anything that changes the plan clears the approval.
The reason for approving the plan: one browser session per Application. Holding a filled browser open until the user
clicks would bill for idle time, and filling it once for the user and again for the send would pay twice.

**Statuses.** `ready` keeps its name and now means "prepared, waiting for your approval" (UI: Ready). A new status
`approved` ("approved, waiting for its send slot") sits between `ready` and `sending`, and dispatch only ever picks
`approved`. Approval can be undone (back to `ready`) until `sending` starts. A `ready` or `approved` Application
whose Posting closes becomes `skipped` (`posting_closed`). A `ready` Application waits until its Posting closes or
the user skips it; it counts toward the free slots the next daily run may fill, so Overture never prepares more than
one day's worth while the user is away (see the amendment below). Skip on a Ready card withdraws the Application
(`withdrawn`), the same as withdrawing a queued card from the Board.

**The Ready destination.** A sixth destination, **Ready** (heading "Ready to send"), lists the approval cards with
Send, Skip and Edit an answer, and "Send all" for everything listed. The nav order is Home, Ready, Board, Review,
Inbox, Profile. The Board gets a **Ready** column between Queued and Applied (a new Stage `ready`, holding every
Application from Ready until it is confirmed sent), and Home a card ("3 ready to send").
None of it is built until it is drawn on the canvas (ADR 0021, `DESIGN.md` §13).

**Notifications.** In M1, at most one email per user per local day when that day's preparation run produced new
Ready Applications or Reviews, from `no-reply@tryoverture.com` through the Cloudflare sender, listing them with one
link to the Ready page (see the amendment below). Opening the link never sends, because mail scanners open links;
the user presses Send in the app. M2 adds push. There is no per-application email.

**Limits.** The daily cap counts sends, not approvals. Approval never bypasses pacing, the company cooldown, the
crowd limits or the caps; approved Applications are sent in approval order within the send window.

**Amendment of 2026-11-21: one daily preparation run.** Preparation stops trickling through the day. One run per
running user per local day, at the admin setting `prep.run_local_time` (default 07:00), matches, prepares and stops
at the free Ready slots: the daily cap minus the Applications already preparing, ready or approved (so a retried run
cannot overfill the day). The Ready list therefore never holds more than one day's work, and unapproved cards reduce
the next day's run instead of piling up. Lever and
Ashby forms are read in that run when their signature is not cached. The run ends with one Recap email listing the
new Ready Applications and the open Reviews ("10 ready to approve, 2 need an answer") with one link to Ready, and
sends nothing when it produced nothing. Sending is unchanged: only an Approval queues an Application, and sends stay
paced by `limits.send_spacing_minutes` inside 08:00–20:00, in approval order.

**The M1 exit gate** becomes: at least **25** real owner applications on Browser Use (was 60); at least 85 % of
attempted applications reach `sent`; cost at most $0.03 per completed application; zero wrong-company or duplicate
sends. *Attempted* and *cost* keep ADR 0026's definitions; an Application the user never approves is never
attempted. The testing phase keeps spend minimal.

## Consequences

- SPEC §1's promise "Fully automatic" becomes "You approve every send"; ADR 0004's "fully automatic" is read as
  "automatic up to approval". Users still never see a browser or solve a challenge.
- The form must be known before the card can be complete. Greenhouse questions come from its API. A Lever or Ashby
  form with no cached plan is read once during preparation by the same read-only path as fixture capture (no fill,
  no Submit), and the plan cache serves later postings with the same form signature. That read costs a short browser
  session per new form, never per send.
- Pre-submit failures that leave the plan unchanged (`interrupted`, a challenge, a code timeout, a provider error, a
  timeout or crash before Submit) keep the approval and go back to `approved` for their retry slot. `form_changed`
  now returns the Application to Ready instead of retrying on its own, and still counts toward
  `limits.max_attempts`, so a form that differs twice ends as Couldn't apply.
- Editing a factual answer on a card edits the Fact itself (a Fact is the only source of a factual answer, ADR
  0007), so every unsent Application that uses it is prepared again and loses its approval. Editing open text or the
  letter changes that Application only and is recorded in its Snapshot as the user's own words.
- The Snapshot records the approval time and the approved plan's hash; pressing Send is the per-application consent.
- `DESIGN.md`'s five destinations become six; Ready, the Board's Ready column and the Home card are boards still to
  draw.

## Considered Options

- **Approve the filled form in a live browser.** The user would see exactly what the employer gets, but the session
  bills while it waits for the user, or the form is filled twice; and showing a browser undoes ADR 0004.
- **A per-application email with one-click send by link.** Fastest for the user, but mail scanners and link
  previewers open links, so a GET that sends would send applications nobody approved; and one email per
  application is noise.
- **Keep full automation.** The original design. Rejected for now: the owner wants to see every application before
  it is sent while Overture is being proven.
- **Later, out of scope:** an opt-in "send without asking" switch per user, off by default and admin-gated. It is
  recorded as a considered option only; nothing is built for it.
