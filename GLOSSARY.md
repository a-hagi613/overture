# Overture

A job-search agent that applies to jobs for one person, automatically, and shows its work. These are the words for
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

## Applying

**Application**:
One effort to apply to one Posting on the user's behalf, from preparation to the employer's final answer.
_Avoid_: submission, job (as the object)

**Status**:
Where an Application stands inside Overture: preparing, needs review, ready, sending, confirming, sent, couldn't apply, skipped or withdrawn.
_Avoid_: state, progress

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

## The Board

**Stage**:
Where an Application stands with the employer, shown as a Board column: Queued, Applied, Screening, Interviewing, Offer, Closed.
_Avoid_: column, phase, Hold

**Queued**:
The first Stage: the Application is being prepared, waiting on a Review, waiting for its time to send, or being confirmed.
_Avoid_: Hold, pending

**Check-in**:
A one-tap question on Home about an Application that has sat in Applied for 21 days with no employer email.
_Avoid_: follow-up, nudge

## What Overture asks

**Review**:
A factual question Overture will not guess at and needs the user to answer before some Applications can be sent. Answering it once unlocks every Application that asks it.
_Avoid_: Hold, review item, question (as the object)

**Needs you**:
The label on anything waiting for the user: an open Review, or a Queued card blocked by one.
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

## Mail

**Forwarding address**:
The private address Overture gives each user on `tryoverture.com` (`in-…@`). The user forwards only ATS mail to it; it is never typed on an application form, where the user's real email goes (ADR 0028).

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

**Live check**:
The daily `live.check` job on `overture-web` that exercises a real form capture, real Haiku calls, the mail loop and R2, records pass/fail and timing, and alerts the owner on failure. It never submits an application or touches a user.
_Avoid_: smoke test, canary, health probe

## Never in anything a user can read

`Hold`, runner, lease, provider, dispatch, attempt, ledger, credit, CAPTCHA, Brain, Hands, workspace, Job Board (say Board), Answer Bank, Memory Base, Live Tab.
