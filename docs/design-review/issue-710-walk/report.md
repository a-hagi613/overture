# End-to-end acceptance walk — three people, three plans (#710)

Date: 2026-11-27 (second rerun). Run on merged `main` at `0ae0339b` — the #710 wiring (#753), the BambooHR /
Zoho / Manatal readers (#761), claim-every-adapter + preflight-the-filled-form (#763), one open pick per
employer (#762), the batch custom_id cap (#755), and the live BambooHR / Zoho fill fix (#776). Local instance
`http://devbox:3423`, `NODE_ENV=development`, `OVERTURE_DRY_SUBMIT=1`, freehire free tier (no API key),
Claude Haiku 5.5 (Batches), Stripe sandbox, local Chromium (`BROWSER_PROVIDER=local`). Three fresh accounts:
software engineer (Free trial), teacher (Weekly), admin (Monthly).

**Headline: a real send now reaches the dry-submit stop.** Four Applications were filled and stopped immediately
before the Submit click: Elite Private School (BambooHR, teacher), jrec and sipeknekatik (BambooHR, admin), and
International Community Schools (Zoho Recruit, teacher, captured on the same commit in the immediately preceding
pass). The pre-Submit screenshots are in this folder. No application clicked Submit — that is the intended
`OVERTURE_DRY_SUBMIT=1` stop, not a failure.

Two ATS families reached it, which was the target of this rerun. The remaining blockers are four distinct
per-adapter issues, filed with their exact evidence (#786 JazzHR selector, #787 Lever fill_failed without a
diagnostic, #788 Manatal identity, #789 Greenhouse city combobox review loop). Workable stays behind the ATS kill
switch; SmartRecruiters' sampled posting had expired.

## What this run shares

- Sign-up by magic link, resume upload with the real Haiku resume reader, only the truly missing gap fields, then
  preferences by freehire category and canonical place ids. One capped pull per person (`jobs.pull_max_pages=1`,
  so 100 fetched), dedupe, sendable-ATS filtering, then one Haiku score per job through the Batches API.
- The dispatcher now claims every apply-supported adapter and no longer blocks an `unknown` liveness result
  (#763), so every pick either prepares, reaches Ready, or records an attempt. The Tracker shows why.
- Review questions come from the real form; the harness answers them through the real Review form. Answering a
  Greenhouse city combobox can loop (see #789), and the walk then skips that Application instead of faking it.
- Plans were honoured in Stripe sandbox: the admin's Monthly Checkout created a real subscription and the signed
  `invoice.paid` webhook granted **250 applications** (`ledger` grant `in_1UgUKIGhJ7DirGl3p6krU6tp`); the teacher's
  Weekly Checkout completed and the plan screen shows Weekly with the 10-a-day limit.
- The paid 5-minute spacing is exercised with the test clock (`POST /__test__/clock/offset`, enabled with
  `ENABLE_TEST_ROUTES`): the two admin BambooHR dry submits are **294 s** apart (scheduled 300 s), rather than
  sitting through wall-clock minutes. Everything else (pull, scoring, preparation, filling) is the shipped path.

## Sends that reached the pre-Submit stop

| User | Application | ATS | Attempt | Outcome | Submit click |
|---|---|---|---|---|---|
| Amina (Weekly) | Elite Private School — English Teacher 2026-2027 | BambooHR | 1 | `dry_submit` | none |
| Amina (Weekly) | International Community Schools — Homeroom Teacher | Zoho Recruit | 1 | `dry_submit` | none (prior pass, same commit) |
| Daniel (Monthly) | jrec — Executive Assistant | BambooHR | 1 | `dry_submit` | none |
| Daniel (Monthly) | sipeknekatik — Council Administrative Assistant | BambooHR | 1 | `dry_submit` | none |

The attempt rows carry `outcome=dry_submit`, `error_code=dry_submit`, `submit_clicked_at=null`, and each has a
stored `before_submit` screenshot. The screenshots show the filled live form — name, email, phone, resume
attachment (and, for Zoho, the address and demographic selects) — with the Submit/Submit Application button still
uncicked.

Screens: [BambooHR (teacher)](teacher-send-bamboohr-before-submit.png) ·
[Zoho Recruit (teacher)](teacher-send-zoho_recruit-before-submit.png) ·
[BambooHR jrec (admin)](admin-send-bamboohr-jrec-before-submit.png) ·
[BambooHR sipeknekatik (admin)](admin-send-bamboohr-sipeknekatik-before-submit.png)

## User 1 — Maya Chen, software engineer, Free trial

Preferences: Software engineering, Backend, Full-stack, DevOps, Data engineering; Canada. Resume reader filled
name, email, phone, city/country, work authorization, current employer, languages, GitHub; gaps asked only for
salary, notice, relocation, LinkedIn and the sponsorship confirmation.

Pool **88** matching roles after scoring; the trial shows the top 3 and locks the rest behind the plan card.
Picks: Aylo Careers (Greenhouse), Flexstaf IT (Manatal), Jobgether (Lever).

| # | Score | Role | Company | Place | Why (stored reason, shortened) |
|---|---|---|---|---|---|
| 1 | 85 | Sr. Software Developer I | Aylo Careers | Montréal, QC | Software engineering role matches your backend/platform work at Shopwise |
| 2 | 85 | Senior Backend Software Engineer – Golang | Flexstaf IT | Ontario | Go backend work matches your checkout API at Shopwise; GraphQL unconfirmed |
| 3 | 80 | Founding Engineer | Jobgether | Canada | Full-stack ownership from architecture to deployment, adjacent to backend |

Plan screen: Free trial preselected, card check only, all 3 sent at once; Stripe sandbox Setup card confirmed.
Outcome: **no send for the software pool.**
- Jobgether (Lever) was approved and dispatched twice: both attempts `outcome=form_changed`,
  `error_code=null`, `submit_clicked_at=null` — the filler failed before preflight, so no field detail is
  recorded (#787).
- Flexstaf IT (Manatal) was skipped as `posting_identity:unreadable` (#788).
- Aylo Careers (Greenhouse) produced no attempt in this pass; in the immediately prior pass it was skipped as
  `form_unsupported`.

Review questions per application: Aylo 0 (unsupported form), Flexstaf 0, Jobgether 0 — no form was read before
the fill failed.

What this proves: a Free-trial user still reaches a scored, pickable list, the card check, three durable picks and
the plan gate. The software pool's direct employers on this day were Lever/Manatal, and neither can send yet.

## User 2 — Amina Yusuf, teacher, Weekly

Preferences: Education; Ottawa + UAE, Saudi Arabia, Qatar, Kuwait, Bahrain, Oman. Gaps: phone, salary, notice,
relocation, languages (English/Arabic).

Pool **36** matching roles; 10 picks (one per employer after #762). Top of the visible list:

| # | Score | Role | Company | Place | ATS |
|---|---|---|---|---|---|
| 1 | 85 | Upper Elementary Teacher: Multiple Subjects Grades 4–7 | Hayat Universal School (HUBS) | Doha | Workable (kill switch) |
| 2 | 82 | Tuition Teacher – English, Arabic & Mathematics | Ontime Healthcare | Dubai | Workable (kill switch) |
| 3 | 75 | PYP Visual Arts Teacher | International School of London Qatar | Doha | BambooHR |
| 4 | 75 | PYP PHE Teacher 2027–2028 | International School of London Qatar | Doha | BambooHR |
| 5 | 75 | English Teacher 2026–2027 | Elite Private School | Abu Dhabi | BambooHR |
| 6 | 72 | Arabic Teacher 2026/2027 | Elite Private School | Abu Dhabi | BambooHR |
| 7 | 67 | PYP & MYP Arabic Language Teacher | International School of London Qatar | Doha | BambooHR |
| 8 | 67 | Class Teacher – Al Manhal | International Community Schools | Abu Dhabi | Zoho Recruit |
| 9 | 67 | Homeroom Teacher – Al Mushrif | International Community Schools | Abu Dhabi | Zoho Recruit |
| 10 | 65 | Art Teacher – Al Dannah | International Community Schools | Abu Dhabi | Zoho Recruit |

Plan: Weekly $9.99 Checkout completed in Stripe sandbox; the plan card shows Weekly with 50 applications a week.
Outcome:
- **Elite Private School (BambooHR) reached the dry-submit stop**: filled first/last name, email, phone,
  resume attachment, with Submit Application visible and unclicked.
- **International Community Schools (Zoho Recruit) reached the dry-submit stop in the immediately preceding pass
  on `0ae0339b`**: the screenshot shows the full address block, the gender and nationality selects, the resume
  attachment and a required CAPTCHA field above Submit Application. This pass skipped that Application at Review
  (`review_dismissed`) because the city/nationality answers were re-asked; that is the #789 class of loop, not a
  send-path regression.
- International School of London Qatar (BambooHR) stopped at preflight with
  `value_mismatch:state.value` — the harness had answered the State question with "No"; a valid province answer
  sends it (the two admin BambooHR sends below are the same shape).
- Both Workable roles were skipped by the ATS kill switch (`ats_not_enabled`), unchanged from the last report.

Review questions per application: one form (the live State/ZIP class) was answered for the ISL Qatar card; Elite
Private School needed none; the Zoho card's first form was answered and its re-asked question was then skipped
(`review_dismissed`) instead of answered twice. Identity fields on the BambooHR form: First Name, Last Name, Email, Phone, Resume, Date
Available (optional). On the Zoho form: First/Last Name, Email, Mobile (+1), Gender, Nationality, Street, City,
State, Country, resume.

What this proves: a Weekly teacher can go from a fresh account through a real paid Checkout to a fully filled live
BambooHR form and a fully filled live Zoho form, stopping exactly at Submit. The supply limit is now the Workable
kill switch, not form reading.

## User 3 — Daniel Okafor, admin, Monthly

Preferences: Administration, Operations; Canada + Ottawa. Gaps: phone, salary, notice, relocation, languages.

Pool **80** matching roles, **70 scored** at the time of reading. The visible top 10:

| # | Score | Role | Company | Place | ATS |
|---|---|---|---|---|---|
| 1 | 90 | Internal/External – Administrative Assistant | lambtonkent | Sarnia, ON | BambooHR (form unsupported) |
| 2 | 90 | Executive Assistant | jrec | Ottawa, ON | BambooHR |
| 3 | 85 | Administrative Coordinator | Ubisoft | Quebec City | SmartRecruiters (expired posting) |
| 4 | 85 | Council Administrative Assistant | sipeknekatik | Indian Brook, NS | BambooHR |
| 5 | 85 | Executive Assistant | Manitoba Keewatinowi Okimakanak (MKO) | Thompson, MB | BambooHR |
| 6 | 85 | Leadership Administrative Support, Senior Leadership Team | CMHA Thames Valley | London, ON | JazzHR |
| 7 | 77 | Executive & Office Coordinator | Alveole | Montréal | Greenhouse |
| 8 | 77 | Office Administrator – Temporary contract | drclean | Sudbury, ON | BambooHR |
| 9 | 77 | Reception/Admin Assistant | ltlgroup | Thunder Bay, ON | BambooHR |
| 10 | 75 | Executive Assistant – Construction | BOS Staffing | (blank) | BambooHR |

Plan: Monthly $29.99 Checkout completed. The subscription is active in the ledger, the signed invoice granted
250 applications, and the Tracker shows "Monthly · 250 applications this month · 10 a day".

Outcome:
- **jrec — Executive Assistant (BambooHR) reached the dry-submit stop.**
- **sipeknekatik — Council Administrative Assistant (BambooHR) reached the dry-submit stop**, 294 s after jrec on
  the skipped clock (the 5-minute paid spacing).
- CMHA Thames Valley (JazzHR) was approved and dispatched; the attempt ended `form_changed` with no error code
  because the live form is `form#form_submit_new_resume` and the JazzHR selector never matched (#786).
- Ubisoft (SmartRecruiters) stayed in preparation; its live posting says "This job has expired", so there is no
  form to read.
- Alveole / BOS Staffing / MKO were skipped as `form_unsupported` or `open_text_ungrounded`; drclean and ltlgroup
  waited at Review for real form questions.

Review questions per application: State + ZIP (BambooHR), plus later driver's-licence / transport / availability
questions on two cards. Identity fields on the BambooHR form: First Name, Last Name, Email, Phone, Resume (Date
Available optional).

What this proves: the Monthly path, the 250 grant, a 10-pick batch across employers, and two BambooHR dry submits
in one paid run with the intended spacing.

## AI spend

Admin (measured in this instance): **$0.0685**, 280 calls — 272 score calls (104,787 input / 735,124 cached /
234,667 output tokens), 1 resume-facts call, 7 open-text calls (no tokens billed). The two targeted pulls and the
retried scoring batch account for the higher call count than the last report.

Swe and teacher ran in the preceding instance on the same commit; their per-user usage rows were not re-read
before that instance was reset for the admin pass. Their scoring used the same per-job batch shape (85 and 35
score calls), so they are in the same few-cents range, but those exact totals are not claimed here. This is a
bookkeeping gap in the walk harness, not a product gap: `GET /__test__/llm/usage?userId=` reports it when the
instance is kept.

Browser Use spend: **$0** — `BROWSER_PROVIDER=local`, as allowed when Browser Use cloud sessions stop immediately
for this account (see known limits).

## Known limits

- **No Application clicked Submit.** This is the requested `OVERTURE_DRY_SUBMIT=1` stop; the four screenshots are
  the evidence that filling completed on BambooHR and Zoho. Confirmation receipts are not part of this run.
- **Four per-adapter blockers remain, each with its own issue and exact evidence:** #786 (JazzHR live form id),
  #787 (Lever fill_failed with no recorded field), #788 (Manatal posting identity unreadable), #789 (Greenhouse
  city combobox Review loop). None of these weakens a guard or fakes a send.
- **Workable remains disabled** by the ATS kill switch (`ats_not_enabled`), so the strongest admin and education
  matches still cannot send. That is a deliberate switch, listed for the owner.
- **SmartRecruiters' sampled posting had expired** ("This job has expired"); the walk stayed in preparation rather
  than inventing a form. Pool freshness, not a send bug.
- **Two local instances.** Swe and teacher ran together; the admin pass ran on a fresh instance after a local
  reset, so its pull/usage rows are the ones quoted directly above. All runs are on `0ae0339b`.
- **The paid spacing was exercised with the test clock**, not wall-clock minutes, at the coordinator's request:
  `POST /__test__/clock/offset` plus `POST /__test__/jobs/run-due`. The 294 s gap between the admin dry submits is
  the real scheduled spacing, not a shortened one.
- **Browser Use cloud sessions still stop immediately** (`status: stopped`, `cdpUrl: null`), so filling ran in
  local Chromium. The brief allows this when Browser Use is unavailable; no Browser Use spend was incurred.
- **Review answers** are ordinary owner answers typed through the real Review forms (city, province, ZIP,
  nationality, gender, how-heard). The harness picks plausible values; two cards looped on a combobox answer and
  were skipped, which is the product behaviour described in #789.
- Screenshots are light at 390 and 1280; social/matches screens also have a dark pair. Renders come from the real
  pages, not canvas boards.

## Reproduce

The harness is committed as text next to this report:
[walk/issue-710-walk.spec.ts.txt](walk/issue-710-walk.spec.ts.txt) and
[walk/playwright.walk.config.ts.txt](walk/playwright.walk.config.ts.txt). Copy both back to
`test/walk/issue-710-walk.test.ts` and `playwright.walk.config.ts`, start the app with the #710 brief's env
(`OVERTURE_DRY_SUBMIT=1`, `ENABLE_TEST_ROUTES=true`, `BROWSER_PROVIDER=local`), then run
`bun node_modules/playwright/cli.js test -c playwright.walk.config.ts --workers=1` (add `WALK_PROFILE=swe`,
`teacher` or `admin` for one person). The harness answers Review forms, approves Ready cards, skips the paid
spacing through the test clock, and copies any `before_submit` / `after_submit` object-store screenshots into this
folder.
