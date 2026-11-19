# Overture — product truth (v2)

Durable product facts for design and build. Supersedes the v1 `PRODUCT.md` at the repo root.
Architecture truth lives in `docs/v2/SPEC.md` and `docs/v2/DECISIONS.md`; vocabulary in
`docs/v2/GLOSSARY.md`; visual system in `DESIGN.md`.

## Platform

Web app, installable as a PWA, phone-first for triage. Desktop is where the owner reviews; the phone
is where they answer a Review in three minutes between meetings. No native apps.

## What it is

Overture finds job postings from ATS feeds, scores them against the resume, prepares each application
from the user's own facts, writes the cover letter, and submits through the employer's real form in a
managed cloud browser. The user never sees a browser or a CAPTCHA.

Promises, in priority order:

1. **Never lie.** Every factual answer traces to a saved fact; the resume PDF is sent byte-for-byte.
2. **Never embarrass.** Never the current employer, never a skipped company, never twice to the same
   role, never in bursts, never below the user's threshold.
3. **Never charge for failure.** An application costs an allowance only when it is actually sent.
4. **Fully automatic.** The only mid-pipeline ask is a factual question Overture cannot answer.
5. **Auditable.** Every sent application keeps an immutable record of answers, letter, resume and consent.

## Who it is for

One person running a serious job search, applying to ten roles a day, who will not hand-fill forms and
will not let a tool invent an answer. Primary persona in the boards: a senior backend/platform engineer
in Canada searching globally.

## The five destinations

Home · Board · Review · Inbox · Profile. Settings opens from the avatar (desktop hover submenus;
phone list pages). Activity folds into Home; there is no sixth item.

## The six stages

Queued · Applied · Screening · Interviewing · Offer · Closed. A **Review** is a question, not a stage.
`Couldn't apply` is a status inside an application, shown in Home activity and on the card, never a
column.

## Plans

Trial: 3 applications once, card required and verified. Week: $12 for 70 applications over 7 days. Month: $35 for 300
over 30 days. Both renew. Ten applications a day at most, sent between 08:00 and 20:00 local time,
at least twenty minutes apart, resetting at the user's local midnight. One company at a time, and not again for 7
days after a send. These limits are fixed, not settings. Nothing is charged for a send that fails or can't be
confirmed.

## Identity and mail

Four sign-in methods: Google, LinkedIn, email + password, magic link. Beta is invitation-only.
Each user gets a generated job-search address `first.last@mail.tryoverture.com`. It is the email on every
application form, so employers' replies and verification codes land in the Inbox. The personal mailbox is never connected or read. Replies are allowed only
on threads an employer started, at most 20 a day.

## Onboarding, five steps

1 Sign in · 2 Resume · 3 Your facts (Tier 1, prefilled from the PDF, confirmed not typed) ·
4 What you want (live matching count) · 5 Your job-search address + consent + trial card + Start.
Each step saves on its own; nothing is skipped.

## Surfaces

Home (start/pause, applications left, queue position and ETA, up next, check-ins, activity including
`Couldn't apply`), Board (six columns, card sheet with timeline, proof and linked mail), Review (open
questions grouped by jobs unlocked), Inbox (threads, attachments, sender verification, reply), Profile
(resume, facts by tier, targets with live count, skip list, job-search address), Settings (match
threshold, notifications and digest, timezone, languages, the fixed limits explained, address, plan & billing,
sessions, export, delete, support access log), Onboarding, and the owner Admin (success by provider × ATS, cost per completed
application, queue, kill switches, attempts with live view and replay, audit).

## Language

Posting, Application, Stage, Status, Queued, Review, Couldn't apply, Applications left, Check-in,
Job-search address. Never, in anything a user can read: Hold, runner, lease, provider, dispatch, attempt, ledger, credit, CAPTCHA,
Brain, Hands. Code may use them for internals.
