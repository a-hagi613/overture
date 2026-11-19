# v2 decision record (grill)

Living record of the decisions that define Overture v2. Every answer is recorded here with rationale and
the alternatives that were rejected, so the spec and tickets cite this file rather than a chat.

Status: **near-final** — started 2026-11-19; Session 4 (S13) reconciled the spec with the owner the same day.
New decisions are appended as rounds. Rows before Session 3 are history.

Inputs:
- Recovered prior decisions: `/tmp/keep-decisions.md` (Antigravity session `8f9ec262`, 2026-11-18)
- Design source: canvas artifact `P3aiZsEXkoUKBrknvvBNJJ` (115 boards, v0.2 Ember / World 5)
- Critique baseline: `.impeccable/critique/2026-11-19T05-36-41Z__project.md` (28/40)
- Current code: `src/brain/web` (to be replaced), server modules (partly salvaged)

## Decisions already locked by the prior session

| Topic | Decision |
|---|---|
| Stack | Bun + strict TypeScript + Hono + Zod; `bun:sqlite`; Vite + React 19 + Tailwind v4 + shadcn/ui + 21st.dev |
| Layout | `src/{shared,server,runner,web}`; `brain`/`hands` names retired |
| Data | one `app.sqlite`, ~14 normalised tables, FTS5 on postings |
| Queue | durable `bg_jobs` table in SQLite (not Durable Objects) |
| Realtime | one `/api/events` SSE stream per tab |
| Credits | append-only `credit_ledger`, reserve → commit → release |
| Edge | Cloudflare free tier only: WAF/CDN, `@apply.<domain>` mail worker, R2 backups, Turnstile, Web Analytics |
| Lint | oxlint replaces ESLint, all applicable rules |
| Tests | unit tests deleted (<5% kept), end-to-end for essentially every flow |
| CI | under 2 minutes, parallel jobs, gates Fly deploy |
| Nav | Home · Job Board · Needs Review · Inbox · Activity · Profile · Settings (hover submenu) |
| Control | one Start/Pause auto-apply switch; no Rehearsal/Live/Standby |
| Discovery | server-side scheduled delta sweeps, abstracted from the user |
| Brand | Overture; warm obsidian / stippled paper; Instrument Serif + Plus Jakarta Sans |
| Modules | six deep modules — `auth`, `billing`, `catalog`, `pipeline`, `dispatch` (formerly runner-gateway), `inbox` — each with the four "3 AM" safeguards |
| Build tool | Vite 8 (Rolldown + Oxc) + React 19 |
| Unit tests | 6 of 124 files kept (<5%); the rest deleted, along with all comments in salvaged code |
| E2E/CI | sharded Playwright with reachability tests, under 2 minutes, gates deploy |

## Round 1 — decided 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| R1-01 | **Real multi-tenant SaaS from day one**, billing live, no stubbed mode | "Bells and whistles out of the box"; every codebase doc is abandoned, this record is the new source of truth |
| R1-02 | **Fresh schema**; one-time importer for resume PDF, 66 Answer Bank entries, 449 learned answers, board seeds | old 57-table state machine no longer exists; application history abandoned |
| R1-03 | **better-auth with Google, LinkedIn, email+password and magic link**, configured correctly | supersedes the canvas's Google-only sign-in; the canvas is a guide, not the final say, and its sign-in board will be updated |
| R1-04 | **Delete hiring.cafe**; submit through the underlying boards | CAPTCHA friction; it aggregated boards already ingested directly |
| R1-05 | **15% is a guideline, not a quota.** Salvage list is advisory; comments, tests and docs stripped; Kanban mechanics rebuilt if the new system does it better; implementation judgment delegated | overwrite, not migration |
| R1-06 | **Routing is not a Vite feature.** Vite is build-only; use **React Router 7 (library mode)** with Zod-typed search params | hand-rolling nested routes/scroll restoration rejected; TanStack Router adds a compiler plugin for little gain here |
| R1-07 | **SQLite FTS5** for search now, with a repository boundary that allows Postgres/pgvector later | no LLM in the search path |
| R1-08 | **Live Tab: CDP `Page.startScreencast` over WebSocket**, input events back via CDP, JPEG frames as fallback, pinch-zoom on phone | polling screenshots rejected as the primary transport |
| R1-09 | **Taxonomy from the ATS-supplied labels/tags already in the posting data, in code — no LLM.** LLM only for application answers, resume and cover letter; PDF text via `unpdf` | ingestion must be cheap and deterministic; users see tagged jobs before onboarding ends |

## Round 2 — pending

| # | Question |
|---|---|
| R2-01 | Tenancy model: users only, or teams/workspaces? |
| R2-02 | Final table list, including `application_snapshots`, `notifications`, `events` |
| R2-03 | Tier names, prices, credit grants |
| R2-04 | Runner hosting, proxy provider, ATS automation risk |
| R2-05 | Observability hosting and cost |
| R2-06 | Deletion mechanics and how docs are replaced |
| R2-07 | E2E flow list and visual-regression scope |
| R2-08 | Email transport: Resend vs Cloudflare |
| R2-09 | Postgres/pgvector portability constraints |
| R2-10 | Runner concurrency and queue behaviour under load |

## Decision log

(answers appended here as rounds complete)

## Corroboration (search worker, 2026-11-19)

An independent read-only search across every harness confirmed the transcript and the decisions above:
session title "Sub-agent Orchestration And CI Refactoring", cwd `.../ai-auto-apply/spookfish`,
2026-11-18 15:16–20:17 ET, 276 steps; the only one of 40 Antigravity DBs containing `oxlint`. No `oxlint`
exists in any Claude transcript, and `~/.codex/sessions` does not exist. Full digest with verbatim quotes:
`/tmp/keep-decisions.md` (24.8 KB).

It also lists items the original session left unresolved, now carried into Round 2:

- email transport: Resend vs Cloudflare Email — undecided
- Docling vs `unpdf` — the thread leaned `unpdf`, never closed
- Kubernetes vs plain Fly — undecided
- `#/admin` vs LGTM-only — undecided
- the 15%/85% vs 5–10%/90% ratio discrepancy
- "no unit tests" vs the 6 files actually kept


## Session 2 (Claude Opus 5.5, tiamat worktree) — started 2026-11-19

Facts checked before Round 2, so the questions do not rest on the brief alone:

- The "12 universal facts" are not 12. v1 `src/brain/onboarding/memory-base.ts` defines about 30 keys: identity (7),
  work authorization (3), logistics (3), compensation (2), experience (3), education (3), EEO (5+), and more.
- v1 Match Score is an LLM call per Posting (DeepSeek, about $0.0006 each, 75/day quota). The brief says the LLM is
  used only for answers, cover letters and resume parsing. These conflict; Round 2 Q6 resolves it.
- v1 also ships a Workday client (`src/brain/sources/workday.ts`), absent from the keep list.
- v1 Inbox reads mail through Gmail API and IMAP; the brief replaces this with `*@apply.<domain>` aliases.
- "Hold" names both the first Kanban stage and the review item. Round 2 Q3 resolves it.

### Round 2 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| R2-02 | **Fully autonomous.** Start submits any Posting that clears the score threshold and has every answer traced to owner data; daily cap, per-company cooldown, 60-day repost guard; uncertainty becomes a Review | per-application approval queue rejected: turns the product into a chore, v1 Holds piled up |
| R2-03 | **Stages: Queued → Applied → Screening → Interviewing → Offer → Closed.** Review item is a **Review**; nav label "Needs Review". "Hold" retired everywhere | "Hold" named both a stage and a review item. Overrides the old CLAUDE.md fixed-columns rule |
| R2-01 | **Global market**, not Canada/US only | owner wants revenue worldwide; tax, privacy and country-aware facts follow (Round 3) |
| R2-04 | **Per-user `@apply.<domain>` alias on applications rejected** | owner: looks suspicious to employers. Gmail restricted-scope OAuth also rejected for launch (CASA Tier 2, about $540–4,500/yr, 2–6 weeks). Cloudflare Email Routing caps destination addresses at 200/account, so forwarding to real inboxes does not scale either. Replacement: Round 3 |
| R2-05 | **Runner cost must fall well below $0.10/application** while keeping IPs undetected and submits successful | owner rejects $0.10. Target and levers: Round 3 |
| R2-06 | **Minimise LLM use** per application; correctness and non-suspicious output still win | mechanism: Round 3 |
| R2-07 | **Four offerings:** free trial (3 one-time, card required), 7-day, 1-month, 1-year. **One credit = one Application**; user-facing word is "applications" | builder picks prices and grants (Round 3) |
| R2-08 | **Litestream continuous replication to R2 + nightly snapshot (30 days)**, restore drill tested | hourly snapshot alone rejected: up to 1 h of ledger and Stripe loss |
| R2-09 | **Cheapest correct deployment, built to scale out**: one Fly server machine (single Bun process, WAL SQLite) + on-demand runner machines over dispatch HTTP; repositories, queue and search behind interfaces so Postgres and more machines can replace them | premature HA rejected; foundations must not need a rewrite to scale |
| R2-10 | **Five primary destinations** (Home, Board, Review, Inbox, Profile); Settings via avatar/Profile; Activity folds into Home. **Desktop hover submenus are allowed** for sub-sections so pages are not crammed with nested tabs; phone gets the same sub-sections as list pages | 7 top-level items rejected: does not fit a phone tab bar |
| R2-11 | **Maximise ATS coverage**: every simple ATS (public posting feed, no candidate account, no CAPTCHA by default) plus aggregators for discovery; research required | Workday-class (account per employer) excluded |
| R2-12 | **E2E is the gold standard** for essentially every scenario; unit tests only for the critical invariants, no more than 5–10% of the codebase; CI must stay fast (strategy in spec) | zero unit tests rejected for ledger/crypto invariants |
| R2-13 | **Legal and security posture is top priority**: store as little user data as possible, protect the rest | design: Round 3 |
| R2-14 | **Owner-only admin dashboard** with full support powers (replay failed actions, suspend users, refunds, kill switches), alongside full LGTM observability | CLI-only support rejected by owner |

### Round 3 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| R3-01 | **Gmail forwarding-filter intake rejected** | owner: convoluted UX. Replacement in Round 4 |
| R3-02 | **Stripe Managed Payments** (merchant of record) | global VAT/GST handled; keeps Stripe API and card fingerprints. Fee: +3.5% on top of 2.9% + 30¢ (+1.5% international cards). Eligibility for a Canadian business still to confirm |
| R3-03 | **Three paid shapes only: trial, week, month. No annual.** Daily cap 10. Month ≤ 300 | owner: 600/month and 40/day too generous; nobody searches a year. Exact prices Round 4 |
| R3-04 | **LLM behind one port**; OpenCode Go DeepSeek allowed for local dev only; production uses a real API (Claude Haiku 5.5 or DeepSeek) | OpenCode Go caps usage at $60/month |
| R3-05 | **Cost model with best / typical / worst case required** before prices are final | owner wants margin |
| R3-06 | **Two-stage matching** (code filter → cached LLM score on survivors) | accepted |
| R3-07 | **Question policy**: factual never generated; open text written from resume + posting and sent; unknown optional fields left blank, never blocking | accepted |
| R3-08 | **Data protection**: per-user data keys under a master key, crypto-shredding on delete, EEO opt-in, no ATS passwords, no PII in logs, export. **Browser sessions are kept** (per-user). **Inbox keeps job mail**; only unrelated mail is never stored | owner corrected the earlier "delete raw mail" and "drop browser_sessions" proposals |
| R3-09 | **Global, English-only UI, data on Fly yyz for now**; infrastructure can move later | widest net |
| R3-10 | **Owner admin with more power than proposed**, locked down so no one else can reach it | details Round 4 |
| R3-11 | **No laptop and no Tailscale in the product path.** All submissions run in the cloud through residential proxies | owner |
| R3-12 | **ATS research table required**: least friction, no CAPTCHA, works out of the box; drop Workday-class and anything unusable | Round 4 |
| R3-13 | **Answer bank must grow from every new question seen**, so the pipeline blocks less and runs truly autonomously | mechanism Round 4 |

Facts gathered for Round 4: Claude Haiku 5.5 is $0.10 / $0.50 per M tokens (cache reads ~$0.01), cheaper than DeepSeek V4.1 Flash at peak ($0.30 / $1.20). Greenhouse job boards run invisible reCAPTCHA; a low score triggers an emailed code or a visible captcha, with per-board sensitivity. Recruitee lets employers add a captcha. Gmail restricted scopes in testing mode: 100 users lifetime cap, 7-day refresh tokens; CASA Tier 2 about $540–720/yr. Fly shared-cpu-2x 2 GB ≈ $0.0000051/s. IPRoyal $4.90–7/GB below 50 GB.

### Round 4 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| R4-01 | **No access to the user's personal mailbox, and no CASA fee.** Gmail/Outlook OAuth rejected. The email feature must stay; solution Round 5 | owner: reading personal mail is unacceptable; CASA cost refused |
| R4-02 | **Week and Month both renew** (weekly / monthly). Trial free, 3 applications, card verified. Week $12 / 70; Month $35 / 300; 10/day cap | owner accepted the price math; weekly also recurring |
| R4-03 | **Production LLM: Claude Haiku 5.5 only.** Local dev: OpenCode Go DeepSeek | owner |
| R4-04 | **Design for the best case** (~$0.0025/application) as the norm, not the typical | owner |
| R4-05 | **Proxy vendor chosen by research and a measured bake-off**, not IPRoyal by default; cheapest reliable undetected wins | largest variable cost |
| R4-06 | **Shared question catalog + pre-flight questions from ATS APIs + v1 answer import** | accepted |
| R4-07 | **One persistent encrypted browser profile per user**, same identity and region | accepted |
| R4-08 | **Admin**: Cloudflare Access subdomain + owner ID + passkey + off-box audit; full powers incl. act-as, reveal, read-only SQL | accepted |
| R4-09 | **Fixtures captured by the cloud runner via residential proxy**; devbox reaches ATS sites only through that proxy | accepted; devbox CLAUDE.md rule to be amended |
| R4-10 | **ATS tiers as tabled; probe of 20 forms per ATS decides promotion** | accepted |
| R4-11 | **PWA with web push + email**; no Telegram, no native app | accepted; email still to settle |
| R4-12 | **Performance and accessibility budgets as proposed, enforced in CI**; CI speed strategy to be specified (oxlint all rules, no comments, no unit tests beyond invariants, fastest possible e2e) | accepted |
| R4-13 | **≤2 attempts per posting, never charged on failure, posting re-checked before the runner starts** | accepted |

### Round 5 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| R5-01 | **Overture-hosted mailbox on a shared domain rejected** | owner: many applicants sharing one unfamiliar domain is still a red flag. Replacement Round 6 |
| R5-02 | **Proxy bake-off**: static ISP per user vs Evomi vs DataImpulse, 20 forms/ATS, winner = lowest cost per completed application | accepted |
| R5-03 | **Best-case cost levers** (pre-flight questions, closed check, ≥90% plan-cache hits, 1 MB page cap, scoring only what can be sent, suspended runner machines, per-attempt cost recorded) | accepted |
| R5-04 | **CI**: oxlint all categories + type-aware, comment ban script, oxfmt, tsgo, Vite 8, ≤6 unit files, Playwright with per-worker server + template SQLite copy, fakes for every external, API-seeded auth, no sleeps, duration sharding, affected-only on PRs, zero retries, pinned Docker for visuals; PR < 2 min, main < 4 min incl. deploy | accepted |
| R5-05 | **Status vs Stage split**; reserve at sending, commit at sent, release otherwise; email/auto moves only forward, undoable, never after a manual drag; failed/skipped off the Board | accepted |
| R5-06 | **Five-step onboarding**, ~12 required facts, card at Start, first three applications real | accepted (step 5 address part depends on R6-01) |

### Round 6 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| R6-01 | **Email not dropped yet.** Owner wants a free, scalable, undetectable route. Candidate in Round 7: user-owned dedicated job-search mailbox over IMAP app password (Gmail, Yahoo, iCloud, Fastmail, Zoho) + Microsoft OAuth for Outlook | shared-domain mailbox rejected (R5-01); Gmail OAuth/CASA rejected (R4-01) |
| R6-02 | **Resend** sends Overture's own mail (verification, magic links, receipts, digest) | owner already onboarded; free 3k/month |
| R6-03 | **Schema accepted in principle; full SQL review required** | owner asked for a double/triple check; revised schema Round 7 |
| R6-04 | **Review is its own object**, about a question or an application; kinds question/code/captcha/login/other; grouped by jobs unlocked | accepted |

### Round 7 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| R7-01 | **Dedicated job-search mailbox with app password rejected** | owner: hacky, too much friction |
| R7-02 | **Revised schema accepted**: true double-entry ledger (txn_id, zero-sum trigger), grant periods with expiry, `profiles.running`/`pause_reason`, `board_position`, `question_variants`, browser-profile lease, `stripe_customer_id`, `dedupe_key`, FTS5 on short fields only with gzipped descriptions purged 90 days after close, immutable snapshots, 7-day timezone change limit, HMAC card fingerprints surviving deletion, STRICT tables, WAL + synchronous=FULL, cascade deletes, retention windows. Mail tables pending R8-01. Full DDL goes in SPEC.md | owner asked for a thorough SQL review; mistakes listed in Round 6 |
| R7-03 | **Owner needs the email flow explained end to end before deciding** | onboarding step 5 waits on it |

Facts for Round 8: Aplyr (a competing auto-apply tool) offers the same two options we rejected, connected Gmail or its own inbox domain. Greenhouse codes are single-use, time-limited, and a new one can be requested after 10 minutes. iOS 17+ Safari autofills one-time codes from Apple Mail into `autocomplete="one-time-code"` fields; iOS 26 widens this to codes from other apps. iOS does not support the Web Share Target API, so an installed PWA cannot receive shares on iPhone. The Gmail add-on scope `gmail.addons.current.message.readonly` is classed sensitive (free verification, no CASA) but only reads the message the user has open.

### Round 8 — direction given 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| R8-01 | **Reverses R4-01: connect the user's real Gmail via OAuth.** Run unverified while under Google's 100-user cap, pay for CASA (~$540–720/yr) once growth justifies it | owner: least friction overall; the "your email stays yours" handoff design (Round 7) becomes the fallback, not the primary. Details pending Round 8 answers |

### Round 9 — direction given 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| R9-01 | **Reverses R5-01 and R8-01: Overture-hosted job-search mailboxes on a neutral domain go on applications.** Gmail/Outlook OAuth not built at launch; kept as plan B | owner: best overall trade-off (free, no friction, full automation, no access to personal mail). Conditions and safeguards pending Round 9 answers |

### Round 9 — answered 2026-11-19 (all accepted)

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| R9-02 | **The mail domain is openly Overture's**: neutral name, public home page saying it is Overture's private job-search email (like duck.com / privaterelay). Owner buys it now so it ages; shortlist with availability in the spec | hiding the owner of the domain rejected as deceptive |
| R9-03 | **Domain reputation**: SPF/DKIM/DMARC at reject; sending limited to replies in employer-started threads, ≤20/day per user; every address a real mailbox; no rotating or extra domains; address receives for 12 months after cancel | protects every user from one blocklisting |
| R9-04 | **Per-employer and per-ATS monitoring** (submit failures, code rate, reply rate vs real-email users). Blocked employer → that employer switches to **real-email mode** (sign-in email, codes by push + Paste). Users may choose real-email mode globally. A falling domain reply rate triggers plan B (Gmail/Outlook connect) | measured risk with a fallback |
| R9-05 | **Admin-tunable crowd limit**: start at 20 Overture applicants per posting, 50 per employer per week; overflow applies in real-email mode | also protects standing with ATSes |
| R9-06 | **Inbox returns**: five destinations Home, Board, Review, Inbox, Profile. Read, reply, attachments, invites; each message linked to its card. Schema: `mailboxes`, `messages` (38 tables). Inbound via Cloudflare Email Worker; outbound via Amazon SES | |
| R9-07 | **Onboarding step 5 = "Your job-search address"**: pick address, one-line explanation, notifications, consent, trial card, Start. Active hours only for real-email mode | |

### Round 10 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| R10-01 | **Auto-apply at score ≥ 50; "Strong match" badge at ≥ 80.** Queue is ordered by score, so with the 10/day cap the best matches always go first | owner; proposed 70/85 rejected. Same values as v1 defaults |
| R10-02 | Browsing via Home "Up next" + Search (Apply / Save / Hide); manual Apply below threshold allowed | accepted |
| R10-03 | Cover letters: only when the form has the field; ≤200 words; every claim mapped to a resume line, untraceable claims removed; voice sample in Profile; never edited after send | accepted |
| R10-04 | **Discovery: one initial full sweep (backfill) of every seed board, then continuous trickle** of new and changed postings using conditional requests, inside per-ATS rate limits. New postings match users automatically through their saved tags | owner; replaces fixed 2-hour / daily tiers |
| R10-05 | Per-user round-robin dispatch with queue position and ETA on Home | accepted |
| R10-06 | Mobile Board: dnd-kit touch (250 ms hold), one column per screen with swipe, stage buttons in the sheet, keyboard DnD on desktop | accepted |
| R10-07 | Grafana Cloud free tier via OTLP; local LGTM in Docker; alerts to the owner's phone | accepted |
| R10-08 | API surface as tabled (Hono + Zod, typed client, SSE, runner endpoints over Fly private network with short-lived signed tokens, signed idempotent webhooks, admin behind Cloudflare Access) | accepted |
| R10-09 | 28 e2e flows + reachability + axe on every page + 30 visual snapshots | accepted |
| R10-10 | Burn on a `v2` branch in one commit; CLAUDE.md/AGENTS.md rewritten; new Fly app; v1 app destroyed after a week of owner use | accepted |
| R10-11 | **Build orchestration: Claude Opus 5.5 (this session) is the orchestrator**; work fans out to parallel OpenCode DeepSeek V4.1 Flash workers (`opencode-go/deepseek-v4.1-flash#high`) in nested Orca worktrees. Impeccable design pass runs alongside | owner overrides the Gemini Neon orchestrator default for this project. Worker count pending R11-01 |

### Round 11 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| R11-01 | **Up to 6 workers in flight** (raises the devbox cap of 3 for this project). Workers run only affected tests locally; full e2e and builds run in GitHub Actions; one heavy local job at a time via a shared lock; no new worker while 15-min load > 8 | owner wants maximum parallelism; RAM (12 GB) is the limit, not the agents |
| R11-02 | Defaults without further questions: "Sign out all devices"; LLM limits $0.25/user/day and $10/day global (admin-tunable); `unpdf` first, Haiku 5.5 PDF fallback for scanned/multi-column resumes | nothing pointed elsewhere |

**Architecture frontier: empty as of 2026-11-19.** Next: impeccable design grill, codified the same way, then the output package (decision record, SPEC.md, tickets, burn list, risks).

## Session 3 (Claude Opus 5.5, tiamat) — re-grill from the top, started 2026-11-19

The owner reopened everything. R1–R11 above are **provisional evidence of intent**, not settled; a Session 3
decision supersedes any earlier row it touches. SPEC.md is written only from Session 3 decisions.

### Round S1 — foundations, answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| S1-01 | **Three gated milestones, multi-tenant data model from day one.** M1: the owner applies from the cloud end to end (discovery → match → prepare → cloud submit via proxy → Board), gated on a measured submit success rate. M2: invite-only beta (signup, onboarding, job-search address, Inbox, Review). M3: public with billing. Revenue is the goal: ledger tables exist from M1 and every M1/M2 choice must survive paid public use | supersedes R1-01 "billing live from day one": the unproven risk is cloud submission, not billing |
| S1-02 | **Two Fly apps from one repo.** `overture-web`: one always-on machine with the volume (Bun API, SPA, SSE, scheduler, queue, discovery). `overture-runner`: Chrome machines without a volume, started/stopped on demand through the Machines API, small pool (2–4 at launch), talking to web over 6PN with short-lived signed tokens; never touches SQLite. Cloudflare in front. All yyz. Devbox, the laptop, Tailscale and wireproxy are out of the product path entirely | one machine rejected: a Chrome leak would OOM the server and the database (v1 OOM'd at 512 MB without Chrome) |
| S1-03 | **Self-hosted headed Chrome (Xvfb) on the runner, `playwright-core` on Bun, behind a `BrowserProvider` port.** Researched managed browsers: Steel ≈ $0.08/browser-h + $6/GB proxy (Scale) and Browserbase ≈ $0.10–0.12/h + $10–12/GB come to ≈ $0.02–0.04 per application at ~3 min / ~3 MB, versus ≈ $0.005 self-hosted. Ours stays; a managed adapter is only added if the M1 bake-off shows ours detected more often | owner: use a managed option only if it is cheaper or clearly better; neither holds on price |
| S1-04 | **Proxy: cheapest rotating residential that measurably works**, sticky for at least one whole application (same IP from page load to submit), same city per user where the vendor allows. Candidates: Evomi (~$0.49–0.99/GB), DataImpulse (~$1/GB); static ISP only if rotating fails the gate. Images/fonts/media blocked. Fly IPs never reach an ATS form. "Undetected" cannot be guaranteed by anyone; it is measured (submit success, code/CAPTCHA rate per ATS) with per-ATS kill switches | owner: proxy is the largest variable cost, go bare minimum that gets the job done |
| S1-05 | **Devbox is a coding box only.** Nothing in the product runs there; fixtures are captured by a Fly runner machine and pulled down. The devbox "no live job-site traffic" rule stays unchanged | supersedes R4-09 |
| S1-06 | **Hosted job-search address per user, as their Inbox** (direction confirmed: Overture never touches personal mail). Delivery shape and reply scope: Round S2 | owner |
| S1-07 | **SQLite (WAL) on the web volume + Litestream to R2 + Drizzle ORM** for schema, migrations and typed queries; no SQLite-only SQL outside the search adapter | Postgres now rejected (cost, hop, no need at this scale); raw SQL without a schema tool rejected |
| S1-08 | **Vite 8 SPA served same-origin by the Bun/Hono server**; React Router 7 library mode; TanStack Query for server state; Hono typed RPC client; Tailwind v4 + shadcn/ui + 21st.dev; marketing/pricing pages prerendered to static HTML | SSR frameworks rejected for a logged-in app; a pure SPA rejected for public marketing pages |
| S1-09 | **Discovery fetches public ATS job feeds directly from `overture-web`**, conditional requests, per-ATS rate limits; the proxy is only for the runner | keeps proxy spend proportional to applications, not catalog size |

### Round S2 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| S2-00 | **Managed browsers get a deep primary-source study before S1-03/S1-04 are final**: CAPTCHA handling, built-in residential proxy, stealth, persistent profiles, live view with input, CDP access, cost per completed application. If one removes the major headaches and beats the self-hosted path on cost per completed application, it wins, possibly removing our own proxy. Report: `docs/v2/research/managed-browsers.md` | owner: willing to pay a small per-application fee if it is genuinely better and fits exactly |
| S2-01 | **Two-way Inbox in M2.** Inbound: Cloudflare Email Routing catch-all → Worker → signed POST to `overture-web`. Outbound: replies only, inside employer-started threads, ≤20/day/user, SPF/DKIM/DMARC reject. New-mail alert: push + optional sender/subject-only email to the personal address | receive-only rejected: replies from personal mail split the thread and stop card tracking |
| S2-02 | **Address generated, not picked**: `first.last@<domain>`; on collision a random number is appended after the last name. Domain neutral, openly Overture's, public explainer page, bought now; shortlist with availability to be brought | owner: no picker in onboarding |
| S2-03 | **Receive and keep everything sent to the address**, encrypted per user; nothing dropped as spam (anything sent there is almost certainly about an application). Attachments in R2, encrypted. Kept while the account exists; address receives 12 months after cancel; account deletion crypto-shreds | owner corrected the proposed spam drop |
| S2-04 | **Claude Haiku 5.5 in production behind `LlmPort`** ($0.10 / $0.50 per M tokens, verified 2026-11-19); OpenCode Go DeepSeek for local dev only; five uses only (score, open-text answers, cover letters, scanned-PDF fallback, new question → fact mapping); caps $0.25/user/day and $10/day global, admin-tunable | |
| S2-05 | **Score only what can be sent**; taxonomy built from what the sources actually supply, normalised, and offered as onboarding choices. Mechanism and threshold: Round S3 | owner: save LLM calls without hurting the experience |
| S2-06 | **M1 ATSes: Greenhouse, Lever, Ashby.** M2 adds SmartRecruiters, Recruitee, Workable, Personio after a 20-form probe each. Workday/iCIMS/Taleo out | |
| S2-07 | **No CAPTCHA solver now; left open.** Visible CAPTCHA → Review solved through the Live Tab (M1). Revisit with the managed-browser study and real CAPTCHA rates | owner: keep the path open if CAPTCHAs become a problem |
| S2-08 | **Question policy confirmed**: factual answers only from saved facts; open text from resume + posting; unknown optional left blank; unknown required factual → one Review that saves the fact and unblocks every queued application; shared question catalog (no answers); pre-flight questions from ATS APIs | |

### Round S3 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| S3-01 | **Normalised tags, sorted without per-posting LLM spend where possible**; census of the v1 catalog runs read-only on Fly, only aggregates leave. hiring.cafe as a bulk/delta data source is **under study** (`docs/v2/research/hiring-cafe.md`): bulk import + hourly delta, owner willing to solve CAPTCHAs on the laptop; falls back to our own taxonomy if unworkable | owner reopened R1-04 for discovery data only |
| S3-02 | **Lazy scoring**: code ranks every candidate; Haiku scores in rank order only until today's remaining slots are filled above threshold plus a small buffer; scores cached per (posting, resume version, preferences version); liveness re-check before the runner; jobs a user opens while browsing are scored on open | scoring every match rejected: ~15× the cost for no extra sends |
| S3-03 | **Auto-apply threshold 60 by default, user may lower to 50; Strong match at 80** | |
| S3-04 | **Amazon SES for outbound mail** (owner has an AWS account), replacing Resend; Cloudflare Email Routing stays for inbound. Credentials via a scoped IAM identity, never passwords in chat | owner: cheaper; one vendor details Round S4 |
| S3-05 | **Mail that fails SPF/DKIM/DMARC is kept and shown, labelled, but never used for code extraction or stage moves** | |
| S3-06 | **Address generation**: name as entered, diacritics folded, hyphens kept, other symbols dropped, non-Latin transliterated, 2–4 random digits on collision, shown once with "Looks good"; later change via support only | |
| S3-07 | **Sign-in: Google, LinkedIn, email + password, magic link** (owner's choice for a job product); scope and staging Round S4 | supersedes the S3 proposal to defer LinkedIn and password |
| S3-08 | **Plans kept as working prices** (Trial 3 free card-verified; Week $12/70 weekly; Month $35/300 monthly; 10/day), finalised in M3 from measured cost | |

### Round S4 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| S4-01 | **Tagging source still open**: owner prefers hiring.cafe's existing tags to avoid LLM cost; decided in S5 once `docs/v2/research/hiring-cafe.md` lands, with the measured LLM cost of our own tagging beside it | owner concern: LLM tagging cost |
| S4-02 | **All four sign-in methods from M1**: Google, LinkedIn (v1 LinkedIn app reused), email + password, magic link; verified-email-only linking, breached-password check, Turnstile + rate limits on login/signup; one e2e test per method | supersedes the staged proposal |
| S4-03 | **Amazon SES for all outbound** (Overture's own mail + Inbox replies), separate sending domains, `ca-central-1`, bounces/complaints via SNS → signed webhook with automatic suppression, production access requested once the mail domain exists | Resend dropped |
| S4-04 | **Onboarding in five steps accepted**, but the fact set is larger than 12: onboarding asks only what nearly every form needs; the rest is gathered in Profile after Start and through Reviews. Tiering: Round S5 | owner: more facts, without a longer onboarding |
| S4-05 | **Stages and statuses as R5-05** (Queued → Applied → Screening → Interviewing → Offer → Closed; status preparing / needs review / sending / sent / failed / skipped; failed/skipped only in Home activity; email moves forward-only, undoable, never over a manual drag) | |
| S4-06 | **Navigation as R2-10**: Home, Board, Review, Inbox, Profile; Settings from the avatar; desktop hover submenus; phone bottom tab bar | |
| S4-07 | **Data protection as R3-08**: per-user data keys under a Fly-secret master key, crypto-shred on delete, no PII in logs, export, EEO opt-in, no ATS passwords | |
| S4-08 | **Admin must show real user information** (who is on the app, what they uploaded), securely. Mechanism: Round S5 | owner |
| S4-09 | **Managed-browser study done** (`docs/v2/research/managed-browsers.md`): no vendor beats self-hosted on cost per application (self ≈ $0.0024–0.0045 typical; cheapest bundles $0.018–0.024); none removes the need for residential/ISP IPs against score-based reCAPTCHA; the real vendor benefit is ~5–8 engineer-weeks saved. Decision: Round S5 | |

### Round S5 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| S5-01 | **Owner keeps pursuing hiring.cafe data himself.** Research (`docs/v2/research/hiring-cafe.md`): their tags are GPT output; no API or licence; ToS personal-use only, no copying/redistribution; Cloudflare challenge on every page; hiQ v. LinkedIn and Century 21 v. Zoocasa show browse-wrap contract risk; CAPTCHA circumvention strengthens claims. Architecture treats it as optional enrichment, never a dependency (Round S6) | owner: "the best solution"; builder recommends against |
| S5-02 | **Browser choice is decided on success rate and complexity first, price second**; paying more is fine if not excessive | owner corrected the cost-first framing |
| S5-03 | **Fact tiers accepted**: Tier 1 onboarding (~14, mostly prefilled from the resume), Tier 2 Profile "Strengthen your profile" with unlock counts, Tier 3 asked only when a form needs it, then reused | |
| S5-04 | **Admin user visibility accepted**: user list with metadata visible; resume, facts, mail, application records and session view behind passkey + reason + ~15-min Reveal, logged off-box; EEO only aggregated; no card data; user-visible support access log. **Admin uses the same design system as the product** | owner |
| S5-05 | **Fully automated pipeline: users never handle CAPTCHAs or a live browser.** Mechanism Round S6 | owner rejects R1-08 / S2-07 user-facing Live Tab |

### Round S6 — decided 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| S6-01 | **Browser: Browser Use Cloud (managed), driven over CDP by our own Playwright executor. No in-house runner.** Pay as you go, $0.06/browser-hour + $5/GB residential, CAPTCHA solving included, residential proxy on by default (195+ countries), per-user profiles, SOC 2 Type II + DPA, best published stealth scores (incl. independent ScrapeOps 98/100), no plan minimum. ≈ $0.018/application typical, ≈ $540/month at 30k. **Kernel** is the fallback behind the same `BrowserProvider` port. Before launch: written confirmation from Browser Use that submitting job applications on users' behalf is permitted. Supersedes S1-03 | owner: success rate and least headache first. Kernel second: its AUP bans "bulk unsolicited form submission", no documented Canadian exits, mid-pack benchmarks. In-house rejected: 5–8 engineer-weeks + upkeep + we would still need a solver |
| S6-02 | **No proxy contract.** Browser Use's built-in residential proxy is used. Supersedes S1-04. Consequence for S1-02: **no `overture-runner` Fly app**; `overture-web` drives remote browsers over CDP | managed solution includes the proxy |
| S6-03 | **Fully automated challenge handling**: prevention (vendor stealth + residential IP + one profile per user) → email codes read from the job-search inbox → vendor CAPTCHA solver → still blocked = "Couldn't apply", nothing charged, one retry in a fresh session (≤2 attempts) → repeated failures auto-disable that ATS/employer and alert the owner. **No user-facing Live Tab**; admin embeds the vendor's live view and replay. Review has one kind: an unanswerable question | supersedes R1-08, S2-07 |
| S6-04 | **Real-email mode dropped.** An employer that filters the job-search domain is skipped and flagged; a falling domain reply rate alerts the owner | needed manual code pasting |
| S6-05 | **Tagging waits on the owner's hiring.cafe extraction attempt.** Overture ships an importer (file of postings + tags matched to ATS postings by apply URL; imported tags win). Builder does not build CAPTCHA/bot-protection bypass for it. If it does not pan out: rules → title model → Haiku Batch, $1/day cap + one-time ~$20 backfill | owner |
| S6-06 | **Notifications**: installable PWA with web push (iOS 16.4+ after home-screen install, prompted in onboarding) + daily SES digest (opt-out). No SMS, Telegram or native app | |
| S6-07 | **Full LGTM observability**: OpenTelemetry → Grafana Cloud (Loki, Grafana, Tempo, Mimir) in production, local LGTM in Docker for dev; no PII in telemetry; phone alerts on submit-rate drop per ATS, CAPTCHA/code rate, domain reply rate, queue backlog, spend caps, backup failure, machine health; automatic + admin kill switches | |

### Round S7 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| S7-01 | **Billing: Stripe Managed Payments** (merchant of record, Checkout Sessions, digital tax code per product); Canadian seller eligibility confirmed on Stripe's own page at setup | |
| S7-02 | **Earlier decisions carried unchanged**: testing/CI (R5-04, R10-09), burn (R10-10), build orchestration (R10-11, R11-01), design authority (D1-01), schema (R7-02, adjusted for S6: no browser lease, no real-email tables), SQLite queue, per-tab SSE, double-entry ledger | |
| S7-03 | **Legal minimum before M2**: Terms of Service, Privacy Policy, explicit per-application "Overture applies on your behalf" consent, DPA with the browser vendor, written use-case confirmation from the vendor | |
| S7-04 | **S6-01 (Browser Use) held for owner review** of a full cost and alternatives breakdown; verified figures appended to `docs/v2/research/managed-browsers.md` §7 | owner asked for more information |
| S7-05 | **Browser Use Cloud confirmed as primary, Kernel as fallback** behind `BrowserProvider`; country-matched residential exit per user; ~$0.022 per completed application budgeted; written answers on use case, profile encryption/deletion and country coverage requested before M2 (draft: `docs/v2/vendor-questions.md`) | owner accepted the breakdown |

### Round S8 — answered 2026-11-19 (all accepted)

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| S8-01 | **Pacing**: ≤10/day spread randomly over the user's local 08:00–20:00; one application per company per 7 days; no re-apply to a reposted role within 60 days; crowd limits 20 Overture applicants per posting and 50 per employer per week; admin-tunable global hourly cap per ATS | looks human to employers and ATSes |
| S8-02 | **Never-apply list in Tier 1**: current employer (prefilled from the resume) + companies to skip | applying to the current employer is the worst possible mistake |
| S8-03 | **Languages**: user picks working languages (default English); only postings in those languages; open text and letters written in the posting's language; UI English only | |
| S8-04 | **Currency**: plans in USD with Stripe local presentment; salary floor in the user's currency, compared via daily ECB rates; postings without salary never filtered on salary | |
| S8-05 | **Plan rules**: unused applications expire at period end; plan end or payment failure auto-pauses with a reason, in-flight applications finish; cancel runs to period end; trial upgrade immediate, Week↔Month at renewal; no default refunds (failures never charged), admin refunds; one trial per card via surviving HMAC fingerprint | |
| S8-06 | **"Why this match"**: one-line reason returned with every score, shown on the card | ~$0.00002 per score |
| S8-07 | **Check-ins on Home**: 21 days in Applied without employer mail → one-tap Rejected / Interviewing / Still waiting; 45 days with neither → Closed "No response", undoable | Review stays questions-only |
| S8-08 | **Deploy downtime of ~10–30 s accepted** until ~200 paying users; queue drains on SIGTERM and resumes; SSE reconnects | zero-downtime needs Postgres + multiple machines, already designed for |
| S8-09 | **Separate job-search domain** (not a subdomain of the main domain); main domain does not exist yet; shortlist below | protects the brand domain's reputation |
| S8-10 | **One resume per user, sent unchanged**; a replacement applies to new applications only; snapshots keep the exact file sent | |

### Round S9 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| S9-01 | **Main domain `tryoverture.com`** (backup `meetoverture.com`); site, app and Overture's own mail | available 2026-11-19 (Verisign RDAP); hyphenated names rejected |
| S9-02 | **Job-search domain `overturemail.com`** (backup `overtureinbox.com`); addresses `first.last@overturemail.com` | reads like an ordinary mail provider; no "job"/"apply" |
| S9-03 | **Owner buys both at Cloudflare Registrar now** (~$11/yr each, at cost); builder configures DNS, SPF/DKIM/DMARC, Email Routing and SES verification afterwards; owner advised to run a CIPO/USPTO trademark search | |
| S9-04 | **SPEC.md first, design round alongside the build** | M1 is mostly back end; workers start sooner |

**Architecture frontier: empty as of 2026-11-19 (Session 3).** Open items carried as risks in SPEC.md: hiring.cafe import (owner), design round D1 items.

### Round S10 — direction given 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| S10-01 | **No vendor outreach.** Nothing is sent to Browser Use (or any vendor); if they have concerns they contact us. Supersedes the written-confirmation parts of S6-01, S7-03 and S7-05; `docs/v2/vendor-questions.md` deleted; vendors' standard published DPAs accepted as-is | owner: small side project being made into a SaaS; do not add process for no reason |
| S10-02 | **Builder sets up Cloudflare** (domain registration via the Registrar API, DNS, Email Routing, Worker, R2, Turnstile, Access) with a scoped API token the owner creates; each purchase confirmed by the owner at the moment it is made; auto-renew on | owner asked |

### Round S11 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| S11-01 | **Daily digest at 08:00 user local** (yesterday's sends, replies, open Reviews, check-ins) | owner; replaces 18:00 |
| S11-02 | **Stripe Managed Payments with no separate eligibility step**: Canada is a supported seller country; if Stripe ever refuses, plain Stripe Billing + Stripe Tax behind the same `Payments` port | owner: do not complicate |
| S11-03 | **SPEC defaults accepted** (owner changed only the digest time): email classification LLM fallback; job-search addresses never reused; crash recovery checks for an ATS acknowledgement before retrying; one-row balanced ledger transfers; read-only act-as inside Reveal; M1 gate 60 apps/provider, ≥ 85 % sent, ≤ $0.03 per sent; auto kill switches ATS < 60 %, employer 3 consecutive blocks, provider < 50 %; retry ≥ 6 h later; sessions 30 days; passwords ≥ 10 chars; owner mailbox (receive-only) in M1 | |
| S11-04 | **Cloudflare token verified** (account token, active; registrar reachable). Live price 2026-11-19: `tryoverture.com` and `overturemail.com` available, standard tier, USD 11.17/yr registration and renewal each | |

### Round S12 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| S12-01 | **One domain only: `tryoverture.com`.** Job-search addresses are `first.last@mail.tryoverture.com` (subdomain with its own SES identity, DKIM, SPF and DMARC). `overturemail.com` is not bought. Supersedes S8-09, S9-02 and the second purchase in S9-03 | owner: side project with no revenue yet, minimise spend. Accepted trade-offs: addresses are tied to the brand domain if it is ever replaced, and the address shows "try". Sender-reputation coupling is low because the subdomain only sends replies (≤ 20/day/user) |
| S12-02 | **Domain purchase parked**: Cloudflare billing support is resolving the card address error; DNS/Email Routing/SES setup waits for it. Nothing in the design round depends on it | owner |
| S12-03 | **Repo `CLAUDE.md` gets a v2 banner and v2 UI rules** before the design round, so the impeccable skill does not follow v1 rules (Holds, six destinations, preserved `BoardPage.tsx`); full rewrite stays in the burn commit | builder, to avoid the design pass reading dead rules |

## Session 4 (Claude Opus 5.5, stonefish) — bootstrap of the v2 repository, 2026-11-19

The documents moved to the new repository `a-hagi613/overture`. A full read found contradictions between the spec,
`DESIGN.md`, the agent files and the canvas; the owner ruled on them, and on the rest asked for the builder's best call.

### Round S13 — answered 2026-11-19

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| S13-01 | **Banned words are banned in anything a user can read** (UI, copy, emails, push, errors, landing). Code uses the glossary for product concepts and may keep precise internal names (`ledger`, `attempts`, `dispatch/`, `BrowserProvider`) | renaming every internal to avoid the words rejected: it hides what the code is. The spec already used them as identifiers |
| S13-02 | **Fresh start, salvage what we can**: v1 logic (ATS feed clients, form-filling engine, per-ATS flows, posting guard, code extractor, crypto) is ported into the v2 layout per `docs/v2/SALVAGE.md`; no v1 structure, vocabulary or tests | copying v1 modules whole rejected: they carry the v1 patterns this repository exists to leave behind |
| S13-03 | **v1 sunset on Fly**: snapshot the volume, export boards and the owner's answers and learned answers, stop v1, create `overture-web` with a fresh database, destroy v1 a week later. No schema migration | migrating the v1 database rejected: fresh schema (R1-02) |
| S13-04 | **No retry after Submit is clicked.** `submit_clicked_at` splits failures. After it, the application is `confirming` for up to 24 h, waiting for the employer's acknowledgement mail: found → sent and charged; not found → Couldn't apply, not charged, never resent, repost guard set | retrying a missing confirmation rejected: it can send the same application twice |
| S13-05 | **One open application per company**; a sent one blocks the company 7 days; failed/skipped/withdrawn do not count. Skip list matches by company, domain or normalised name with legal suffixes removed; a near match also skips | name equality alone rejected: misses "Shopify Inc." for the current employer |
| S13-06 | **Kernel is an emergency fallback, not a bake-off arm.** Its policy bans bulk form submission; it runs the synthetic lab only. The M1 gate is measured on Browser Use | sending half the owner's real applications through Kernel rejected |
| S13-07 | **The developer machine never touches a real form or a Browser Use session.** Fixture capture and live smoke checks are admin-started jobs on `overture-web` through Browser Use, never submitting; fixtures are pulled from R2. Forms only ever see Browser Use's residential IPs | developer-driven Browser Use sessions rejected by the owner: production and development share one path to real forms |
| S13-08 | **`tryoverture.com` is registered.** Job-search addresses on `mail.tryoverture.com` are the email on every form; the sign-in email never goes on a form | supersedes S12-02 (purchase parked); the personal email on forms would send codes and replies outside Overture |
| S13-09 | **The canvas is the wireframe; the build matches it pixel for pixel.** Boards that contradict the spec are redrawn first (`DESIGN.md` §13). Conflicts are settled for the most solid approach: 08:00–20:00 sending shown in every board; Queued column in ink with a red "Needs you" pill; serif for display and a person's words, mono for recorded facts; logo radius 7; no glows; one sanctioned card stack; `--hold` renamed `--need` | |
| S13-10 | **Smaller rulings**: open-text answers carry resume-line mapping like letters; snapshots store the letter mapping, posting URL/title and how the send was confirmed; immutability triggers allow deletion only once the user row is gone; withdraw is for queued applications only; daily usage counts against the day a reservation was made; reservations on an expiring grant are released then expired; retries take the next slot inside the window; remote postings match by country or by work authorisation; timezone from the browser; address first name from `preferred_name`; title similarity in code instead of an ML model; census runs on the v2 catalog; invited beta users get 300 applications over 30 days; the cover-letter template is a Tier 2 fact | builder's call where the spec was silent |
| S13-11 | **Agent files and orchestration are rewritten from scratch.** `AGENTS.md` / `CLAUDE.md` describe this repository only; orchestration and worker limits are deferred (R10-11, R11-01 no longer apply) | v1 agent files described a repository that no longer exists |
