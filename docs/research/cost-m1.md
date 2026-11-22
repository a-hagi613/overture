# Cost optimisation review (issue #184), 2026-11-21

Scope: `main` at `66db604`, so M1 plus the M2 code merged so far. Every cost line is reviewed against the vendor's
published price on 2026-11-21 and against the code that spends it. The browser numbers are **#180's recorded session
usage**, not five real sends: #181 (live user dogfooding) is deferred to the end of M3 by the owner, so the fixture
recording in `docs/research/browser-use-sdk-and-cost.md` §7 stands in, and every number derived from it is labelled.
No production session, no paid API call and no ATS contact was made (ADR 0016).

Prices were read on 2026-11-21: Anthropic <https://platform.claude.com/docs/en/about-claude/pricing>, Fly
<https://fly.io/docs/about/pricing/>, Browser Use (#180 §6, from <https://browser-use.com/pricing>), Cloudflare from
`docs/research/cloudflare-email-sending.md` §6 and `docs/research/cloudflare-paid-plan.md` §2. Nothing here is a
decision: prices and levers are proposals, and fixes become their own tickets (§8).

## Verdict

- **The gate passes thinly.** At the recorded usage one attempt costs **$0.0225** and one completed application
  **$0.0265**, under the $0.03 gate by 12 %. One more 0.7 MB of proxied traffic per form ($0.0034 an attempt) fails it
  on its own, and so does roughly four more code-wait minutes. Browser minutes and proxy bytes both move the answer
  now (§2.1).
- **Two levers decide the bill.** Buying egress at $0.20/GB instead of $5/GB removes 56 % of it. The code wait is what
  the gate hinges on: the same form with a 10-minute paste is $0.0325 per completed and fails (§2.1), and the average
  saving from shortening it depends on how often a code is asked for, which no real send has measured yet.
- **The LLM line is 10× what the spec assumes, because of a default.** `ANTHROPIC_MODEL` defaults to
  `claude-haiku-4-5` (`src/server/config/env.ts:143`) while SPEC §8.6 names `claude-haiku-5-5`, and the only price
  table is the 4.5 batch table (`src/server/platform/llm/anthropic-batches.ts:79-107`). At Haiku 5.5 batch rates
  ($0.05/$0.25 per MTok) the LLM is $0.0005 per application; at 4.5 batch rates ($0.50/$2.50) it is $0.0051 (§2.3).
- **Plans keep 71 % and 80 % gross margin** before Stripe fees, at 300 and 70 applications per period (§3). Fixed
  infrastructure is $20.76 a month and is noise next to variable browser spend at M3 scale.
- **The gate as computed is not the gate as defined.** ADR 0026 puts Anthropic spend inside cost per completed
  Application; `buildCostSummary` sums only `attempts.cost_micros` (`src/server/dispatch/report.ts:170-179`), so the
  4.5 default hides 18–25 % of the real cost from the number the owner reads (§5.1).

## 1. The bill, line by line

| Line | Rate (2026-11-21) | Where it is spent | M2, 10 users | M3, 300 users |
|---|---|---|---|---|
| Fly machine | $13.39/month (`shared-cpu-2x`, 2 GB; `fly.toml`) | always on, `auto_stop_machines = "off"` | $13.39 | $13.39 + sizing (#183 finding 9) |
| Fly volume | $1.50/month (10 GB provisioned; `fly.toml` `initial_size`) | `/data` SQLite, objects, Litestream | $1.50 | $1.50 |
| Cloudflare Workers Paid | $5.00/month minimum | Email Worker, sentinel, queues, static assets | $5.00 | $5.00 |
| Cloudflare Email Sending | 3,000 emails/month included, then $0.35/1,000 | magic links, recap, notices | ~600 emails (est.), $0.00 | ~18,000 emails (est.), **$5.25** |
| Cloudflare R2 | 10 GB free, 1 M Class A, 10 M Class B | backups, files, inbound spill | ~104 k Class A, $0.00 (measured floor, `cloudflare-paid-plan.md` §2) | same order, $0.00 |
| Cloudflare Email Routing, Turnstile, Access | free at this volume | inbound mail, bot check, admin gate | $0.00 | $0.00 |
| Domain | ~$10.46/year (Cloudflare Registrar) | `tryoverture.com` | $0.87 | $0.87 |
| GitHub Actions | free tier | Workable ingest (ADR 0032) | $0.00 | $0.00 |
| Grafana Cloud / ntfy / Web Push | free tier, owner account | logs, alerts, notifications | $0.00 | $0.00 |
| Browser Use | $0.06/browser-hour, billed per minute, 1-minute minimum; proxy $5/GB | one session per attempt | variable | variable |
| Anthropic | Haiku 5.5 batch $0.05/$0.25 per MTok; batch cache read $0.005, 5m write $0.0625 | scoring, answers, letters, mapping, mail | variable | variable |

Fixed total: **$20.76 a month**, unchanged from 10 to 300 users except the mail overage. Egress ($0.02/GB from North
America) and volume snapshots (first 10 GB free) are inside the noise at this volume. The `demo` seed and the live
checks cost nothing measurable.

## 2. Per application

### 2.1 Browser and proxy, at the recorded session

One send in `docs/research/browser-use-sdk-and-cost.md` §7 used 2.71 MB of proxy traffic and 556 s (9 min 16 s):

| Line | Arithmetic | Cost |
|---|---|---|
| Browser | 9.2667 min × $0.06/60 | $0.00927 |
| Proxy | 2.71 MB × $5/1024 | $0.01323 |
| **One attempt** | | **$0.02250** |
| **One completed (÷ 0.85)** | ADR 0026 divides spend by *sent* | **$0.02647** |

The 85 % in the divisor is the M1 gate's submit rate (SPEC §2), not a measurement. Every percentage point of submit
rate lost is 1.2 % of cost per completed application.

What moves the line, one lever at a time, at the recorded usage:

| Change | Per attempt | Per completed | Where the code decides it |
|---|---|---|---|
| Today | $0.02250 | $0.02647 | `src/server/dispatch/executor.ts:58` (15 min), `browser-use-provider.ts:66-78` |
| A 5-minute code paste | $0.02750 | $0.03235 | `src/shared/code-wait.ts:1` (10 min) |
| A 10-minute code paste | $0.03250 | $0.03823 | `src/shared/code-wait.ts:1` |
| Proxy trim, −16 % of bytes | $0.02038 | $0.02398 | `src/server/dispatch/browser/proxy-trim.ts` (run at `executor.ts:609`) |
| Proxy trim, −22 % of bytes | $0.01959 | $0.02304 | same |
| Egress at $0.20/GB (BYO or direct) | $0.00980 | $0.01152 | `browser-use-provider.ts:101` (`proxyCountryCode`) |

The trim percentages are #180 §8's realistic per-ATS estimate, not the fixture's 61.5 %; the fixture is a synthetic
worst case.

### 2.2 What a failed attempt costs

A failure before `submit_clicked_at` releases the reservation, so the user is charged nothing (SPEC §9.4, promise 3)
but Overture still pays. The 1-minute minimum makes an early failure nearly free ($0.001 plus its bytes); a failure at
minute 9 costs the full $0.0225 and produces no revenue. That is why the divisor is `sent`, and why the retry once
(`limits.max_attempts = 2`) doubles an attempt's cost on the forms where it fires.

A zombie session is the expensive case: Browser Use charges the whole `timeout` upfront and refunds on stop, so a lost
session bills 15 minutes ($0.015) until the recovery sweep stops it (`executor.ts:59`, every 60 s). Dropping the vendor
timeout to 12 minutes caps that at $0.012 and leaves the 10-minute paste path intact.

### 2.3 LLM, from the prompt sizes in the code

Token estimates come from the code's own 4-chars-per-token constant
(`src/server/platform/llm/anthropic-batches.ts:10`); Anthropic's pricing page notes that models from 4.7 on produce
about 30 % more tokens for the same text, so real counts are higher and the prices below are a floor.

| Purpose | Input tokens (from code) | Output | Haiku 5.5 batch | Haiku 4.5 batch |
|---|---|---|---|---|
| `score` | ~700 (200-word summary + 1,500-char resume digest, `matching/score.ts:36-37`) | 60 | $0.000050 | $0.000500 |
| `open_text` | ~2,600 (6,000-char posting slice + resume lines, `pipeline/open-text.ts:141`) | 170 | $0.000172 | $0.001725 |
| `cover_letter` | ~2,900 (+ template and voice sample) | 280 | $0.000215 | $0.002150 |
| `question_mapping` | ~150 | 30 | $0.000015 | $0.000150 |
| `email_classify` | ~360 (1,000-char body limit) | 20 | $0.000023 | $0.000230 |
| `resume_pdf_fallback` | ~33,000 (100 KB PDF at 3 bytes/token), once per user | 500 | $0.001775 | $0.017750 |

Per application, with 1.5 scores (lazy scoring creates 10 a day and rejects some), two inbound mail classifications,
and the letters the form asks for:

| Form shape | Haiku 5.5 | Haiku 4.5 |
|---|---|---|
| No open questions (typical Greenhouse) | $0.00012 | $0.00121 |
| One open question + a cover letter | $0.00051 | $0.00509 |
| Three open questions + a cover letter | $0.00076 | $0.00756 |

So the LLM is **0.5–3 %** of cost per application at Haiku 5.5 and **4–25 %** at 4.5. The spec's §8.6 estimates
($0.0001 score, $0.0005 letter) are right for 5.5 and 10× low for 4.5 — they were written for the model the spec
names, not the one the code defaults to.

## 3. Per user-month, and the plans

Both plans run a user at the daily cap: $12 for 70 in 7 days and $35 for 300 in 30 days are both 10 a day
(ADR 0018, `limits.daily_cap = 10`). The month is therefore 353 attempts and 300 sent applications; the week is 82
attempts and 70 sent.

| Line | Week ($12, 70 apps) | Month ($35, 300 apps) |
|---|---|---|
| Browser + proxy (353 or 82 attempts × $0.0225) | $1.85 | $7.94 |
| Anthropic (Haiku 5.5, one open question + letter) | $0.04 | $0.15 |
| Fixed infrastructure share (10 users) | $0.49 | $2.08 |
| **Total** | **$2.38** | **$10.17** |
| **Gross margin** | **80 %** | **71 %** |

The same month at the 4.5 default is $11.55 (67 %), and $12.29 (64 %) on a form with three open questions. Stripe
Managed Payments fees (M3, from the merchant-of-record rate) and refunds are not included; the trial's 3 applications
cost about $0.08 and carry no revenue by design.

With egress at $0.20/GB the Month user's cost falls to **$5.69** (84 % margin); with the trim at its realistic 16–22 %
it falls to **$9.4–$9.1**. Egress and the trim together: $5.7, because egress has already removed most of what the
trim would have saved.

Break-even is one Month user or two Week users against the $20.76 fixed cost: revenue minus variable cost is $26.91 a
month and $10.11 a week. At 300 Month users the variable bill is about $2,430 a month against $10,500 of revenue
(77 % before fixed cost and fees).

## 4. Ranked savings

Savings are per attempt against the §2.1 baseline (2.71 MB, 9 min 16 s), per completed by dividing by 0.85, per user-month
at the Month plan's 300 applications, and at scale for 300 such users (90,000 completed applications). Levers 1, 2 and 4
are per attempt; 3 and 7 are per application, which is one attempt in steady state.

| # | Lever | Change | Per attempt | Per user-month | At 300 users/month | Confidence | Risk |
|---|---|---|---|---|---|---|---|
| 1 | **Egress at $0.20/GB** | Bring our own proxy (enterprise) or run the session direct (`proxyCountryCode: null`) | −$0.0127 (−56 %) | −$4.48 | −$1,344 | High on price, low on stealth | A direct exit is a datacentre IP and will lose challenge scores; needs a lab A/B per ATS |
| 2 | **Run the model the spec names** | `ANTHROPIC_MODEL` default → `claude-haiku-5-5`, exact-match price rows | −$0.0046 per application | −$1.37 | −$412 | High | None on submit rate; the spec already chose 5.5 for letters and scoring |
| 3 | **Hold the form under 10 minutes** | Cap the paste window (10 → 5 min) or report p95 minutes against the gate | −$0.005 per avoided 5 min | −$0.35 at 20 % of forms, −$1.76 at 100 % | −$106 to −$530 | High on arithmetic, product call on UX | A shorter window means more `code_timeout` attempts, which still cost their minutes |
| 4 | **Trim per ATS** | Extend `proxy-trim.ts` with the tracker hosts each ATS loads | −$0.0029 (−13 %) | −$1.03 | −$308 | High | None; the blocklist is inert where unused. Never block images, scripts, XHR or captcha hosts (SPEC §10.3) |
| 5 | **Bound lazy scoring per day** | Stop `scoreNextChunk` after a multiple of `need`, not when the pool is exhausted | variable | variable | variable | High on the mechanism | A high threshold and a large pool score the whole pool until a cap trips (§5.3) |
| 6 | **Cheaper zombies** | `SESSION_TIMEOUT_MINUTES` 15 → 12 | −$0.003 per lost session | small | small | High | A code wait starting at minute 9 has 3 minutes left instead of 6 |
| 7 | **Reuse letters on re-prepare** | Reuse saved sentences when the resume and fact revisions are unchanged | −$0.0002 per letter | small | small | High | Must key on resume and fact revisions, or it reuses an answer a fact change invalidated |
| 8 | **Trend browser minutes, not just proxy** | A minutes twin of `browser.proxy_trend` | none directly | none directly | catches regression | High | None |
| 9 | **Right-size the volume** | 10 GB provisioned → the measured size (clone and restore) | — | $0.90/month fixed | $0.90/month fixed | High | A volume cannot shrink in place; it needs a new volume and a restore |

Lever 1 is #180's follow-up 1 and is the only one that changes the shape of the business. Lever 2 is new and is the
cheapest to land. Lever 3 is #180's follow-up 2; its average saving is smaller than the trim's, but it ranks above
because the gate hinges on it. Lever 4 is follow-up 3. Lever 6 is follow-up 6. Lever 8 is follow-up 8. Levers 5, 7 and
9 are new.

### 4.1 Why nothing else on the LLM is worth chasing

The prompts are small: the largest is a 6,000-character posting slice (`open-text.ts:141`). Prompt caching is already
on for the system prompt (`anthropic-batches.ts:204`), and caching the 1,500-character resume digest too would move
about 375 tokens per score from $0.05 to $0.005 per MTok — $0.00002 a call at Haiku 5.5, a rounding error against
90,000 applications. Every production path already uses the batch API (50 % discount): `score`, `open_text`,
`cover_letter`, `question_mapping`, `email_classify`, `tag_fallback`; only the once-per-user resume PDF uses the single
path. There is no cheaper token left to buy except a cheaper model, which is lever 2.

## 5. Findings: defects that distort the number

### 5.1 The cost gate excludes Anthropic spend that ADR 0026 puts inside it

- **Evidence:** ADR 0026 defines cost per completed Application as "all Browser Use and Anthropic spend for attempted
  Applications, failed tries included, divided by sent ones". `buildCostSummary` and `summarise` sum only
  `attempts.cost_micros` (`src/server/dispatch/report.ts:85-86`, `:170-179`), which the provider sets from
  `proxyCost + browserCost` (`browser-use-provider.ts:72`). `llm_usage` is keyed by user and purpose
  (`platform/db/schema.ts:403`), never by application, so nothing joins it in.
- **Impact:** at Haiku 5.5 the omission is 0.5–3 % of cost and does not change the verdict. At the 4.5 default it is
  18–25 %: a real $0.0325 shows as $0.0265 and passes the gate. The admin Overview and the `browser.proxy_trend` alert
  both read the browser-only number.
- **Fix:** record per-application Anthropic spend (the prepare job knows the application id when it calls the LLM), or
  add the day's `llm_usage` cost to `buildCostSummary` and label it as approximate. Do not change the gate.

### 5.2 The default model and the price table disagree with the spec

- **Evidence:** SPEC §8.6 says `claude-haiku-5-5` is the production model; `env.ts:143` defaults to
  `claude-haiku-4-5`. `BATCH_PRICES_MICROS` (`anthropic-batches.ts:79-107`) has one `claude-haiku` row carrying the 4.5
  batch rates ($0.50/$2.50 per MTok) and matches by prefix, so a deployment that sets `claude-haiku-5-5` still meters
  it at 4.5 prices — 10× too high — and trips every cap 10× early.
- **Impact:** either the bill is 10× the spec's estimate (if the default wins) or the recorded cost, the admin report
  and the caps are 10× wrong (if the model is corrected without the table). Both directions are defects.
- **Fix:** an exact-model price row for 5.5 (batch $0.05/$0.25, cache read $0.005, 5m write $0.0625), prefix matching
  that prefers the longest match, the env default changed to the spec's model, and a unit test on both.
  **Owner check:** confirm the account has Haiku 5.5 and that the price on the Console matches the public page.

### 5.3 Daily scoring can run to the cost cap

- **Evidence:** `fill` scores in chunks of `min(5, need)`, and `scoreNextChunk` recurses until `need` is met or the
  candidate pool is exhausted (`matching/score.ts:514-569`). A score below the threshold does not reduce `need`, so a
  strict threshold over a large pool scores for as long as it finds nothing acceptable.
- **Impact:** at Haiku 5.5 that is $0.00005 a score, so even 1,000 scores a day is $0.05. At 4.5 it is $0.50 and the
  $0.25 per-user cap trips (`llm/caps.ts:45`), which fails closed: scoring pauses and the user gets no applications
  that day, with only an `llm.cap` alert. The cap is doing the job; the loop makes it fire.
- **Fix:** bound the search at a multiple of `need` (for example 3× the daily cap), and alert when the bound is hit so
  the threshold, not the cap, is what is tuned.
- **Fixed in #388:** the daily run scores at most 3× `limits.daily_cap` postings, stops there and raises
  `match.score_bound` with the threshold, the need and the counts.

### 5.4 Minor accounting notes

- `proxyBytes` stores MB × 10⁶ (`browser-use-provider.ts:75`) while Browser Use bills MB → GB by /1024; the report
  divides by the same 10⁶, so the displayed MB is right and only the column name is loose. No action.
- `usageUnsettled` treats zero proxy bytes *and* zero proxy cost as unsettled (`browser-use-provider.ts:36`), so a
  session with proxying truly off waits the full 30 s deadline. Latency only; it becomes visible if lever 1 ships.
- A stop that fails records `cost_micros = 0` and relies on the sweep's 24-hour backfill (`executor.ts:61`), so a
  day's cost can look artificially low until the sweep runs. Expected, but it means "today's spend" in admin is not
  final until the next day.

### 5.5 The report behind the gate scans every attempt ever recorded

- **Evidence:** `attemptRows` selects every attempt joined to its application, posting and user, with no date bound
  and no limit, then aggregates in JavaScript (`src/server/dispatch/report.ts:130-150`). The admin Overview calls
  `buildCostSummary` on each load (`routes/admin.ts:681`) and the provider report calls the same scan
  (`routes/admin.ts:1128`). SPEC §5.7 says `attempts` is kept 180 days, but the retention job deletes only `events` and
  `bg_jobs` (`platform/jobs/retention.ts:51-62`), so the table is never pruned. The indexes are
  `(application_id, started_at)` and `(user_id, lease_until)` (`schema.ts:919-920`); neither serves the
  `ORDER BY started_at` full scan.
- **Impact (estimate):** at 300 users sending 10 a day, 180 days is about 540,000 rows scanned and aggregated on the
  single event-loop thread for one page load. M2's 10 users are about 18,000 rows, which is fine; this is a wall the
  cost dashboard reaches on the way to M3, not today.
- **Fix:** filter the report to a window (`since` equal to the current or last billing period), compute the totals in
  SQL, and add attempts to the retention job so the table matches SPEC §5.7.

## 6. Considered and rejected

| Lever | Verdict | Why |
|---|---|---|
| Block images as well as fonts, media and trackers | Rejected | Contradicts SPEC §10.3, can break image-rendered challenges and logos, and a page with no images is itself a signal. Worth about 19 % of the synthetic page's bytes and less in reality (#180 §9). |
| Batch two applications into one browser session | Rejected | Browser time is billed per minute per session; the saving is one rounding minute, and coupling two employers into one failure is worse. One-in-flight is a spec rule (SPEC §9.3). |
| Stop the browser at the code prompt and reopen on paste | Rejected | Loses the filled form; re-filling costs more minutes than it saves and risks a fresh challenge on a new exit IP (#180 §9). |
| Cache pages through the per-user profile | Not available | Profiles persist cookies and login state, not an HTTP cache; `POST /browsers` has no cache knob (#180 §9). |
| Headless browsers | Not available | Every Browser Use cloud browser is the stealth build; Kernel is the only headless path and its policy bans bulk submission (ADR 0003). |
| A cheaper proxy *type* | Not available | The only managed choice is a country code; a cheaper tier means BYO egress (lever 1). |
| Move sending to Cloudflare Browser Run | Not recommended | No residential proxy, no challenge solving, and a non-removable bot signature (ADR 0033, #288 keeps it as a lab-only fallback if the gate fails). |
| Drop the per-user profile | Rejected | It is what makes a returning applicant look like the same person; the profile costs nothing per send. |
| Retune the trim on guesses instead of per-ATS data | Rejected | The mechanism is banked (#179); only the host list is missing, and that needs real sends (#180 §10). |

## 7. What to measure next

The arithmetic rests on one recorded usage figure. The five-send probe is now the end of M3, so the beta wave is the
first real data. Per attempt, record what #180 §10 asks for, which the schema already carries
(`attempts.browser_ms`, `proxy_bytes`, `cost_micros`) plus the wall-clock split and a resource-type byte count from a
CDP `Network.dataReceived` sum:

1. Minutes and MB per ATS, and the same minus code-wait minutes, so lever 3 is measured and not inferred.
2. The per-ATS byte split, so lever 4 uses real tracker sets.
3. Whether a `form_changed` or a missing logo follows a trim, which is the signal the trim went too far.
4. Per-application Anthropic cost, to close finding 5.1 before the M3 margin work (#249) needs it.

Change one lever at a time: the egress trial must hold the blocklist and the minutes constant, and the trim work must
hold the route constant.

## 8. Proposed tickets

Ordered by saving per unit of risk. Tickets 1, 2, 5, 6 and 8 are #180's follow-ups 1–5 and 8; 3, 4, 7 are new here.

1. **Egress trial: direct vs BYO proxy, measured per ATS** (#180 follow-up 1). Biggest lever; needs the owner or a
   sales conversation.
2. **Cap the code-paste window** or report p95 minutes against the gate (#180 follow-up 2).
3. **Fix the model and the price table**: `claude-haiku-5-5` default, exact-match price rows, a unit test, and the
   owner's Console check (finding 5.2). Do before the beta wave: it is a 10× line and a metering bug at once.
4. **Put Anthropic spend inside the gate number** (finding 5.1), before #249 proposes final prices.
5. **Per-ATS tracker hosts for `proxy-trim.ts`** (#180 follow-up 3).
6. **Network policy behind the trim** (#180 follow-up 4), which is also where the SDK swap belongs (#180 follow-up 5).
7. **Bound lazy scoring per day** and alert when the bound is hit (finding 5.3).
8. **Minutes trend beside `browser.proxy_trend`** (#180 follow-up 8), and bound the provider report to a date window
   before M3 (finding 5.5).
9. **Housekeeping**: `SESSION_TIMEOUT_MINUTES` 15 → 12 (#180 follow-up 6); right-size the 10 GB volume (lever 9);
   reuse saved letters when the resume and fact revisions are unchanged (lever 7).

## Limits of this note

- **One recorded session, not five real ones.** Prices and refund rules are read from the vendors' pages; the minutes
  and megabytes are the fixture's recorded usage (#180 §7). The 85 % is the gate's target, not a measurement.
- **Token counts are estimates from character budgets** (`CHARS_PER_TOKEN = 4`), before the 30 % tokenizer increase on
  models from 4.7 — the LLM figures are a floor, not a bill.
- **Stripe fees, refunds and taxes are out of scope**: they arrive with billing in M3 and change margin, not the
  browser or LLM levers.
- **M3 infrastructure sizing is #183's**, not this note's. The 300-user figures hold the machine constant and are a
  variable-cost model only.
- **The five-send probe can still move the answer.** If real forms carry 10 MB, proxy is 80–90 % of the bill again and
  lever 1 is worth more than every other lever combined.
