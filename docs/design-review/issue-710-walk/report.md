# End-to-end acceptance walk — three people, three plans (#710)

Date: 2026-11-27 (third rerun: the Free-trial user, on the merged Lever/JazzHR fix). This pass ran the software
engineer only, on merged `main` at **`b1e9d528`** — the #710 wiring (#753), the BambooHR / Zoho / Manatal readers
(#761), claim-every-adapter + preflight-the-filled-form (#763), one open pick per employer (#762), the batch
custom_id cap (#755), the live BambooHR / Zoho fill fix (#776), and **#792**: the live Lever location autocomplete
and the JazzHR `form#form_submit_new_resume` submit anchor (#786, #787). The teacher and admin evidence below was
captured in the two preceding instances on `0ae0339b`; it is kept because this run only exists to move the third
user.

Local instance `http://devbox:3423`, `NODE_ENV=development`, `OVERTURE_DRY_SUBMIT=1`, freehire free tier (no API
key), Claude Haiku 5.5 (Batches), Stripe sandbox, local Chromium (`BROWSER_PROVIDER=local`). Three fresh accounts:
software engineer (Free trial), teacher (Weekly), admin (Monthly).

**Headline: all three people now reach the pre-Submit stop, on three ATS families.** Five Applications were filled
and stopped immediately before the Submit click: USMobile (Lever, swe — this run), Elite Private School (BambooHR,
teacher), International Community Schools (Zoho Recruit, teacher), jrec and sipeknekatik (BambooHR, admin). The
pre-Submit screenshots are in this folder. No application clicked Submit — that is the intended
`OVERTURE_DRY_SUBMIT=1` stop, not a failure.

The Lever fill blocker that stopped this user in the previous run is gone: the structured location commits
(`location` + `selectedLocation` both populate) and the Free-trial pick no longer dies before preflight. The other
two picks this day stopped for reasons outside the send path — a closed posting and the #789 Review loop. Two
per-adapter blockers remain from the wider walk — Manatal identity (#788) and the Greenhouse city/province Review
loop (#789), which bit the Affirm card in this run — plus supply limits (Workable kill switch, an expired or closed
posting).

## What this run shares

- Sign-up by magic link, resume upload with the real Haiku resume reader, only the truly missing gap fields, then
  preferences by freehire category and canonical place ids. One capped pull per person (`jobs.pull_max_pages=1`:
  100 fetched), dedupe, sendable-ATS filtering, then one Haiku score per job through the Batches API.
- The dispatcher claims every apply-supported adapter and no longer blocks an `unknown` liveness result (#763), so
  every pick either prepares, reaches Ready, or records an attempt. The Tracker shows why.
- Review questions come from the real form; the harness answers them through the real Review form. A question that
  comes back after it was answered is skipped rather than answered twice, so a looping card is skipped, not faked
  (#789).
- Plans were honoured in Stripe sandbox: the admin's Monthly Checkout created a real subscription and the signed
  `invoice.paid` webhook granted **250 applications** (`ledger` grant `in_1UgUKIGhJ7DirGl3p6krU6tp`); the teacher's
  Weekly Checkout completed and the plan screen shows Weekly with the 10-a-day limit; the swe trial went through the
  Setup-card check only (no charge).
- The paid 5-minute spacing is exercised with the test clock (`POST /__test__/clock/offset`, enabled with
  `ENABLE_TEST_ROUTES`): the two admin BambooHR dry submits are **294 s** apart (scheduled 300 s), rather than
  sitting through wall-clock minutes. Everything else (pull, scoring, preparation, filling) is the shipped path.

## Sends that reached the pre-Submit stop

| User | Application | ATS | Attempt | Outcome | Submit click |
|---|---|---|---|---|---|
| Maya (Free trial) | USMobile — Senior Backend Engineer | Lever | 1 | `dry_submit` | none |
| Amina (Weekly) | Elite Private School — English Teacher 2026-2027 | BambooHR | 1 | `dry_submit` | none |
| Amina (Weekly) | International Community Schools — Homeroom Teacher | Zoho Recruit | 1 | `dry_submit` | none (prior pass, same commit) |
| Daniel (Monthly) | jrec — Executive Assistant | BambooHR | 1 | `dry_submit` | none |
| Daniel (Monthly) | sipeknekatik — Council Administrative Assistant | BambooHR | 1 | `dry_submit` | none |

The attempt rows carry `outcome=dry_submit`, `error_code=dry_submit`, `submit_clicked_at=null`, and each has a
stored `before_submit` screenshot. The screenshots show the filled live form — name, email, phone, resume
attachment (and, for Zoho, the address and demographic selects; for Lever, the committed location) — with the
Submit/Submit Application button still unclicked.

Screens: [Lever (swe)](swe-send-lever-before-submit.png) ·
[BambooHR (teacher)](teacher-send-bamboohr-before-submit.png) ·
[Zoho Recruit (teacher)](teacher-send-zoho_recruit-before-submit.png) ·
[BambooHR jrec (admin)](admin-send-bamboohr-jrec-before-submit.png) ·
[BambooHR sipeknekatik (admin)](admin-send-bamboohr-sipeknekatik-before-submit.png)

## User 1 — Maya Chen, software engineer, Free trial (this run)

Preferences: Software engineering, Backend, Full-stack, DevOps, Data engineering; Canada. Resume reader filled
name, email, phone, city/country, work authorization, current employer, languages, GitHub; gaps asked only for
salary, notice, relocation, LinkedIn and the sponsorship confirmation.

Pull: **100 fetched, 98 kept, 2 dropped as duplicates**, one page. Scoring: **85 scored rows** in the instance, and
the Matches screen first reported **88 matching roles** to the user. The list is live and was re-ranked while the
run went on: the capture at the end shows **64 matches (page 1 of 7)**, all at 80%, after the app's own second pull
and re-score. The trial shows its picks and locks the rest behind the plan card.

Picks (one per employer, chosen by the app from the sendable list):

| # | Role | Company | Place | ATS |
|---|---|---|---|---|
| 1 | Sr. Software Developer I | Aylo Careers | Montréal, Quebec | Greenhouse |
| 2 | Senior Backend Engineer | USMobile | Toronto | Lever |
| 3 | Senior Software Engineer, Backend (Trust Infra) | Affirm | Remote Canada | Greenhouse |

The visible list at the end of the run (as the Matches screen showed it, page 1 of 7):

| # | Match | Role | Company | Place |
|---|---|---|---|---|
| 1 | 80 | Founding Engineer | Jobgether | Canada |
| 2 | 80 | Senior Platform Engineer | Jobgether | Canada |
| 3 | 80 | Founding Engineer – Infra Development | hireVouch | Toronto, Ontario |
| 4 | 80 | Senior Software Developer, AI Infrastructure | Jobgether | Canada |
| 5 | 80 | DevOps/Cloud Engineer (Senior) | Upstaff | Toronto, Canada |
| 6 | 80 | Senior Full Stack AI Engineer | Orion Digital | Vancouver (or remote), BC |
| 7 | 80 | Senior Software Engineer, Security | Forward Financing | Remote – Ontario, Canada |
| 8 | 80 | Senior Platform Engineer | Robots and Pencils | Remote, Canada |
| 9 | 80 | Senior Software Engineer, Platform | Planet | Canada, Remote |
| 10 | 80 | Senior Full Stack Engineer II | Jobgether | Canada |

Plan: Free trial preselected, three applications at once, card check only (`Save`, no charge) in Stripe sandbox;
the tracker shows "Free trial · 3 applications", "3 applications left · 0 of 10 today".

Review questions: the USMobile form raised **three** — "Are you able to work in our Toronto office 3 days a week?"
(answered No), "What are your salary expectations for this role?" (CAD 150,000 a year), "Are you authorized to work
lawfully in the US for US Mobile Inc?" (answered No). Optional Preferred Name, Pronouns and State/Province were
left blank. The Affirm form raised five (Preferred Name, Pronouns, U.S. State or Canadian Province, how-did-you-hear,
prior employment at Affirm); the province question came back after it was answered, so the walk skipped that card
as `review_dismissed` — the #789 class of loop, on Greenhouse again.

Identity fields on the filled Lever form: Full name (Maya Chen), Email, Phone, **Current location** (the structured
autocomplete committed "Ottawa, ON, CAN" — full name *and* hidden `selectedLocation` id), Current company, LinkedIn
URL, Portfolio URL, GitHub URL, US Mobile phone, resume attachment; plus the hybrid-schedule radio (No), relocation
radio (No), salary expectation textarea (CAD 150,000 a year), and the Canada / US work-authorization radios
(Yes / No). The Submit Application button is visible and unclicked.

Outcome: **USMobile (Lever) reached the dry-submit stop.** Aylo Careers (Greenhouse) prepared fine but was skipped at
send with `posting_closed` — "This posting closed before sending.", the liveness check doing its job. Affirm
(Greenhouse) stopped at Review (`review_dismissed`, #789).

Honest detail on the attempt rows: this Application has four — `n=1 dry_submit`, `n=1 provider_error`, and
`n=2 dry_submit` twice. The walk's approve loop re-approves a card that the dry-submit stop leaves back in Ready,
so it was dispatched again; one of those re-dispatches failed 8.6 s in as `provider_error` with no stored error
code, and the retry reached the same stop. Three `before_submit` screenshots were stored; the report links one. No
Submit was clicked in any of them. This is harness behaviour around a deliberate dev-only stop, not a duplicate
send to an employer.

What this proves: a Free-trial user now goes from a fresh account through a real pull, real Haiku scoring, the
3-pick trial, the Stripe Setup card check, one answered Review form, and a fully filled live Lever form stopped at
Submit. The two remaining ATS gaps on this user's list were supply/Review, not the send path.

## User 2 — Amina Yusuf, teacher, Weekly (preceding instance, `0ae0339b`)

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
  attachment and a required CAPTCHA field above Submit Application. The later pass skipped that Application at Review
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
BambooHR form and a fully filled live Zoho form, stopping exactly at Submit. The supply limit is the Workable
kill switch, not form reading.

## User 3 — Daniel Okafor, admin, Monthly (preceding instance, `0ae0339b`)

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
- CMHA Thames Valley (JazzHR) was approved and dispatched; that attempt ended `form_changed` with no error code
  because the live form is `form#form_submit_new_resume` and the selector never matched (#786). #792 now matches it
  and the merged e2e spec drives it to the dry-submit stop; it has not been re-run in this walk because this pass
  was limited to the swe user.
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

Swe (measured in this instance): **$0.0558**, 275 calls — 264 score calls (94,422 input / 717,024 cached / 186,997
output tokens), 1 resume-facts call, 10 question-mapping calls (the Review forms). The two pulls and the re-score
pass account for the score calls exceeding the 85 scored rows.

Teacher and admin ran in the preceding instances on `0ae0339b`; their per-user usage rows were not re-read before
those instances were reset. Admin measured $0.0685 (280 calls) at the time; teacher used the same per-job batch
shape, so it is in the same few-cents range, but that exact total is not claimed here. This is a bookkeeping gap in
the walk harness, not a product gap: `GET /__test__/llm/usage?userId=` reports it when the instance is kept.

Browser Use spend: **$0** — `BROWSER_PROVIDER=local`, as allowed when Browser Use cloud sessions stop immediately
for this account (see known limits).

## Known limits

- **No Application clicked Submit.** This is the requested `OVERTURE_DRY_SUBMIT=1` stop; the five screenshots are
  the evidence that filling completed on Lever, BambooHR and Zoho. Confirmation receipts are not part of this run.
- **Two blockers remain, each with its own issue and reproduced evidence:** #788 (Manatal posting identity
  unreadable) and #789 (Greenhouse city/province Review loop — seen again on Affirm this run). Neither weakens a
  guard or fakes a send. #786 and #787 are closed by `b1e9d528`; the JazzHR page and the Lever location are now
  covered by the merged e2e spec, and Lever is proven live by this run.
- **The dry-submit stop returns the card to Ready**, so the walk's approve loop dispatched the same Application
  again: four attempt rows on USMobile, one of them `provider_error` with no stored code. Nothing was sent twice to
  the employer (no Submit click); a product-side reason string for that provider error would make the retry easier
  to read.
- **Workable remains disabled** by the ATS kill switch (`ats_not_enabled`), so the strongest admin and education
  matches still cannot send. That is a deliberate switch, listed for the owner.
- **SmartRecruiters' sampled posting had expired** ("This job has expired"), and the swe run's Greenhouse card for
  Aylo closed before send (`posting_closed`). The walk stayed in preparation or skipped rather than inventing a
  form. Pool freshness, not a send bug.
- **Three local instances.** Swe ran alone on a fresh instance (data directory reset) at `b1e9d528`; teacher and
  admin ran together and then in a second instance at `0ae0339b`. Their pull/usage rows are the ones quoted for
  them.
- **The paid spacing was exercised with the test clock**, not wall-clock minutes, at the coordinator's request:
  `POST /__test__/clock/offset` plus `POST /__test__/jobs/run-due`. The 294 s gap between the admin dry submits is
  the real scheduled spacing, not a shortened one.
- **Browser Use cloud sessions still stop immediately** (`status: stopped`, `cdpUrl: null`), so filling ran in
  local Chromium. The brief allows this when Browser Use is unavailable; no Browser Use spend was incurred.
- **Review answers** are ordinary owner answers typed through the real Review forms (city, province, ZIP,
  nationality, gender, how-heard, hybrid attendance, work authorization). The harness picks plausible values; a
  card whose question comes back was skipped, which is the product behaviour described in #789.
- Screenshots are light at 390 and 1280; the Matches screen also has a dark pair. The app keeps its theme in
  `localStorage` and reads the OS setting only on mount, so earlier `-dark` captures that changed the scheme after
  load rendered light; the swe pair here is captured in a fresh dark-scheme context and is genuinely dark.
- Renders come from the real pages, not canvas boards.

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
