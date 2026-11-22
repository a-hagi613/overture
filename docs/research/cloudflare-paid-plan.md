# Cloudflare Workers Paid plan: what it can do for Overture under a $5 a month cap

The owner bought Workers Paid ($5 a month) and wants it used where it really helps, with no spend above $5 a month in total. This note lists every product the plan covers, ranks the uses that fit Overture, and answers the cap question. It changes no production code; §5 and §6 record the measurements behind the two dropped recommendations and the e2e tests that pin them.

All facts below come from `developers.cloudflare.com` pages read on 2026-11-21 (each is linked where it is used), except the Browser Run pages in §6, read again on 2026-11-22. `cloudflare.com/plans` is a script-rendered page and was not read; the developer pricing pages are the same rate card and are the source of record. Overture's own figures come from `docs/SPEC.md`, ADR 0007, 0016, 0024, 0026, 0028 and 0032, and `docs/research/managed-browsers.md`.

## The short answers

- **No native hard cap exists for the account as a whole.** Cloudflare offers a _spending limit_ for Workers and a separate one for Durable Objects only, and says plainly that "a limit does not guarantee a maximum invoice amount". Every other product (R2, Queues, KV, D1, Workers AI, Browser Run, Vectorize, Email Sending) has no native limit; at most there is an email alert.
- **The $5 is already the subscription.** Read literally, "never above $5" means _zero overage on every product_. The design below keeps every use inside its included allowance, caps what Cloudflare can cap natively, and adds a small watchdog Worker for the rest.
- **The measured risk is the operation count, not the sync rate.** `litestream.yml` syncs to R2 every second, but Litestream only uploads when the WAL changed: over 2026-11-01..21 `overture-backups` saw 56.4k PutObject and 3.0k UploadPart, not the ~1.8M a literal one-write-per-second would produce. ListObjects was the largest Class A line at 70.6k (~50% of ~140k total). Measurement and cause: §2.
- **The LIST floor was about to pass the allowance.** Two fixed costs, independent of how many users exist: the app read the replica's lag with `litestream ltx -level all` every 30 s (ten ListObjectsV2 calls, 28.8k/day), and Litestream's L0 retention monitor listed the replica twice every 15 s (11.5k/day). Together that is ~40.3k/day, ~1.21M a month against 1M included, with no users at all. Both are now cut to ~3.5k/day (§3).

## 1. Every product: allowance, overage, Overture fit

Allowances are monthly on Workers Paid unless stated. Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) (the combined table) and each product's own pricing page linked in the first column.

| Product                                                                                                         | Included on Paid                                                                                                                                                                                       | Overage                                                                                         | Overture use, or "no fit"                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Workers](https://developers.cloudflare.com/workers/platform/pricing/)                                          | 10 M requests; 30 M CPU-ms; no duration charge                                                                                                                                                         | $0.30 per M requests; $0.02 per M CPU-ms                                                        | **Fits, small:** the existing inbound-mail Email Worker, plus a cron "sentinel" (below). Both are a few thousand invocations a month. Requests to static assets are free and unlimited.                                                                                                         |
| [Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/)                                    | 10,000 Neurons a day (the same free allocation as Free)                                                                                                                                                | $0.011 per 1,000 Neurons                                                                        | **Fits, marginal:** `email_classify` fallback (SPEC §8.6). See ranking 6. Not for answers or letters (ADR 0007, quality).                                                                                                                                                                       |
| [D1](https://developers.cloudflare.com/d1/platform/pricing/)                                                    | 25 B rows read; 50 M rows written; 5 GB                                                                                                                                                                | $0.001 per M rows read; $1.00 per M rows written; $0.75 per GB-month                            | **No fit:** the system of record is one SQLite file on the Fly volume (ADR 0002). A second database adds a sync problem for nothing.                                                                                                                                                            |
| [Workers KV](https://developers.cloudflare.com/kv/platform/pricing/)                                            | 10 M reads; 1 M writes, deletes and lists; 1 GB                                                                                                                                                        | $0.50 per M reads; $5.00 per M writes, deletes, lists; $0.50 per GB-month                       | **No fit:** no edge-read workload. The only shared state is in SQLite.                                                                                                                                                                                                                          |
| [R2](https://developers.cloudflare.com/r2/pricing/)                                                             | 10 GB-month; 1 M Class A; 10 M Class B; egress free                                                                                                                                                    | $0.015 per GB-month; $4.50 per M Class A; $0.36 per M Class B                                   | **Already used** (Litestream backups, sealed files, Stapply discovery bucket, mail, ADR 0032 snapshot). List operations, not writes, are the largest line and are now bounded by design; see §3.                                                                                                  |
| [Queues](https://developers.cloudflare.com/queues/platform/pricing/)                                            | 1 M operations (3 per message: write, read, delete)                                                                                                                                                    | $0.40 per M operations                                                                          | **Fits:** durable buffer between the Email Worker and `overture-web` (ranking 5). Message limit 128 KB, so large mail goes to R2 with a pointer.                                                                                                                                                |
| [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/)                          | 1 M requests; 400,000 GB-s; SQLite 25 B rows read, 50 M written, 5 GB                                                                                                                                  | $0.15 per M requests; $12.50 per M GB-s; $1.00 per M rows written; $0.20 per GB-month           | **No fit:** pacing and reserve-commit-release already live in SQLite on the one machine (ADR 0008, 0010). A second coordinator would split the truth. Has its own spending limit.                                                                                                               |
| [Workflows](https://developers.cloudflare.com/workflows/reference/pricing/)                                     | 10 M requests; 30 M CPU-ms; 1 GB-month; 500,000 steps (steps and storage billed from 2026-08-10)                                                                                                       | $0.80 per 100,000 steps; $0.20 per GB-month                                                     | **No fit:** `bg_jobs` leases and recovery sweeps already do this (SPEC §9.4).                                                                                                                                                                                                                   |
| [Browser Run](https://developers.cloudflare.com/browser-run/pricing/) (formerly Browser Rendering)              | 10 browser-hours; 10 concurrent browsers (monthly average of daily peaks)                                                                                                                              | $0.09 per hour; $2.00 per extra concurrent browser                                              | **No fit for sending**, measured and dropped in §6 (issue #288).                                                                                                                                                                                                                                |
| [Vectorize](https://developers.cloudflare.com/vectorize/platform/pricing/)                                      | 50 M queried and 10 M stored vector dimensions                                                                                                                                                         | $0.01 per M queried; $0.05 per 100 M stored                                                     | **No fit now:** matching is rules plus a Haiku score on a lazy two-stage path (ADR 0011), with no embedding step. 10 M stored dimensions is about 26,000 vectors at 384 dimensions, far under the catalogue.                                                                                     |
| [AI Gateway](https://developers.cloudflare.com/ai-gateway/reference/pricing/)                                   | Core features free (analytics, caching, rate limiting); 10 M stored logs per gateway                                                                                                                   | none for core                                                                                   | **Optional for Workers AI only.** Its [spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/) are the only native hard cap for AI calls. Not for Anthropic: gateway logs would hold prompts that contain resumes, against the no-PII-in-telemetry rule (SPEC §8.6). |
| [Hyperdrive](https://developers.cloudflare.com/hyperdrive/platform/pricing/)                                    | Unlimited queries                                                                                                                                                                                      | none                                                                                            | **No fit:** no Postgres or MySQL to accelerate.                                                                                                                                                                                                                                                 |
| [Containers](https://developers.cloudflare.com/containers/pricing/)                                             | 25 GiB-hours memory; 375 vCPU-minutes; 200 GB-hours disk                                                                                                                                               | $0.0000025 per GiB-second; $0.000020 per vCPU-second; $0.00000007 per GB-second                | **No fit:** the Workable pass runs free on a public-repository GitHub runner (ADR 0032), and a container needs a Durable Object in front.                                                                                                                                                       |
| [Images](https://developers.cloudflare.com/images/pricing/)                                                     | 5,000 unique transformations                                                                                                                                                                           | $0.50 per 1,000 transformations; stored and delivered images are billed                         | **No fit:** the product shows no user images.                                                                                                                                                                                                                                                   |
| [Logs and Observability](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)            | Workers Logs: 20 M events, 7-day retention. From 2026-12-01: [Observability](https://developers.cloudflare.com/observability/pricing/) 50 GB ingestion and 10 GB-month storage                         | $0.60 per M events now; from 2026-12-01 $0.25 per GB and $0.10 per GB-month                     | **Use for the Workers only** (`observability.enabled` is already on in `workers/inbound-mail/wrangler.jsonc`). App logs stay in Grafana Cloud.                                                                                                                                                  |
| [Pages](https://developers.cloudflare.com/pages/functions/pricing/)                                             | Pages Functions bill as Workers; static asset requests are free and unlimited                                                                                                                          | as Workers                                                                                      | **Not needed:** Workers Static Assets gives the same free static serving on the same deploy model as our existing Worker, so there is no reason to add a second one.                                                                                                                            |
| [Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)                       | 10 M data points written; 1 M read queries                                                                                                                                                             | $0.25 per M written; $1.00 per M read                                                           | **No fit:** metrics already go to Grafana Cloud over OTLP (SPEC §3.1).                                                                                                                                                                                                                          |
| [Email Sending](https://developers.cloudflare.com/email-service/platform/pricing/) (beta, already onboarded)    | 3,000 emails a month (sends to verified destinations are free)                                                                                                                                         | $0.35 per 1,000                                                                                 | **Already used** for magic links and the live check. Not covered by any native limit; see §3.                                                                                                                                                                                                   |

## 2. Ranked recommendations

Ranked by value for the owner's goals first, then lower effort, then lower risk. Effort is a worker's time; risk is the chance it breaks production or the cap.

| #   | Recommendation                                                                                                                                                                      | Value                                                                                                                                                                                                                                                                | Effort | Risk                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Cap guard**: Workers spending limit at the minimum, a budget alert, and the sentinel's usage check (§3)                                                                           | Makes the $5 promise real                                                                                                                                                                                                                                            | S      | Low. A tripped Workers limit also blocks the Email Worker (see §3).                                                                                                                                                                                    |
| 2   | **Measure and bound R2 Class A operations** from Litestream (`sync-interval: 1s`), then pick a safe interval                                                                        | Avoids the only plausible overage                                                                                                                                                                                                                                    | S      | Low. A longer interval widens the data-loss window from about 1 s to the interval; the owner decides the number.                                                                                                                                       |
| 3   | **A cron "sentinel" Worker**: probes `/api/health` from outside Fly, checks the Workable snapshot manifest age (ADR 0032's 26 h alert) so it does not depend on GitHub alone, and pushes to the existing `ALERT_NTFY_URL` | A watcher that is independent of Fly and GitHub                                                                                                                                                                                                                      | S      | Low. At a 5-minute cron it is about 8,640 invocations a month against 10 M.                                                                                                                                                                            |
| 4   | **Landing and pricing pages on Workers Static Assets**, attached by route patterns for `/` and the marketing paths only                                                              | The marketing pages stay up through Fly deploys (10–30 s of downtime each, SPEC §3.1) and take no load from the 2 GB machine; asset requests are free and unlimited                                                                                                  | M      | Low if routes are explicit patterns, so app traffic never passes through a Worker. ADR 0022 (SPA same origin) is untouched for the app. Needs the M3 landing redraw first.                                                                             |
| 5   | **A Queue between the Email Worker and `overture-web`**                                                                                                                             | Today `workers/inbound-mail/src/handler.ts` throws if the app answers non-2xx, so mail arriving during a deploy has no retry of its own. A queue retries up to 100 times and keeps messages up to 14 days                                                           | M      | Medium. It touches ADR 0028's signed-MIME path; mail over 128 KB needs an R2 pointer; 3 operations per message (about 333,000 messages a month included).                                                                                              |
| 6   | **Workers AI for the `email_classify` fallback** — **dropped (#287), see §5**                                                                                                        | About 2.1 Neurons per call at the recorded 412 input and 12 output tokens on `@cf/meta/llama-3.1-8b-instruct-fp8-fast` (4,119 and 34,868 Neurons per M tokens), so about 4,700 calls a day fit in the free 10,000 Neurons. Haiku 5.5 already costs 24 µUSD a call (SPEC §8.6), so the saving at today's volume is about 1.4 cents a user-month | M      | Medium. A weaker model on a path that can move a card forward (SPEC §11.3). Needs its own daily Neuron counter in the app, since free Neurons stop being free at 10,000 a day. Dropped: the cost review (#184) puts the line at cents a month and no local Workers AI evidence exists to prove equal accuracy (§5). |
| 7   | **Do not use Browser Run for sending applications** — **measured and dropped (#288), see §6**                                                                                        | See below                                                                                                                                                                                                                                                            | n/a    | High                                                                                                                                                                                                                                                   |

**Browser Run versus Browser Use (ranking 7, measured in §6).** On the rate card Browser Run is cheaper: at the recorded 9 min 16 s a send it is $0.0139 of browser time, or **$0.0164 per completed application** against Browser Use's $0.0265, and the 10 included hours cover about 64 attempts, or 54 completed. It does not fit the job:

1. It adds headers that "cannot be removed or overridden", including a Web Bot Auth signature, so every request announces itself as Cloudflare's bot ([automatic request headers](https://developers.cloudflare.com/browser-run/reference/automatic-request-headers/)); its own FAQ says Browser Run traffic is always identified as bot traffic.
2. The pricing and limits pages list no residential proxy, no egress-IP option and no CAPTCHA solving. Browser Use includes a solver, and ADR 0025's Greenhouse reCAPTCHA path is the case that matters. With a proxy at Browser Use's $5/GB the price is $0.0319 per completed application, over the $0.03 gate.
3. Concurrency billing ($2.00 per extra browser) and a 60-second idle timeout (up to 20 minutes with `keep_alive`) are easy to overrun by accident, and Browser Run has no native limit.

ADR 0016 also names Browser Use as the only browser that reaches real forms. The lab probe in §6 tested the driver and the request identity on the synthetic lab and dropped Browser Run; the revisit condition is in §6.

**Workable ingest on a Worker instead of the GitHub Action (ADR 0032).** Not recommended. The Action is free, has run on 159 MB of memory, and writes to R2 already. On Workers the measured full tagging pass is about one CPU-hour a day (3.6 M CPU-ms), which is 108 M a month against 30 M included (about $1.56 overage) and over the 5-minute CPU ceiling per invocation. The filtered 3-minute pass fits, but needs the tagging code and O\*NET index ported to a Worker and gains nothing over the Action. Only the freshness watch moves to Cloudflare (ranking 3).

### R2 for backups and exports

Already in place. Keep it inside the free tier by the Litestream settings chosen from the measurement below, R2 lifecycle rules on old snapshots ([lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)), and a size alert at 8 GB of the 10 GB. The commands and how to read them are in `docs/research/cloudflare-spend-guard-runbook.md` §7.

Measured 2026-11-01..21 with GraphQL Analytics, dataset `r2OperationsAdaptiveGroups`, filtered to bucket `overture-backups`, grouped by `actionType` ([R2 metrics](https://developers.cloudflare.com/r2/platform/metrics-analytics/)):

| Operation          | Count   | What it is                                        |
| ------------------ | ------- | ------------------------------------------------- |
| ListObjects        | 70,600  | largest line, about half of the month's Class A   |
| PutObject          | 56,400  | only when the WAL changed, not once per sync tick |
| DeleteObjects      | 7,300   | Litestream retention deletes, batch form          |
| UploadPart         | 3,000   | snapshot and large-LTX multipart uploads          |
| multipart (create + complete) | ~1,500 | one group per multipart file             |
| **total**          | **~140,000** | 14% of the 1 M Class A included               |

`overture-files` saw about 700 operations. Storage was nowhere near the 10 GB included.

**The month is not a run rate.** The first production deploy was 2026-11-20T22:04Z, so the app ran for
about two of the 21 days. The measured counts are consistent with that: the fixed LIST cost below is
~40k a day, and 70.6k ListObjects is about two days of it plus the snapshot and dashboard traffic. A
full month of the same code would have been ~1.21 M Class A and overage, so the "today's volume"
reading of this measurement was misleading even though every individual number is right.

**Two fixed LIST costs, both independent of user count** (class A, and the cause of 70.6k):

1. `src/server/platform/ports/backup.ts` read the replica's lag with `litestream ltx -json -level all`
   every `backups.replica_read_interval_ms` (30 s). `-level all` iterates levels 0..9, and each level is
   one ListObjectsV2 call: 10 calls × 2 a minute = **28,800 a day**, ~864k a month if the machine is up.
2. Litestream v0.5.18 runs `Store.monitorL0Retention` every `l0-retention-check-interval` (default 15 s).
   `DB.EnforceL0RetentionByTime` lists level 1, then level 0 when level 1 is non-empty: two
   ListObjectsV2 calls per tick = **11,520 a day**, ~346k a month for one database. Snapshot retention
   and compaction do not list per tick; their level info is memoised, and snapshot retention runs on the
   24 h snapshot tick.

**What changed for #281.** The lag read now asks for one level at a time, 0 upward, and stops at the
first level that holds a file (new transactions always land at level 0, and compaction only moves or
deletes older files upward), so steady state is **one** list instead of ten: 28,800 → 2,880 a day.
`litestream.yml` sets `l0-retention-check-interval: 5m`, so the retention monitor lists twice every five
minutes instead of every fifteen seconds: 11,520 → 576 a day. The fixed floor is now **~3,500 a
day, ~104k a month, 10% of the allowance**, before writes.

**Retention settings cannot lower the list cost without losing the restore.** `snapshot.retention: 720h`
(with `snapshot.interval: 24h`) is the 30-day restore: it is enforced once per snapshot tick and costs
almost nothing in ListObjects, so shortening it would lose restore coverage for no Class A saving.
`l0-retention-check-interval` is the only retention knob that lowers ListObjects, and it does not touch
the 30-day restore at all: it only delays sweeping L0 files that are already older than the
`l0-retention: 5m` mark, i.e. fine-grained per-sync restore points, not snapshot coverage. `sync-interval: 1s` stays: PUTs
were 56.4k in the window and are driven by the write rate, not by the tick.


## 3. The $5 hard cap

### What Cloudflare offers

Source: [Spending limits and alerts](https://developers.cloudflare.com/billing/manage/spend-management/), [Workers spending limits](https://developers.cloudflare.com/workers/platform/spend-management/), [cf CLI guide](https://developers.cloudflare.com/billing/manage/spend-management/cli/), [Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/).

| Control                          | Scope                                                      | At the threshold                                                                                                                                    | Limits to know                                                                                                                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spending limit (`usage_block`)   | **Workers only**, or **Durable Objects only**, account-wide | "Cloudflare blocks the product's supported operations" until the next billing period or a change                                                    | Counts requests and CPU after included usage, excludes the $5 subscription. Cannot target one Worker. The minimum is any amount greater than zero with two decimals, so $0.01 works. "A limit does not guarantee a maximum invoice amount": reporting and blocking take time. |
| What a Workers limit blocks      |                                                            | HTTP requests (error 1103), Cron Triggers, queue consumers, **Email Worker invocations**, calls from other Workers                                  | Static assets served without running a Worker keep working. Requests blocked by the limit are not billed.                                                                                                                                                       |
| Email alert (`notification`)     | Workers or Durable Objects                                 | Emails at 80% and 100%; service keeps running                                                                                                       | The dashboard does not attach an address automatically; set `notification_email` with the cf CLI.                                                                                                                                                               |
| Budget alert                     | Account-wide usage-based spend, all products               | One email when cumulative spend crosses a dollar amount                                                                                             | "Informational only. They do not pause or limit usage." Pay-as-you-go accounts only.                                                                                                                                                                            |
| AI Gateway spend limit           | AI requests through a gateway, by user, model or provider  | `429` until the window resets; up to 20 rules per gateway                                                                                           | "Eventually consistent": a burst can briefly exceed it. Covers Workers AI and BYOK providers with known pricing.                                                                                                                                                |
| Per-invocation CPU limit         | One Worker                                                 | Invocation is stopped                                                                                                                               | `limits.cpu_ms` in the Wrangler file; stops a runaway loop, not total spend ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)).                                                                                                   |
| Billable usage dashboard and API | Account, per product, daily                                | none                                                                                                                                                | Dashboard data matches the invoice. The usage endpoints (`GET /accounts/{account_id}/billable-usage`) are labelled **Alpha** in the API reference; the v2 one is also "Restricted". Treat as best effort.                                                       |

**Plain statement: Cloudflare has no native hard cap on total account spend.** The only blocking limits cover Workers and Durable Objects. R2, Queues, KV, D1, Workers AI, Browser Run, Vectorize and Email Sending can all bill past their allowance with nothing native to stop them; the docs say support for more products "is coming soon". The invoice is the only final record.

### How to make overage impossible or self-stopping

Layer these. None is exact; together they keep the plan inside its allowances.

1. **Stay inside the allowances by design (the real cap).** Use only products where Overture's volume is orders of magnitude under the free amount: Workers, the Email Worker, Queues, Static Assets and the sentinel. Do not adopt Browser Run, Containers, Workflows, Vectorize, D1, KV or Durable Objects.
2. **Workers spending limit at $0.01** (`cf billing spend-policies create --product-id workers --action usage_block --threshold-cents 1 --notification-email <owner>`). The first cent of overage stops all Worker invocations. Cost of tripping it: the Email Worker stops, so inbound ATS mail is lost until the period resets or the limit is lifted. That is why the sentinel warns long before this point, and why the owner should know the trade before it is turned on.
3. **Durable Objects spending limit at $0.01** even though none are used, so a future accidental binding cannot bill.
4. **Budget alert at $0.50 and an email alert at 80% of the Workers limit**, to the owner. Budget alerts cover R2 and everything else, the only account-wide signal.
5. **A scheduled sentinel Worker as the self-stopping part for products with no native limit.** Every 15 minutes it reads usage (GraphQL Analytics for R2 operations, Queues operations and Worker CPU; the alpha billable-usage API as a cross-check) and compares each metric to its allowance:
   - at 70%: push to the owner's ntfy URL;
   - at 90%: act on what Overture controls, by writing a "degraded" flag the app reads (stop non-essential R2 writes such as export copies, use rules only for `email_classify`, queue mail without retries) and ntfy again.
   - It cannot natively block R2: the only hard action is revoking the R2 API token, which would stop backups, so it must not do that. R2 is therefore kept safe by design (the measured list cost in §2, the lifecycle rules and the 8 GB size alert) and alerted on, not blocked.
6. **App-side counters for the rest**, matching the existing fail-closed caps in SPEC §8.6: a monthly Email Sending count (3,000 included, refuse above 2,700). A Workers AI Neuron count is not needed: ranking 6 is dropped (§5). An AI Gateway spend limit is an optional second belt for Workers AI if it is ever revived.

**What "self-stopping" cannot promise:** because the limits are eventually consistent and the usage API is alpha, a sudden spike (a loop, a leaked token) can still cost a few cents to dollars before it is stopped. Cloudflare offers a goal here, not a guarantee, and the owner should treat "never above $5" that way.

## 4. Follow-up tickets

For the orchestrator to cut. Order is the ranking above.

| #   | Title                                                                           | Scope in one line                                                                                                                                                  | Blocked by                                                         |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 1   | ~~Measure R2 Class A operations from Litestream and set a safe `sync-interval`~~ | Done in #281: measured 2026-11-01..21, ListObjects found to be the driver (the lag read and the L0 retention monitor), the read cut from ten lists to one, `l0-retention-check-interval: 5m`, lifecycle rules and an 8 GB alert. | closed |
| 2   | Owner setup: Workers and Durable Objects spending limits and budget alerts      | Create the two `usage_block` policies and a budget alert with `notification_email`; document the trade (the Email Worker stops when tripped) in the runbook.        | owner decision on ADR 0033; token with Billing Edit                |
| 3   | Sentinel Worker: external health probe, Workable freshness, usage watchdog      | Cron Worker with ntfy alerts, a usage check against allowances and a degraded flag the app reads; tests with recorded GraphQL fixtures.                            | 2                                                                  |
| 4   | App: monthly Email Sending counter                                              | Count sends, refuse above 2,700 a month, alert the owner; tested against the real adapter.                                                                         | none                                                               |
| 5   | Landing and pricing on Workers Static Assets                                    | Deploy the redrawn marketing pages as static assets with route patterns for the marketing paths only; app traffic never touches the Worker.                        | M3 landing redraw                                                  |
| 6   | Inbound mail through a Queue                                                    | Email Worker enqueues the signed MIME (R2 pointer above 128 KB); a consumer posts to `/internal/mail/inbound` with retries and a dead-letter queue; update ADR 0028. | 2 (the limit also stops the consumer)                              |
| 7   | ~~Workers AI `email_classify` trial (optional)~~                                | Dropped in #287 (§5): the cost review puts classification spend at 24 µUSD a call and no local Workers AI response exists to prove equal accuracy.                 | closed                                                             |
| 8   | ~~Revisit Browser Run only if the M1 cost gate fails~~                          | Dropped in #288 (§6): the lab probe under Browser Run's request identity completed every recorded form, but the lab has no bot filter, and Browser Run always identifies as a bot, has no documented proxy and no solver; $0.0164 per completed without a proxy, $0.0319 with one at $5/GB.                                              | closed                                                              |

## 5. `email_classify` on Workers AI: measured on the recorded fixtures (issue #287)

**Verdict: do not adopt. Dropped.** `email_classify` stays rules plus Haiku (SPEC §8.6, §11.3) and no Neuron counter is added: no production code changes, only the e2e pin below.

### What was measured, and what was not

Measured locally on 2026-11-21, with no network call (ADR 0016): the nine recorded `.eml` fixtures in `test/e2e/fixtures/mail/` were parsed with `mailparser` exactly as `src/server/inbox/ingest.ts:236-241` does it (code first, then `classifyMail` with the sender's ATS, `src/server/inbox/codes.ts:228-245`), and the one recorded Haiku answer was read from `test/e2e/fixtures/anthropic/email-classify-recording.jsonl`.

**Not measured: Workers AI.** There is no Workers AI binding in `workers/inbound-mail/wrangler.jsonc`, no recorded Workers AI response in the repository, and no Cloudflare account reachable from the development box. The comparison #287 asks for ("adopt only if it is equal") therefore cannot be made on evidence, and no accuracy number below is a Workers AI number. The Neuron figures are arithmetic on Cloudflare's published rates applied to the recorded token counts, not a measured call.

### Accuracy on the recorded fixtures

| Fixture                          | Sender ATS        | Rules label | Needs the model  | Recorded Haiku | Label the product uses |
| -------------------------------- | ----------------- | ----------- | ---------------- | -------------- | ---------------------- |
| `acme-reply.eml`                 | none (not an ATS) | `other`     | no               | —              | `other`                |
| `greenhouse-ack.eml`             | greenhouse        | `ack`       | no               | —              | `ack`                  |
| `greenhouse-code.eml`            | greenhouse        | `code`      | no               | —              | `code`                 |
| `greenhouse-interview-brief.eml` | greenhouse        | `interview` | no               | —              | `interview`            |
| `greenhouse-interview.eml`       | greenhouse        | `interview` | no               | —              | `interview`            |
| `greenhouse-offer.eml`           | greenhouse        | `offer`     | no               | —              | `offer`                |
| `greenhouse-rejection.eml`       | greenhouse        | `rejection` | no               | —              | `rejection`            |
| `greenhouse-unclear.eml`         | greenhouse        | `other`     | yes (ATS sender) | `interview`    | `interview`            |
| `personio-rejection.eml`         | personio (German) | `rejection` | no               | —              | `rejection`            |

- **Rules alone: 7 of the 9 get a decisive label, and both `other` results are honest.** `acme-reply.eml` is not ATS mail and never reaches the model; `greenhouse-unclear.eml` is the one mail that does.
- **Rules plus the recorded Haiku answer: 8 of 9 labelled**, with the ninth correctly left `other` because its sender is not an ATS (`src/server/inbox/moves.ts:362`).
- **Workers AI: 0 of 9 measured.** No fixture, no recorded answer, no local call.

These fixtures are asserted end to end, not just read here: `test/e2e/email-stage-moves.test.ts:413` (the German rejection moves the card with zero model batches) and `:442` (the unsure mail calls the model once and records its cost), with the ack, code, interview, offer and reply fixtures covered by `test/e2e/inbound-mail.test.ts`, `test/e2e/inbox.test.ts` and `test/e2e/flow-28-notifications.test.ts`. #287 adds one table-driven test in `test/e2e/email-stage-moves.test.ts` ("every recorded mail fixture keeps the label the research table records") that forwards all nine through the real inbound path and asserts the "Label the product uses" column, so this table cannot drift without a failing test. No unit test is added: a unit test file needs an invariant on ADR 0013's list, and this classification is already exercised through the real endpoint (ADR 0013).

### Cost, from the recorded tokens and the code's own price row

One classification is 412 input and 12 output tokens in the recording. At the 5.5 batch row the code prices (`batchPricesFor(DEFAULT_ANTHROPIC_MODEL)`, `src/server/platform/llm/models.ts:26-33`: $0.05 and $0.25 per MTok) that is 23.6 µUSD, charged as **24 µUSD a call**, one microdollar above cost-m1 §2.3's $0.000023 from its 360-token estimate.

| Volume                                            | Calls   | Haiku, today | If Workers AI were free | Saving   |
| ------------------------------------------------- | ------- | ------------ | ----------------------- | -------- |
| One application (two classifications, cost-m1 §2.3) | 2     | $0.000048    | $0            | $0.000048 |
| Week plan at its cap (70 applications)             | 140     | $0.0034      | $0            | $0.0034  |
| Month plan at its cap (300 applications)           | 600     | $0.0144      | $0            | $0.0144  |
| Ten beta users on Month                            | 6,000   | $0.144       | $0            | $0.14    |
| 300 Month users, each at 10 a day (M3 ceiling)      | 180,000 | $4.32        | $0.89 (overage only)    | **$3.43** |

The last row is the whole case for adopting: a **$3.43 a month** saving against $10,500 of revenue, and only after a counter, a degraded path and an accuracy proof exist. Ten beta users at the Month plan's cap (the fourth row) is 14 cents a month; below that it is cents. That is exactly the condition #287 gives for skipping.

### The counter would guard a budget the workload cannot reach

One call is about **2.1 Neurons** by Cloudflare's rates (412 × 4,119 + 12 × 34,868 per M tokens), so the free 10,000 Neurons a day is about 4,700 calls and the proposed 8,000 stop is about 3,780. Ten beta users each at the Month plan's 10 applications a day is about 200 calls a day, about 423 Neurons, or 4 % of the daily allowance. A counter and a rules-only degraded path for a beta wave that uses 4 % of the allowance is machinery with no job; if Workers AI is ever revived at M3 volume, the counter belongs in the same pull request as the live comparison, not before it.

### When to revisit

- `/admin/api/llm-usage?purpose=email_classify` (SPEC §13.3) reports more than **$1 a month** over 30 days of real traffic, or
- a **recorded Workers AI response** for these fixtures exists — an owner-run capture or a daily live check — so accuracy can be compared on the same evidence Haiku is judged on.

Until then the fallback stays on Haiku: it is 24 µUSD a call, it is measured on the fixtures above, and it is the model ADR 0007 and SPEC §8.6 already chose.

## 6. Browser Run on the synthetic lab: measured, and dropped (issue #288)

**Verdict: do not adopt.** #288 is the "revisit only if the M1 cost gate fails" spike from §4. It ran the lab probe
recorded below on 2026-11-22 and drops Browser Run: the price is lower only from Cloudflare's own egress with the bot
signature attached, the proxy that would fix the identity is not a documented option at all, and every documented
property of the product points the other way on the one thing that decides the business, the completed-application
rate.

### The trigger had not fired

#288 is blocked by #38 (the owner's live run and the M1 gate), which is still open, so no real send has measured the
gate. Its stand-in is the recorded session in `docs/research/cost-m1.md` §2: **$0.0265 per completed application**, under
the $0.03 gate by 12 %. Measured against the gate's own terms, the price case for Browser Run is real (−38 % per
completed application) but it is not a case the gate asks for. **Drop now; the gate has not missed.** The revisit
condition is at the end of this section.

### What was measured, and what was not

Measured locally on 2026-11-22, on this machine, with no network call and no Browser Run session (ADR 0016, and no
Browser Rendering token exists in the repository): the production lab driver (`src/server/lab/runner.ts`, `drivePage`)
drove the real lab pages (`src/server/lab/pages.ts`) with a headless Chromium whose every request carried the headers
Browser Run adds and does not let a session remove. One session per page; 5 recorded ATS forms, 3 challenge pages with
the challenge allowed to pass, and the same 3 with it held visible. The probe is `scripts/measure-browser-run-lab.ts`
(`bun run scripts/measure-browser-run-lab.ts`, about 2–3 s of driving); it exits non-zero if a form stops completing or a
header stops reaching the origin, so the table below can be reproduced rather than trusted.

| Browser Run request identity, as sent by the probe | Value |
| --- | --- |
| `cf-biso-devtools` | present on every navigation |
| `cf-brapi-devtools` | present on every navigation (simulated request id) |
| `Signature-agent`, `Signature`, `Signature-input` | present on every navigation (simulated key, documented shape) |
| `navigator.webdriver` | `true` |
| `navigator.userAgent` | `HeadlessChrome/159.0.8154.6` |
| outbound host | the lab origin only; no vendor host was contacted |

**Not measured: Browser Run itself.** No `wss://api.cloudflare.com/…/browser-run/devtools/browser` session was opened,
so no Cloudflare IP, no Cloudflare TLS fingerprint, no real Web Bot Auth signature and no Browser Run quota was
exercised. The lab has no bot filter, so completion parity on it is expected and proves only that Overture's driver can
fill the five forms from a headless browser that announces itself as a bot. It cannot measure the completed-application
rate, and nothing below claims it does.

### Lab results

The probe's own output on 2026-11-22 (one drive per row; the durations vary between runs and are the lab's, not a real
form's):

| page | outcome | challenge seen | score | ms |
| --- | --- | --- | --- | --- |
| `form:greenhouse` | completed | no | — | 484 |
| `form:lever` | completed | no | — | 286 |
| `form:ashby` | completed | no | — | 657 |
| `form:workable` | completed | no | — | 705 |
| `form:personio` | completed | no | — | 317 |
| `recaptcha_v3` | completed | yes | 0.9 | 97 |
| `hcaptcha` | completed | yes | — | 91 |
| `turnstile` | completed | yes | — | 100 |
| `recaptcha_v3` held | `challenge_blocked` | yes | — | 113 |
| `hcaptcha` held | `challenge_blocked` | yes | — | 91 |
| `turnstile` held | `challenge_blocked` | yes | — | 97 |

Browser Use on the same pages, from `test/e2e/lab-synthetic.test.ts` and its recorded fixtures: 5 of 5 forms completed,
3 of 3 challenge pages completed with the reCAPTCHA page scoring 0.9, and the held pages `challenge_blocked`.

Both are 5 of 5 forms and 3 of 3 clearable challenges because **the lab has no bot filter**: the challenge is a switch,
not a score, so the lab cannot separate the two providers. The row that does separate them is the last three, and only
because the two products handle a held challenge differently: Browser Use creates its session with `solveCaptchas: true`
(SPEC §10.3), while Browser Run has no solver. Overture's send path has no human takeover — a still-visible Turnstile box
is `captcha_blocked`, one retry, then `failed` (SPEC §9.2, §10.3) — so every held challenge that Browser Use clears is a
lost application on Browser Run.

The sharpest case is Personio, whose submit button a **Cloudflare Turnstile** box can hold (SPEC §10.3), and
Greenhouse's invisible reCAPTCHA v3, which scores the exit IP and fingerprint before the script gets to work. Browser
Run's own documentation says its traffic is *always* identified as bot traffic, its outbound addresses are Cloudflare's
with no per-request rotation, and allowlisting it on a zone needs an Enterprise WAF skip rule
([FAQ](https://developers.cloudflare.com/browser-run/faq/), [automatic headers](https://developers.cloudflare.com/browser-run/reference/automatic-request-headers/)).
There is no documented way to allowlist it past a third-party Turnstile widget at all.

### Cost per application, from the rate card and the recorded session

`cost-m1.md` §2.1's recorded send used **2.71 MB and 556 s (9 min 16 s)** of active browser session. At Browser Run's
$0.09 a browser-hour after the 10 included hours ([pricing](https://developers.cloudflare.com/browser-run/pricing/))
that session costs **$0.0139**, against Browser Use's $0.00927 browser line on the same session. The proxy line is what
decides the comparison:

| Configuration | Per attempt | Per completed (÷ 0.85) | Against the $0.03 gate |
| --- | --- | --- | --- |
| Browser Use today (2.71 MB at $5/GB) | $0.02250 | $0.02647 | 12 % under |
| Browser Run, no proxy (Cloudflare egress) | $0.01390 | $0.01635 | 45 % under |
| Browser Run + Browser Use's $5/GB proxy | $0.02713 | $0.03192 | **6 % over** |
| Browser Run + Evomi $0.49/GB | $0.01520 | $0.01788 | 40 % under |
| Browser Run + DataImpulse $1/GB | $0.01655 | $0.01947 | 35 % under |

The cheap rows are the ones Browser Run cannot deliver: the product has **no proxy or egress-IP option** (no page in
its documentation index covers proxies; the FAQ says all rendering traffic comes from Cloudflare IP ranges with no
rotation). "Browser Run behind our own proxy", the configuration #288 asked about, is not a documented configuration:
a proxy configured inside the browser would still leave through Cloudflare's edge first, and this spike did not test
that. The one price that is both documented and real is $0.0164 per completed application **from Cloudflare IPs that
any bot filter can name**, and that price is irrelevant if the form does not complete.

Volume, for the record (the 10 included hours, monthly rounding: the month's total is rounded to the nearest whole hour,
30 minutes up):

| Volume | Browser-hours | Browser Run | Browser Use (same sessions) |
| --- | --- | --- | --- |
| One Month-plan user (353 attempts) | 54.5 h, 10 free → 44.5 h | **$4.01** ($0.0134/completed) | $7.94 |
| 300 such users (105,900 attempts) | 16,357 h | **$1,471** | $2,383 |
| 10 included hours alone | 600 min ÷ 9.27 min | 64 attempts, ~54 completed | n/a |

Concurrency is free at Overture's scale: 10 browsers are included, and one process admits at most 3 sessions by
default (`browser.max_concurrent_sessions`, SPEC §12), so the $2.00 per extra browser never applies on one machine. A
multi-machine M3 would have to watch the monthly average of daily peaks.

### Why it is dropped

1. **It is always identified as a bot, and that is the product's one hard requirement to avoid.** The success rate is
   what ADR 0003 chose Browser Use for over price. Non-removable `cf-biso-devtools`/`Signature` headers, Cloudflare
   egress, no rotation, and the vendor's own FAQ statement make every request attributable, and the product already
   knows Greenhouse scores the exit IP and fingerprint.
2. **The lab cannot show parity, and the documented facts point the other way.** The probe proves the driver works and
   the headers are on the wire; it cannot produce a completed-application rate, and 5 of 5 on a filterless lab is not
   evidence of one.
3. **No CAPTCHA solving closes the gap Browser Use's price includes.** Overture's send path already turns a visible
   challenge into `captcha_blocked` → one retry → `failed`; Browser Run has no solver and no documented allowlist.
4. **There is no proxy to bolt on.** The cheaper configuration in #288's premise is not documented; the only real
   price, $0.0164/completed, is 45 % under the gate but buys a browser that announces itself.
5. **The saving is small beside the risk.** $912 a month at the M3 ceiling (300 Month users sending at the daily cap)
   against $10,500 of revenue, and about $31 a month for the M2 beta's ten users. ADR 0003 chose Browser Use for success
   rate over price; trading the one property that decides whether an application is sent for a 38 % unit-cost cut the
   gate does not ask for is the wrong trade at every volume in SPEC §2.
6. **Platform shape.** No vendor profile store (one persistent per-user profile would have to be built on R2 from
   Playwright `storageState`, a new privacy surface), sessions close on 60 s of inactivity unless `keep_alive` is set
   high enough (up to its 20-minute ceiling) for the 10-minute code wait, a Cloudflare release closes sessions, and
   Browser Run has no native spend limit (§3). Each is small; together they are a second browser platform for a price
   the gate does not ask for.

### When to revisit

Only all three together:

- #38's live numbers **miss** the $0.03 gate on cost while holding ≥ 85 % completion on Browser Use, and
- Cloudflare documents a **proxy or egress-IP option** for a Browser Session (or a WAF/Turnstile allowlist that works
  without Enterprise), and
- the price after the proxy still lands under the gate: at Browser Use's $5/GB it does not ($0.0319), so it needs a
  proxy near Evomi's $0.49/GB and a documented way to attach it.

Until then Browser Use stays the only browser that reaches real forms (ADR 0003, ADR 0016) and the decision in ADR 0033
stands.

## Not verified

- The alpha billable-usage API response shape was not called; the sentinel ticket must record a real response first.
- Workers AI's accuracy and Neuron use per classification are unknown: no call was made and no response is recorded (§5). Only the arithmetic on its published rates exists.
- Whether Workers AI's free 10,000 Neurons a day counts toward an AI Gateway spend limit is not stated on the pages read.
- The R2 operation counts are measured (§2). Storage size per bucket was not read; the 8 GB alert is the first reading. Re-measure once M2 users arrive and record Class A per user per month (#281).
- Cloudflare Registrar renewals and any plan on another Cloudflare product (Access, Turnstile, DNS) are outside the Workers plan and not counted here.
- **Browser Run was not called** (§6): no session was opened, so its real IP reputation, TLS fingerprint, the 60-second
  idle close and the 20-minute `keep_alive` ceiling are read from the documentation, not observed. The lab measured the
  driver and the headers only. The completed-application rate that decides the question is still unknown, and the
  recommendation does not rest on it: it rests on Browser Run always identifying itself as a bot and on there being no
  documented proxy.

