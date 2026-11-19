# Overture v2 — grill brief and context pack

Hand this file to a senior architecture agent and run a grilling session with it. It is self-contained:
everything decided so far, everything that conflicts, and the questions still open.

Owner: one engineer (Ottawa), building for himself first and as a SaaS. Wants to be pushed back on.
Style: plain language, no hype, no emoji. Challenge the owner when he is wrong; do not ask him to
supply the architecture you should be proposing.

---

## 1. How to use this brief

1. Read this file completely before asking anything.
2. Run the grill in rounds: ask the whole frontier of independent decisions per round, numbered, each
   with your recommended answer. Wait for answers, then recompute.
3. Record every decision with rationale and the rejected alternative. The output of the session is a
   decision record plus a spec, not a chat.
4. Do not act on code until the owner confirms the spec.
5. Facts are your job. Pointers are in §9. Do not ask the owner for anything you can look up.

---

## 2. What the product is

**Overture** finds job postings from ATS job APIs, scores them against the owner's resume, prepares each
application from the owner's own facts (answers, tailored cover letter, the unchanged resume PDF), and
submits it through the real ATS form using a cloud browser.

The promise: **high volume without lying.** Every factual answer traces to the owner's saved answers or
resume; the resume is never regenerated or restyled; every submission is auditable down to the exact
answers, letter and file that went out. Anything uncertain becomes a review item rather than a guess.

Core objects: Posting, Application, Review item (the canvas calls it a Hold), stage, answer bank,
resume, cover letter, credit.

Stages: `Hold → Applied → Screening → Interviewing → Offer → Closed`.

---

## 3. Non-negotiable constraints (owner-stated)

- **Multi-tenant SaaS from day one**, public signup, billing live. No stubbed mode.
- **Mobile is first-class.** "Damn near a mobile app." Drag-and-drop must work, or have a proper mobile
  alternative. 390px is a design width, not an afterthought.
- **oxlint**, not ESLint, with every applicable rule on.
- **No unit tests.** End-to-end only, covering essentially every flow. A handful (≤6) of unit files may
  survive; the rest die with the old code.
- **All comments stripped** from salvaged code. All old markdown deleted.
- **Never hand-roll UI.** shadcn/ui first, then 21st.dev. Compose, do not invent.
- **Simple beats clever.** The owner's own words: "even I don't know what that means" about the old
  Active/Standby/Rehearsal vocabulary. One Start/Pause switch, no modes.
- **The canvas is the visual guide, not scripture.** Where it conflicts with product truth, product truth
  wins and the canvas gets fixed.
- Deployment: Fly.io, one region (yyz), SQLite on a volume. Cloudflare free tier for edge only.

---

## 4. Recovered history (the decisions that started this)

Source: Antigravity session `8f9ec262-50e1-445f-80a6-99eab6ce1215` (2026-11-18, 276 steps). Full verbatim
digest: `/tmp/keep-decisions.md`.

**Audit of v1:** 46,491 lines of source plus ~50,000 lines of unit tests (~96,000 total), **57 SQLite
tables across 3 databases**, an 830-line `if (pathname === …)` chain instead of a router with no schema
validation, and background work held in in-memory `Promise` chains that vanish on every deploy.

**Keep (~15%, advisory):** five ATS clients (Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee) plus
22,796 seed boards; Playwright stealth and proxy core; ARIA form executor with plan cache; Kanban
mechanics; AES-256-GCM secrets; posting-guard (prompt injection); the 6-digit email-code extractor; the
12 universal application facts. Strip comments, update to v2 standards.

**Burn:** all 57 tables and the 3-database layout, the applications module maze, Shadow Mode and Rehearsal
Mode, hiring.cafe, BYOK keys, `src/setup/`, 60+ markdown files, ~118 unit-test files.

**Why v1 generated so many review items** (must not recur):
1. Shadow/Rehearsal deliberately held the first five applications per ATS.
2. Blank **optional** fields failed the checklist (`checklist.ts:36`), so optional questions blocked sends.
3. A hardcoded `/\bTN\b/` regex rejected any application mentioning TN — including residents of Tennessee.
4. Onboarding never asked the 12 universal questions, so forms halted mid-run to ask basics.

---

## 5. Architecture already decided

- **Stack:** Bun + strict TypeScript + **Hono** (typed router) + **Zod** on every route and webhook;
  `bun:sqlite`; **Vite 8** (Rolldown + Oxc) + **React 19** + **Tailwind v4** + **shadcn/ui** + **21st.dev**.
  No Go/Rust: the bottleneck is I/O (LLM, Chrome, Stripe), and Bun's native SQLite beats cgo.
- **Router:** React Router 7, library mode. Vite does not provide routing; hand-rolling was rejected.
  All view state (filters, tabs, open sheet) lives in Zod-typed search params.
- **Folders:** `src/{shared,server,runner,web}`. The names `brain` and `hands` are retired.
- **Modules:** six deep modules — `auth`, `billing`, `catalog`, `pipeline`, `dispatch`, `inbox` — each
  with the "3 AM" safeguards (idempotency, crash recovery, explicit state, observable failure).
- **Queue:** durable `bg_jobs` table in the same SQLite file. Atomic claim, retry, graceful `SIGTERM`,
  dead-letter visibility. Not Cloudflare Durable Objects.
- **Realtime:** one authenticated `GET /api/events` SSE stream per tab. No polling timers.
- **Credits:** append-only double-entry `credit_ledger`; **reserve → commit → release**. A crash, lease
  timeout, closed posting or review item releases the reservation, so a broken site never costs a credit.
- **Dispatch (formerly runner-gateway):** three private endpoints behind `RUNNER_TOKEN` — next ready
  application (+ user cookies and proxy city), fetch that user's resume, report result.
- **PDF:** `unpdf` for text and column boxes; one multimodal LLM call only as fallback for scanned or
  multi-column resumes.
- **Search:** SQLite FTS5 (`postings`, `answers`, `messages`), one `/api/search` feeding both the ⌘K
  palette and a mobile results page; fuzzy in-memory matching for commands; no LLM; target <50 ms.
- **Live Tab:** CDP `Page.startScreencast` over WebSocket, input events back via CDP, JPEG frames as
  fallback, pinch-zoom on phone (a 1280×800 page at 390px is unreadable for a CAPTCHA).
- **Taxonomy:** derive labels from the ATS-supplied tags in the posting data, **in code, no LLM**. The LLM
  is only for application answers, cover letters and resume parsing. Every posting must land in buckets so
  onboarding can show relevant jobs immediately.
- **Edge:** Cloudflare free tier only — WAF/CDN, `*@apply.<domain>` inbound email, R2 hourly SQLite backups,
  Turnstile, Web Analytics. Database and job scanner stay on Fly (D1 bills per row read).
- **Observability:** OpenTelemetry → Grafana Cloud free tier in production; docker-compose LGTM locally.
  No `#/admin` page.
- **CI:** under two minutes. oxlint + typecheck + build + sharded Playwright e2e in parallel, gating
  `flyctl deploy --remote-only` on `main`.

---

## 6. Design state

- **Canvas artifact:** <https://claude.ai/artifact/P3aiZsEXkoUKBrknvvBNJJ> — 115 boards across 9 pages,
  published as version 84. Local preview: <http://devbox:8099/>.
- **Visual world:** "warm obsidian / stippled paper" — cream `#F3EEE4`, ink `#151311`, card `#FBF8F2`,
  Ember accent `#D2561F`, hold red `#8E3A2C`, ok green `#3F6B52`; dark ground `#191714`, card `#221F1C`.
- **Type:** Instrument Serif (the owner's own words only — answers, letters, job titles), Plus Jakarta Sans
  (chrome), IBM Plex Mono (machine fact — timestamps, ATS, scores, file names).
- **Semantic rule that carries the brand:** serif = the user speaking, sans = the product speaking, mono =
  what the machine observed. Orange appears only when Overture acts.
- **Critique baseline:** 28/40 (Good, lower band). Craft is ahead of information architecture.
- **Recently fixed:** stray review text on the job board; internal "Cloud runner" vocabulary and an exposed
  link token; phone sheet covering the tab bar; 19px inputs; contrast below 4.5:1 on five boards; Answer
  Bank had three doors; onboarding's unexplained disabled Continue; Settings claiming 30-day company limit
  (now 7) and `00:00` active hours; missing proof surfaces — two new boards now show the Questions tab
  (11 answers with provenance) and the Cover letter & resume tab (PDF unchanged, letter claims mapped).
- **Known canvas conflict:** the sign-in board was rebuilt as Google-only, but the owner has since chosen
  **better-auth with Google, LinkedIn, email+password and magic link**. The board must be redrawn; the
  canvas is a guide, not the final say.

---

## 7. Product decisions taken in this session

| Area | Decision |
|---|---|
| Launch shape | Real multi-tenant SaaS, billing live, "bells and whistles" |
| Tenancy | One account = one person, no teams; public signup; Turnstile; email verification before any application runs; 3 one-time trial credits; card fingerprinting on first purchase |
| Data | Fresh schema. One-time importer only for: resume PDF, 66 answer-bank entries, 449 learned answers, board seeds. Application history abandoned |
| Auth | better-auth: Google, LinkedIn, email+password, magic link. Verify email before linking accounts (v1 had an account-takeover path there) |
| Sources | hiring.cafe deleted; submit through the five underlying ATS boards |
| Salvage | 15% is a guideline, not a quota. Comments, tests and docs stripped. Kanban mechanics may be rebuilt. Implementation judgment delegated to the builder |
| Search | SQLite FTS5 now, behind an interface so Postgres/pgvector can replace it |
| Taxonomy | Code, from ATS tags; no LLM at ingest |
| Navigation | Home · Job Board · Needs Review · Inbox · Activity · Profile · Settings (hover submenu) |
| Control | One Start/Pause switch. No Rehearsal, no Live/Standby, no Shadow Mode |
| Discovery | Scheduled server-side delta sweeps, abstracted from the user; replies parsed to move cards automatically |
| Credits | 1 credit = 1 submitted application; reserve/commit/release; daily reset at the user's local midnight |

---

## 8. Proposed schema (needs your scrutiny — hardest thing to change later)

23 tables in one `app.sqlite`. FTS5 virtual tables are not counted.

**auth (better-auth):** `user`, `session`, `account`, `verification`

**billing:** `subscriptions` (Stripe state + plan limits), `credit_ledger` (append-only, double-entry),
`stripe_events` (idempotency), `used_card_fingerprints` (trial-abuse prevention)

**catalog:** `companies` (canonical identity, domain, logo), `company_boards` (etag, last_modified,
content_hash, backoff, connector), `postings` (normalised fields, salary, primary bucket, FTS5-indexed),
`posting_tags` (many-to-many buckets: function, seniority, location, remote, skills)

**profile:** `user_profiles` (target tags, locations, sending preferences, timezone), `resume_files`
(versioned uploads: hash, pages, uploaded_at, current flag), `saved_answers` (the 12 universal facts +
learned answers, with source and revision), `browser_sessions` (encrypted storage state, proxy session,
status, lease)

**pipeline:** `applications` (one explicit status column + stage), `application_snapshots` (immutable:
answers + source + revision, letter text, resume hash, ATS payload), `bg_jobs` (durable queue),
`emails` (inbound and outbound), `notifications`, `events` (SSE outbox + audit trail),
`posting_user_state` (per-user saved/hidden/dismissed without an application)

Open questions for you: is `events` overloaded as both SSE outbox and audit log? Should timeline entries
live in their own table? Is a per-user `usage_counters` table worth it for daily caps, or is the ledger
enough? Does `applications` need a separate `application_stage_history` for the Kanban timeline?

---

## 9. Facts and pointers

- Canvas: <https://claude.ai/artifact/P3aiZsEXkoUKBrknvvBNJJ> · local preview <http://devbox:8099/>
- Boards on disk: `/tmp/overture-canvas/publish/project/` (115 `.dc.html` files + `canvas.json`).
  Individual boards render at `http://localhost:8099/project/<file>.dc.html`, `?dark=1` for dark.
- v1 code: `/home/ubuntu/orca/workspaces/ai-auto-apply/sole` (this worktree). Server modules under
  `src/brain/`, the web layer under `src/brain/web/` (13 pages, to be deleted), tests under `tests/e2e/`.
- v1 database reality: 57 tables across 3 SQLite files; the audit above is reproducible from
  `src/brain/migrations.ts` and friends.
- Prior decision record: `docs/v2/DECISIONS.md`. Verbatim transcript digest: `/tmp/keep-decisions.md`.
- Critique with scores and measured contrast: `.impeccable/critique/2026-11-19T05-36-41Z__project.md`.
- Design system reference: the canvas boards `Main.dc.html`, `ds-2.dc.html`, `ds-3.dc.html`.
- Old docs (`DESIGN.md`, `PRODUCT.md`, `GLOSSARY.md`, `docs/`) are **dead** and will be deleted. Do not
  treat them as truth; the recovered thread and this brief are the truth. Where you need a definition the
  brief lacks, ask.

---

## 10. Open decisions for the grill

**Round 2 (partly answered):**
1. ~~Tenancy~~ — answered: one person per account, public signup, abuse controls.
2. **Schema** — §8 above; scrutinise freely.
3. **Tiers, prices, credit grants.** Proposal: Prelude (3 one-time trial credits), Sonata ($20/mo, 10/day),
   Concerto ($45/mo, 30/day), annual = 2 months free. No overages; queue waits for tomorrow.
4. **Runner hosting, proxy, risk.** Proposal: Fly machine pool (2–4 concurrent browsers), per-user
   ephemeral profiles, residential proxy vendor with sticky sessions, WARP as dev fallback, per-ATS kill
   switch and rate limits. Needs a cost and legal answer.
5. **Observability hosting.** Proposal: Grafana Cloud free via OTLP; local LGTM in docker.
6. **Deletion mechanics.** Proposal: one burn commit after the spec, deleting all old markdown, the whole
   web layer, comments, and 118 of 124 unit files; git history kept.
7. **E2E and visual scope.** Proposal: 12 flows + route reachability + 36 visual snapshots
   (6 screens × 3 widths × 2 themes), sharded, failing the build.
8. **Email transport.** Proposal: Resend for outbound, Cloudflare Email Routing for inbound aliases.
9. **Postgres/pgvector path.** Proposal: typed repositories + a `SearchIndex` interface; no SQLite-only
   SQL in domain code.
10. **Capacity behaviour.** Proposal: visible queue with position and ETA, per-user fairness, no credit
    charged until sent.

**Rounds 3+ (not yet discussed):**
- Onboarding: the 12 universal facts, resume upload, tag/location selection, and how many steps.
- Scoring: how match score is computed, thresholds, and what makes a "strong match".
- Cover letters: model, prompt, length, and the cost per application.
- Notifications: email digest, Telegram, push — which exist in v1.
- Account lifecycle: export, delete, sign out all devices, data retention.
- Accessibility and performance budgets; anything the old app failed.
- Legal: automating ATS submissions, per-site consent, rate limits, GDPR-ish deletion.
- Ticket split and parallelisation plan once the spec exists.

---

## 11. Output contract

When the grill concludes, produce:

1. **Decision record** — every decision, rationale, rejected alternative, still-open item.
2. **`SPEC.md`** — product truth, entities, state machines, API surface, pages, flows, error states,
   limits, and the acceptance criteria per flow.
3. **Ticket list** — vertical slices, each independently shippable and testable end-to-end, sized for one
   worker, with its e2e test named in the ticket.
4. **Burn list** — exact paths to delete, in order, with what replaces each.
5. **Open risks** — with the decision that would resolve each.

Do not write code in this session. The deliverable is a spec good enough that a worker can implement a
slice without asking a product question.
