# Overture

A job-search agent that finds jobs for one person, prepares every application and sends it when you approve, and
shows its work. These are the words for what it does, used exactly in code, copy, issues and commits.

## The search

**Posting**:
A job opening an employer publishes on an ATS, found through freehire and stored once in the shared `jobs` table.
_Avoid_: job, listing, role (as the object)

**Match score**:
A 0–100 fit between a Posting and the user's resume and targets, with two or three short reasons. Bands are Strong
85–100, Good 70–84 and Possible 50–69; a score under 50, or any blocker, hides the job.
_Avoid_: rating, fit score, ranking points

**Strong match**:
A Posting whose Match score is 85 or above.

**Targets**:
What the user wants: roles (freehire job categories plus optional title words), places (freehire place ids) and
employers to exclude. Roles and places are the only hard filters; nothing else is saved as a preference.
_Avoid_: preferences, filters

**Fresh-jobs pull**:
A freehire search that brings in jobs opened since the last pull. Every user gets one when onboarding ends and when
roles or places change; Weekly and Monthly users also get one every three hours, scored in Batch. The free trial gets
no repeating pull.
_Avoid_: sync, scrape, refresh

## Signing in

**Verified email**:
The address a user proved they own by opening the single-use link Overture mailed them. No Application is prepared
or sent for an unverified address, and an invite, when one exists, is accepted on the first verified sign-in.
_Avoid_: confirmed address, validated account

**Public sign-up**:
Any email address can create an account by any enabled method (magic link, Google or LinkedIn), with no invite.
Turnstile and the per-IP limits still apply, and the account does no paid work until it has Applications from a
verified trial card, a plan, or an admin grant.
_Avoid_: open registration, self-serve join

**Demo account**:
The `role = demo` account (`test@email.com`) that the owner opens from the sign-in page with one click to see
Overture as a long-time user would. It is seeded with fictional data, receives no mail, sends no Application, makes
no ATS or Browser Use call and is left out of admin counts.
_Avoid_: sample account, test user, guest login

## Applying

**Application**:
One effort to apply to one Posting on the user's behalf, from preparation to the employer's final answer.
_Avoid_: submission, job (as the object)

**Status**:
Where an Application stands inside Overture: preparing, needs review, ready, approved, sending, confirming, sent, couldn't apply, skipped or withdrawn.
_Avoid_: state, progress

**Ready**:
An Application Overture has fully prepared that waits for the user's Approval before anything is sent. Also the
destination that lists them ("Ready to send") and the Tracker's Queue lane while they wait.
_Avoid_: pending, draft, awaiting approval

**Approval**:
The user pressing Send on a Ready Application. It freezes the exact job, resume file, answers and letter that will be
sent, and is the user's consent for that one application. It can be undone until sending starts, and anything that
changes its plan (a Fact or resume it used, an answered Review) returns it to Ready with what changed.
_Avoid_: confirmation, sign-off, go-ahead, auto-apply (nothing is sent without one, ADR 0029)

**Approved**:
The Status after Approval and before sending: the Application waits for its slot under the five-minute paid spacing
and the daily cap.
_Avoid_: scheduled, queued

**Skip**:
The user withdrawing a Ready or Approved Application instead of sending it. It is the ordinary withdrawal that leaves
the Tracker and never adds the company to the excluded-employer list.
_Avoid_: reject, dismiss

**Confirming**:
The Status after the employer may have received the Application and before its confirmation was seen. Shown as "Checking with the employer".

**Dry submit**:
A local-only send run (`OVERTURE_DRY_SUBMIT=1`) that fills a real form, keeps the pre-Submit screenshot and stops
before the Submit click, leaving the Application Ready with its credit returned. Refused in production (ADR 0049).

**Couldn't apply**:
An Application that was not sent, or whose sending could not be confirmed (surfaced concisely as **Not sent** on Home). It never uses one of the user's applications.
_Avoid_: failed (in copy), error

**Applications left**:
How many more Applications the user's plan allows; one is used only when an Application is confirmed sent.
_Avoid_: credit, allowance, quota

**Snapshot**:
The permanent record of exactly what one sent Application said: answers with their sources, the letter, the resume file and the consent.
_Avoid_: receipt, log

## The Tracker

**Stage**:
Where an Application stands with the employer: Queued, Ready, Applied, Screening, Interviewing, Offer, Closed. The
Stage is what is stored and what a move writes; the Tracker groups the seven into three lanes.
_Avoid_: column, phase, Hold

**Tracker lane**:
One of the three columns the Tracker shows (ADR 0037): **Queue** (Queued and Ready), **Applied**, and **Interviews**
(Screening, Interviewing and Offer). Closed, Cancelled and Not sent sit behind a filter, not in a column. A lane is a
view: moving a card writes one Stage, and only after the server accepts the move.
_Avoid_: Board lane, On hold, Hold, column (as the object)

**Queued**:
The first Stage: the Application is being prepared or waiting on a Review.
_Avoid_: Hold, pending

**Check-in**:
A one-tap question on Home about an Application that has sat in Applied for 21 days with no employer email.
_Avoid_: follow-up, nudge

## What Overture asks

**Review**:
A factual question Overture will not guess at and needs the user to answer before some Applications can be sent.
Reviews are grouped by Application; answering a shared question once unlocks every Application that asks it.
_Avoid_: Hold, review item, question (as the object)

**Needs you**:
The label on anything blocked on the user's answer: an open Review, or a Queued card blocked by one. A Ready card
waits for Approval and is labelled Ready, not Needs you.
_Avoid_: action required, blocked

**Paid work**:
Any step that calls the LLM or a cloud browser: scoring, preparation, form reads, resume text extraction, resume
fact reading, email classification and sending. It never runs for an account with no Applications left while the spend
gate is on, so nobody can cost the host money before a verified trial card, a paid plan, or an admin grant.
_Avoid_: AI work, compute, usage

## The user's facts

**Fact**:
Something true about the user that answers application questions, such as work authorisation or notice period.
Shown in the app as a **saved answer**; the collection is **Saved answers** on Profile.
_Avoid_: Answer Bank, Memory Base

**Derived answer**:
An answer that code builds from a saved Fact or a Target the user set: a city, region and country combined, a US-state
check, or a country, workplace or relocation choice from Targets. It is recorded with its basis and never adds a Fact
the user did not give.
_Avoid_: inferred answer, computed answer

**Tier**:
How a Fact is gathered: Tier 1 from the resume and profile, Tier 2 under "Strengthen your profile", Tier 3 learned
from a Review.

**Country scope**:
The country a country-scoped Fact applies to, as an ISO country code. Work authorisation and sponsorship are
country-scoped: a Fact for one country never answers a question about another.

**Question catalog**:
Every application question Overture has seen, shared across users without their answers, each linked to the Fact that answers it.

**Excluded employers**:
Companies Overture never applies to for this user, starting with the current employer.
_Avoid_: blocklist, never-apply list, Skip list

## My data

**Export**:
The one encrypted zip of a user's profile, Facts, Applications, Snapshots, messages, resume and attachments. Its link
works for 24 hours and opens with the key the server generated and wrapped for that export, delivered only with the
link and never stored in plaintext or logged; after that the archive is deleted, and a new request replaces a ready one.
_Avoid_: download, data dump, archive

## Plans and billing

**Plan**:
What the user pays for: Week ($9.99, 50 Applications over 7 days) or Month ($29.99, 250 Applications over 30 days),
both renewing until cancelled; the Free trial gives 3 once (ADR 0018). The plan is chosen at the end of onboarding
(Free trial, Weekly or Monthly) and can change later in Stripe. Unused Applications expire at the end of the period,
and a failed Application is never charged. The prices and counts live in `src/shared/plans.ts`.
_Avoid_: tier, subscription tier, subscription level, package, level

**Free trial**:
Three Applications at no charge, once per card, for a card verified with Stripe. Nothing is charged. The card is kept
only as an HMAC of its fingerprint, not linked to the user, so it cannot start a second trial even after its account
is deleted.
_Avoid_: free plan, demo, credit, promo, bonus

**Period grant**:
The Applications one paid period makes available. It expires at the period's end, so unused ones do not roll over,
and a reservation still open then is released and expired with it, except a send already in flight, which finishes
and is charged only if it was sent.
_Avoid_: credit, allowance, rollover, plan balance

**Billing pause**:
The pause that stops new sends when a plan ends (`plan_ended`) or a payment does not go through (`payment_failed`).
It keeps the queue and history, tells the person once by push and email with the one fix (choose a plan or update
the card), lets sends already in flight finish, and clears by itself when a later payment succeeds.
_Avoid_: payment failure alert, dunning, lockout

**Subscription**:
Stripe's record of the user's renewing Plan: the Week or Month price it bills now, its status, when the current period
ends and whether it will be cancelled then. Overture stores what signed Stripe events say and never shortens a paid
period.
_Avoid_: membership, recurring order, account

**Cancel at period end**:
The user stopping the renewal. The subscription ends when the paid period does, and the Applications that period paid
for stay available until then.
_Avoid_: cancel now, immediate cancellation

**Reconciliation**:
The daily check of one UTC day where Stripe's paid invoices and refunds must match the ledger's period grants and
refunds. It stores the day's result for the admin and alerts the owner on any mismatch; a clean day stores its result
and alerts nobody.
_Avoid_: audit, sync, settlement

## Mail

**Inbox**:
The read-only destination of threads of mail sent to a user's apply alias, each linked to its Application. It has no
reply; the user replies from their own mailbox (SPEC §11.2).

**Apply alias**:
The readable address every account gets at creation (`<handle>@tryoverture.com`) and the only address an employer
sees. The user's own verified login email stays private, and every message to the alias is stored in that person's
Inbox and copied to that person's current verified login email. A retired local part is never reused.
_Avoid_: forwarding address, job-search address, real email

**Erasing**:
Deleting an account after the signed-in user re-authenticates. The wrapped user key is destroyed first, so every
remaining encrypted copy is unreadable, then the vendor browser profiles, the apply alias, the stored objects and the
personal rows go; admin audit rows stay. It completes within 24 hours and sends one confirmation email.
_Avoid_: wiping, purge, hard delete

**Sending domain**:
`tryoverture.com` onboarded to Cloudflare Email Sending so Overture can mail any recipient, not only the owner. It adds bounce MX, SPF and DKIM on `cf-bounce.tryoverture.com` and keeps the Email Routing records on the apex; the deploy guard and the hourly mail-health guard verify it once `REQUIRE_EMAIL_SENDING` is on.

**Invite**:
A pre-approved email address that still joins with an admin grant of 300 applications over 30 days. Public sign-up
does not need one, but an invite that exists is accepted on the first verified sign-up and its grant is unchanged
for users who joined earlier. With public sign-up turned off, only the owner and live invites may join.
_Avoid_: waitlist spot, access code

**Code paste**:
Typing a verification code into Overture when the emailed code did not arrive in time. The wait lasts ten minutes and the same application resumes.
_Avoid_: manual code entry, OTP

## The legal pages

**Consent version**:
The numbered wording the user agrees to for Overture to prepare and send applications on their behalf. It lives once in
`consent_versions` and is never edited; the profile records the version the user accepted, and each Snapshot records the
version its Application was sent under. Publishing a newer version appends a row; earlier ones stay as they were.
_Avoid_: terms version, policy version, T&C

## The admin

**Kill switch**:
A scope-scoped switch (global, one ATS, one employer or one browser provider) that stops Overture's work there until it is switched on again. The owner sets one from the admin; the change is audited.
_Avoid_: toggle, off switch, feature flag

**Passkey assertion**:
The owner proving themselves with a passkey before the admin opens. The last assertion must be within 12 hours.
_Avoid_: reauth, 2FA, step-up

**Admin audit**:
The append-only record in `admin_audit` of every action taken in the admin: who, what, when, why.
_Avoid_: log entry, change history

**Reveal**:
The owner's passkey re-assertion and typed reason opening a 15-minute read-only view of one person's data, scoped to
that person, written to the admin audit and shipped off the machine. EEO answers stay aggregate-only inside it.
_Avoid_: impersonation, login as, shadow session

**Suspension**:
The owner stopping one account at once: sign-in is refused and live sessions end, running pauses with the `suspended` reason, sent
Applications stay sent and Inbox mail keeps arriving, and the typed reason is written to the admin audit. Reinstating
clears the suspension and leaves running paused until the person starts it.
_Avoid_: ban, block, lockout

**Mail health**:
The admin view of mail sent to apply aliases, per employer: Applications sent, messages in, authentication results and
the reply rate over the last 7 or 30 days, with no message content. The reply-rate alert warns the owner when an
employer's rate is under 5 percent after 10 sends, and when the domain-wide rate is under 5 percent after 20 sends;
it never stops sends by itself.
_Avoid_: inbox analytics, mail report

**Variable cost**:
What one Application actually spent, kept on its row: the browser spend of the try that sent it, the browser spend of
every other attempted try (the retries), and the person's Application-purpose model spend attributed to it, all in
integer micros (ADR 0041). It is the per-Application record; the plan rows still report the monthly average of
ADR 0026.
_Avoid_: unit cost, true cost, all-in cost

**Form probe**:
The admin job that reads up to twenty open Personio forms over plain HTTP and records a result per form before the Personio kill switch is released: `readable`, an honest `needs_review` for a required custom question with no rule, `unreadable`, or `unsupported` for a control the flow cannot fill. It never submits.
_Avoid_: test run, dry run, smoke test

## Never in anything a user can read

`Hold`, runner, lease, provider, dispatch, attempt, ledger, credit, CAPTCHA, Brain, Hands, workspace, Job Board (say Board), Answer Bank, Memory Base, Live Tab.
