# Overture

A job-search agent that finds jobs for one person, prepares every application and sends it when you approve, and
shows its work. These are the words for
what it does, used exactly in code, copy, issues and commits.

## The search

**Posting**:
A job opening an employer publishes on an ATS.
_Avoid_: job, listing, role (as the object)

**Match score**:
A 0–100 fit between a Posting and the user's resume and targets, with a one-line reason.
_Avoid_: rating, fit score

**Strong match**:
A Posting whose Match score is 80 or above.

**Targets**:
What the user wants: roles, seniorities, workplaces, locations, employment types and a salary floor.
_Avoid_: preferences, filters

## Signing in

**Verified email**:
The address a user proved they own by opening the single-use link Overture mailed them. No Application is prepared
or sent for an unverified address, and an invite is accepted on the first verified sign-in.
_Avoid_: confirmed address, validated account

**Demo account**:
The `role = demo` account (`test@email.com`) that the owner opens from the sign-in page with one click to see
Overture as a long-time user would. It is seeded with fictional data, receives no mail, sends no Application, makes
no ATS or Browser Use call and is left out of admin counts and the M1 provider report.
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
destination that lists them ("Ready to send") and the Board column that holds an Application from Ready until it is
confirmed sent.
_Avoid_: pending, draft, awaiting approval

**Approval**:
The user pressing Send on a Ready Application. It freezes the exact job, resume file, answers and letter that will be
sent, and is the user's consent for that one application. It can be undone until sending starts, and anything that
changes its plan (a Fact or resume it used, an answered Review) returns it to Ready with what changed.
_Avoid_: confirmation, sign-off, go-ahead

**Approved**:
The Status after Approval and before sending: the Application waits for its time to send within the daily limits.
_Avoid_: scheduled, queued

**Daily run**:
The one preparation pass each running user gets per local day (07:00 by default). It matches, prepares and stops at
the free Ready slots; it never sends.
_Avoid_: match fill, hourly run, batch

**Skip**:
The user withdrawing a Ready or Approved Application instead of sending it. It is the ordinary withdrawal that leaves
the Board and never adds the company to the Skip list.
_Avoid_: reject, dismiss

**Confirming**:
The Status after the employer may have received the Application and before its confirmation was seen. Shown as "Checking with the employer".

**Couldn't apply**:
An Application that was not sent, or whose sending could not be confirmed. It never uses one of the user's applications.
_Avoid_: failed (in copy), error

**Applications left**:
How many more Applications the user's plan allows; one is used only when an Application is confirmed sent.
_Avoid_: credit, allowance, quota

**Snapshot**:
The permanent record of exactly what one sent Application said: answers with their sources, the letter, the resume file and the consent.
_Avoid_: receipt, log

**Workable snapshot**:
The gzipped JSONL of target-relevant Workable Postings that the daily off-box pass writes to R2, with a manifest of its fetched-at, source `Last-Modified`, row count and content hash. The app ingests it and never fetches Workable.
_Avoid_: feed download, Workable cache

## The Board

**Stage**:
Where an Application stands with the employer, shown as a Board column: Queued, Ready, Applied, Screening, Interviewing, Offer, Closed.
_Avoid_: column, phase, Hold

**Queued**:
The first Stage: the Application is being prepared or waiting on a Review.
_Avoid_: Hold, pending

**Check-in**:
A one-tap question on Home about an Application that has sat in Applied for 21 days with no employer email.
_Avoid_: follow-up, nudge

## What Overture asks

**Review**:
A factual question Overture will not guess at and needs the user to answer before some Applications can be sent. Answering it once unlocks every Application that asks it.
_Avoid_: Hold, review item, question (as the object)

**Needs you**:
The label on anything blocked on the user's answer: an open Review, or a Queued card blocked by one. A Ready card
waits for Approval and is labelled Ready, not Needs you.
_Avoid_: action required, blocked

## The user's facts

**Fact**:
Something true about the user that answers application questions, such as work authorisation or notice period.
_Avoid_: Answer Bank, Memory Base, saved answer (as a place)

**Derived answer**:
An answer that code builds from a saved Fact or a Target the user set: a city, region and country combined, a US-state
check, or a country, workplace or relocation choice from Targets. It is recorded with its basis and never adds a Fact
the user did not give.
_Avoid_: inferred answer, computed answer

**Tier**:
How a Fact is gathered: Tier 1 in onboarding, Tier 2 under "Strengthen your profile", Tier 3 learned from a Review.

**Country scope**:
The country a country-scoped Fact applies to, as an ISO country code. Work authorisation and sponsorship are
country-scoped: a Fact for one country never answers a question about another.

**Question catalog**:
Every application question Overture has seen, shared across users without their answers, each linked to the Fact that answers it.

**Skip list**:
Companies Overture never applies to for this user, starting with the current employer.
_Avoid_: blocklist, never-apply list

## My data

**Export**:
The one encrypted zip of a user's profile, Facts, Applications, Snapshots, messages, resume and attachments. Its link
works for 24 hours and opens with the key the server generated and wrapped for that export, delivered only with the
link and never stored in plaintext or logged; after that the archive is deleted, and a new request replaces a ready one.
_Avoid_: download, data dump, archive

## Plans and billing

**Plan**:
What the user pays for: Week gives 70 Applications over 7 days and Month gives 300 over 30 days, both renewing until
cancelled; the trial gives 3 once (ADR 0018).
_Avoid_: subscription tier, package, level

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

## Mail

**Inbox**:
The read-only destination of threads of forwarded ATS mail, each linked to its Application. It has no reply; the user
replies from their own mailbox (SPEC §11.2).

**Forwarding address**:
The private address Overture gives each user on `tryoverture.com` (`in-…@`) when their account is created. The user
forwards only ATS mail to it; it is read-only in the app, never typed on an application form, where the user's real
email goes (ADR 0028), and a retired local part is never reused.

**Erasing**:
Deleting an account after the signed-in user re-authenticates. The wrapped user key is destroyed first, so every
remaining encrypted copy is unreadable, then the vendor browser profiles, the forwarding address, the stored objects
and the personal rows go; admin audit rows stay. It completes within 24 hours and sends one confirmation email.
_Avoid_: wiping, purge, hard delete

**Sending domain**:
`tryoverture.com` onboarded to Cloudflare Email Sending so Overture can mail any recipient, not only the owner. It adds bounce MX, SPF and DKIM on `cf-bounce.tryoverture.com` and keeps the Email Routing records on the apex; the `mail.sending` live check and the deploy guard verify it once `REQUIRE_EMAIL_SENDING` is on (M2-02).

**Invite**:
The owner's permission for one email address to join the beta. Accepting it by signing in with that email creates the account and an admin grant of 300 applications over 30 days.
_Avoid_: waitlist spot, access code

**Code paste**:
Typing a verification code into Overture when the forwarded email did not arrive within five minutes. The wait lasts ten minutes and the same application resumes.
_Avoid_: manual code entry, OTP

**Recap**:
The one email and push after a user's Daily run that lists the new Ready Applications, the open Reviews and
yesterday's sends and replies, with one link to Ready. It is never sent when the run produced nothing, and opening it
never sends an Application.
_Avoid_: Ready email, digest, notification

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
The admin view of forwarded ATS mail per employer: Applications sent, messages in, authentication results and the
reply rate over the last 7 or 30 days, with no message content. The reply-rate alert warns the owner when an
employer's rate is under 5 percent after 10 sends, and when the domain-wide rate is under 5 percent after 20 sends;
it never stops sends by itself.
_Avoid_: inbox analytics, mail report

**Live check**:
The daily `live.check` job on `overture-web` that exercises a real form capture, real Haiku calls, the mail loop and R2, records pass/fail and timing, and alerts the owner on failure. It never submits an application or touches a user.
_Avoid_: smoke test, canary, health probe

## Never in anything a user can read

`Hold`, runner, lease, provider, dispatch, attempt, ledger, credit, CAPTCHA, Brain, Hands, workspace, Job Board (say Board), Answer Bank, Memory Base, Live Tab.
