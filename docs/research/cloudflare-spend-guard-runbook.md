# Cloudflare spend guard: spending limits and budget alerts

**Deliverable for issue #280**, implementing ADR 0033 on top of the research in
`docs/research/cloudflare-paid-plan.md`. It records what is live on the account, the exact commands, how to read a
policy, how to lift a tripped limit, and the trade the owner accepted: a tripped Workers limit also stops the
inbound-mail Email Worker, so inbound ATS mail is lost until the limit is lifted or the billing period resets.
Everything below was run from the development box on 2026-11-21 against our own Cloudflare account. It contacts no
ATS (ADR 0016).

## 1. What is live

| Control | Scope | Setting | Read with |
| --- | --- | --- | --- |
| Workers spending limit | Workers, account-wide | `usage_block` at 1¢, email to the owner at 80% and 100% | `cf billing spend-policies list` |
| Durable Objects spending limit | Durable Objects, account-wide | `usage_block` at 1¢, email to the owner at 80% and 100% | `cf billing spend-policies list` |
| Budget alert | Account-wide usage-based spend, all products | One email when spend crosses $0.50 | `cf alerting policies list` |
| Default budget alert | Account-wide, all products | Cloudflare's auto-created $10 alert, left on as a second tier | `cf alerting policies list` |

Cloudflare's rate card and the [spend-management docs](https://developers.cloudflare.com/billing/manage/spend-management/)
say plainly that a spending limit is not a maximum invoice amount, and that only Workers and Durable Objects can be
blocked. The 1¢ limits are therefore the tightest native guard that exists, not an account-wide cap; §6 lists what
they do not cover.

The 80% Workers email is the spending limit's own notification: Cloudflare emails the policy's address at
`approaching_limit` (80% of the threshold) and `limit_reached` (100%). A second Workers `notification` policy is not
needed, and only one enabled limit per product is allowed.

The list output at the time of writing (the owner's address is in the account, not in this repo):

```json
[
  {
    "id": "9cb5a33d-b733-4d4d-bf37-988af671c98a",
    "account_id": 71602645,
    "name": "Durable Objects $0.01 spending limit",
    "product_id": "durable_objects",
    "enabled": true,
    "threshold_cents": 1,
    "action": "usage_block",
    "notification_email": "...",
    "version": 1,
    "current_state": {
      "status": "below_limit",
      "billing_period_start": "2026-11-20T04:08:48Z",
      "billing_period_end": "2026-12-20T00:00:00Z",
      "balance_cents": 0,
      "evaluated_at": "2026-11-21T12:26:55.0439735Z",
      "enforcement": { "desired_state": "inactive", "delivery_status": "succeeded", "desired_generation": 1, "applied_generation": 1 }
    }
  },
  {
    "id": "2fe03b65-07d4-4720-8a91-81f8e96f563a",
    "account_id": 71602645,
    "name": "Workers $0.01 spending limit",
    "product_id": "workers",
    "enabled": true,
    "threshold_cents": 1,
    "action": "usage_block",
    "notification_email": "...",
    "version": 1,
    "current_state": {
      "status": "below_limit",
      "billing_period_start": "2026-11-20T04:08:48Z",
      "billing_period_end": "2026-12-20T00:00:00Z",
      "balance_cents": 0,
      "evaluated_at": "2026-11-21T12:26:55.0439735Z",
      "enforcement": { "desired_state": "inactive", "delivery_status": "succeeded", "desired_generation": 1, "applied_generation": 1 }
    }
  }
]
```

```json
[
  {
    "id": "5f2d4ecaff3f4fc79e65e2fe4dc941f6",
    "name": "Overture budget alert $0.50",
    "description": "Account-wide usage-based spend crossed $0.50 in the billing period. Informational; it does not stop usage (ADR 0033).",
    "enabled": true,
    "alert_type": "billing_budget_alert",
    "mechanisms": { "email": [{ "id": "..." }] },
    "created": "2026-11-21T12:27:34.252083Z",
    "modified": "2026-11-21T12:27:34.252083Z",
    "filters": { "total_spend_dollars": ["0.5"] }
  },
  {
    "id": "6557cc4a06af462d9536d311de04dae7",
    "name": "Default budget alert (auto-created)",
    "enabled": true,
    "alert_type": "billing_budget_alert",
    "mechanisms": { "email": [{ "id": "..." }] },
    "filters": { "total_spend_dollars": ["10"] }
  }
]
```

## 2. The commands, as run

`cf` is Cloudflare's own CLI ([install](https://developers.cloudflare.com/cf/get-started/)), not the GNOME screen
reader of the same name. It needs Node LTS (not Bun) and its own credentials; it does not reuse a Wrangler login.

```sh
npm install --global cf          # 1.0.0-rc.2 here
cf --version

# Account-owned token. Permissions used: Account > Billing > Edit (spend policies) and
# Account > Notifications > Edit (notification policies); Read is enough to inspect.
export CLOUDFLARE_API_TOKEN=...  # never echoed, never committed
export CLOUDFLARE_ACCOUNT_ID=...
```

```sh
# Workers spending limit at one cent, with email at 80% and 100% of it.
cf billing spend-policies create \
  --name 'Workers $0.01 spending limit' \
  --product-id workers --enabled true \
  --threshold-cents 1 --action usage_block \
  --notification-email <owner address>

# Durable Objects spending limit, so a future accidental binding cannot bill.
cf billing spend-policies create \
  --name 'Durable Objects $0.01 spending limit' \
  --product-id durable_objects --enabled true \
  --threshold-cents 1 --action usage_block \
  --notification-email <owner address>

# Account-wide budget alert: informational only, it does not stop usage.
cf alerting policies create \
  --name 'Overture budget alert $0.50' \
  --description 'Account-wide usage-based spend crossed $0.50 in the billing period. Informational; it does not stop usage (ADR 0033).' \
  --alert-type billing_budget_alert --enabled true \
  --filters-total-spend-dollars '0.5' \
  --mechanisms-email '[{"id":"<owner address>"}]'
```

`--dry-run` on either command prints the exact HTTP request without sending it. `cf billing spend-policies list`
shows what exists; the dashboard path is **Manage Account → Billing → Billable Usage → Budget alerts**.

## 3. Reading a policy

- `cf billing spend-policies list` — the policy and its `current_state`: `balance_cents` (spend counted this period),
  `status` (`below_limit`, and a tripped state when the limit applies), `billing_period_start`/`_end`, and
  `enforcement` (`desired_state`, `delivery_status`, `desired_generation` vs `applied_generation`). Enforcement is
  eventually consistent: a `desired_state` of `active` with a lagging `applied_generation` means the block is being
  applied, not ignored.
- `cf billing spend-policies get <policy-id>` — the same, plus the `version` needed to update or delete it.
- `cf billing spend-policies activity list --limit 25` — configuration changes, including deletions, with the actor
  (our token is `com.cloudflare.api.token.<id>`) and before/after settings. `--period all` reads every cycle.
- Threshold events (`approaching_limit`, `limit_reached`) are not a `cf` subcommand in 1.0.0-rc.2; read them from the
  dashboard, or with the API:
  `curl -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/billing/spend-policies/<policy-id>/audit"`.
- `cf alerting policies list` — the budget alerts. Cloudflare delivers a budget alert once per billing period when
  cumulative usage-based spend crosses the threshold; it never blocks anything.

## 4. Lifting a tripped limit, and re-arming it

A tripped limit stays tripped for the rest of the billing period until it is lifted. Updates replace the whole
policy: pass every required flag, and `--if-match <version>` so a concurrent change is not overwritten.

```sh
# 1. See what tripped it: the balance, and which Worker burned the CPU or requests.
cf billing spend-policies get <policy-id>
cf billing spend-policies activity list --limit 25
# Workers Analytics (dashboard) or the Workers Logs for the period shows the script.

# 2. Lift it. Turning off, raising above current spend, or switching to `notification` all lift the block.
cf billing spend-policies update <policy-id> --if-match <version> \
  --name 'Workers $0.01 spending limit' \
  --product-id workers --enabled false \
  --threshold-cents 1 --action usage_block \
  --notification-email <owner address>

# 3. Fix the cause (stop or revert the offending Worker), then re-arm with the same command and --enabled true.
```

Deleting the policy also lifts the block but loses the guard; prefer `--enabled false` and re-arming the same
policy. Lowering a threshold below spend already recorded in the period can block at once. Changes take time to
apply, and lifting does not reset recorded spend.

## 5. The trade: the Email Worker and inbound mail

Cloudflare blocks these Workers operations at the limit: HTTP requests (error `1103`), Cron Triggers, queue
consumers, **Email Worker invocations**, and calls between Workers. Static assets served without running a Worker keep
working. Requests refused by the limit are not billed.

For Overture that means: while the Workers limit is tripped, the catch-all Email Worker (`workers/inbound-mail`,
ADR 0028) cannot run, so mail forwarded to a user's `…@tryoverture.com` address is not accepted and is lost. Email
Routing's own retry only covers a Worker that answers non-2xx; a Worker that cannot be invoked has nothing to retry
into. Nothing backfills that window: a user's Inbox is missing whatever ATS mail arrived, their cards do not move
from it, and the 21-day Check-in is the fallback that still asks. Sign-in mail and outbound mail are sent through
Cloudflare Email Sending from the Fly app, which the Workers limit does not block; the app on `overture-web` is not a
Worker either, so the product keeps working while inbound mail does not.

The queue consumer stops with everything else, and that is intended (#286): the delivery path is a Worker, so there is
no way around the limit. Mail that was already on `overture-inbound-mail` before the trip is not lost — the consumer is
simply not invoked, no retry is spent, and the message is delivered after the limit is lifted or the period resets,
inside the 14-day retention. Check `wrangler queues info overture-inbound-mail` for the backlog after a trip; a message
that stayed queued past retention is gone and only the dead-letter alert (if it reached the DLQ) remains. A message
over 128 KB that was spilled to `overture-inbound-mail-spill` stays there until delivery or the 30-day lifecycle rule.

Inbound mail resumes by itself once the limit is lifted or the period resets; there is no redeploy and no Cloudflare
change beyond §4. What was lost in the window stays lost, so the order matters: read usage, fix the Worker that
overspent, lift the limit, re-arm it, then tell affected users to re-forward anything they are waiting on.

The owner accepted this trade in ADR 0033. The sentinel that warns at 70% before the trip is #283
(`workers/sentinel`): it probes health from outside Fly, watches the Workable snapshot's age and reads R2, Queues and
Workers usage from GraphQL Analytics every ten minutes. Once it is deployed with its secrets it pushes to ntfy at 70%
and, at 90%, writes `ops/degraded.json`; until then the first signal is the 80% email from the limit itself. The app
reads that flag through `src/server/platform/degraded.ts` and logs each change (rules-only `email_classify`, no
live-check R2 round trip).

## 6. What these guards do not cover

Only Workers and Durable Objects can be blocked. R2, Queues, Workers KV, D1, Workers AI, Vectorize, Browser Run,
Cloudflare Email Sending, Workflows, Containers and Images have no native limit; at most there is an email alert. For
Overture the plausible ones are R2 (Litestream's write rate, #281), Email Sending (3,000 a month, app-side counter
#282) and, if adopted, Workers AI neurons. R2 cannot be blocked natively: revoking its token would stop the backups,
so it stays bounded by design, lifecycle rules and a size alert. The budget alert at $0.50 is the only account-wide
signal until the sentinel (#283, built) is deployed and the app-side counters land.

## 7. R2: lifecycle rules and the 8 GB size alert

The measurement and the reason for these two controls are in `docs/research/cloudflare-paid-plan.md` §2. R2
cannot be blocked natively: revoking its token would stop the backups. It is bounded by design instead. The
Litestream side of that bound shipped in #281 (`litestream.yml`, and the backup lag read in
`src/server/platform/ports/backup.ts`); this section is the account side: one lifecycle rule that outlives
Litestream, and one alert before the 10 GB included storage runs out.

**State:** the commands below are the owner-run step and are not applied yet. The development box holds no
Cloudflare token, and none of these calls belongs in the app or in tests (ADR 0016). Run them once with a
token that has **Workers R2 Storage Write** (lifecycle) and **Account Notifications Edit** (alert), then
paste the read-backs into this section.

### 7.1 Lifecycle rule: expire Litestream files older than 35 days

Litestream already deletes its own files at 30 days (`snapshot.retention: 720h`,
`retention.enabled: true`). The lifecycle rule is the backstop for a stopped or broken retention run: it
deletes anything under the replica path that is older than 35 days, five days after Litestream's own window,
so it can never remove a file the 30-day restore still needs. It touches only the `app.sqlite/` prefix, which
holds every Litestream level (`app.sqlite/0000/` through `app.sqlite/0009/`). It never touches
`overture-files` or another bucket.

`maxAge` is in seconds: 35 days = 3,024,000. The abort rule covers multipart uploads abandoned by a crashed
snapshot (R2's default rule for that is 7 days, repeated here so one PUT owns the whole policy).

```json
[
  {
    "id": "expire-litestream-backups",
    "enabled": true,
    "conditions": { "prefix": "app.sqlite/" },
    "deleteObjectsTransition": { "condition": { "type": "Age", "maxAge": 3024000 } },
    "abortMultipartUploadsTransition": { "condition": { "type": "Age", "maxAge": 604800 } }
  }
]
```

`cf r2 buckets lifecycle update` **replaces** the whole rule set. Read it first and carry any other rule over.

```sh
# Read the current rules; today this is expected to be empty.
cf r2 buckets lifecycle get overture-backups

# Save the array above as r2-lifecycle.json, then validate and apply.
cf r2 buckets lifecycle update overture-backups --rules @r2-lifecycle.json --dry-run
cf r2 buckets lifecycle update overture-backups --rules @r2-lifecycle.json --force

# Read back: one rule, enabled, prefix app.sqlite/, maxAge 3024000.
cf r2 buckets lifecycle get overture-backups
```

Dashboard equivalent: **R2 → overture-backups → Settings → Object Lifecycle Rules → Add rule**, prefix
`app.sqlite/`, delete after 35 days, abort incomplete multipart uploads after 7 days.

The rule does not change what a restore can reach: every file a 30-day restore needs is younger than 30 days,
and Litestream deletes its own expired files before the rule's 35th day.

### 7.2 Size alert at 8 GB of the 10 GB included

R2 includes 10 GB of storage a month. Alert at 8 GB (80%), which leaves two gigabytes to investigate before
storage starts to bill ($0.015 per GB-month, so the cents are not the point; an unexpected jump is).

**Dashboard (primary).** Notifications → **Add** → **Billable Usage** → product **R2**, storage metric,
threshold **8 GB** (the wizard labels the unit), recipient the owner. Usage notifications are available on
pay-as-you-go accounts; this account is one.

**CLI (record the same policy).** Cloudflare does not document the `product` value or the unit of `limit` for
this alert type ([cloudflare-docs#35095](https://github.com/cloudflare/cloudflare-docs/issues/35095)), so read
the values this account accepts before creating it:

```sh
cf alerting available-alerts get --alert-type billing_usage_alert

# Then, with the R2 product value and the account's unit for the storage limit:
cf alerting policies create \
  --name 'Overture R2 storage 8 GB' \
  --description 'R2 storage for overture-backups crossed 8 GB of the 10 GB included (ADR 0033, #281).' \
  --alert-type billing_usage_alert --enabled true \
  --filters-product '<r2 product value from available-alerts>' \
  --filters-limit '<8, in the unit available-alerts reports>' \
  --mechanisms-email '[{"id":"<owner address>"}]'

cf alerting policies list
```

If `billing_usage_alert` does not list R2 for this account, use an **Alerts → Monitors** threshold monitor
over the R2 storage dataset instead (same 8 GB threshold, same recipient) and record its query here.

### 7.3 Reading the size, and what to do at 8 GB

```sh
cf r2 buckets metrics list            # account-level R2 metrics
```

The bucket's **Metrics** tab in the dashboard shows `payloadSize + metadataSize` and `objectCount` per bucket;
the GraphQL dataset is `r2StorageAdaptiveGroups` (`max { payloadSize metadataSize objectCount }`, filter
`bucketName: overture-backups`).

At 8 GB, in order:

1. Compare `objectCount` with the expected snapshot count. A jump with a flat object count is one large
   object (a runaway export or upload), not backup growth.
2. If the growth is old Litestream files, check that `retention.enabled: true` is still in the deployed
   `litestream.yml` and that the 35-day lifecycle rule above exists; then read the replica listing for files
   older than 30 days (`litestream ltx -level all`) and delete only those, not the current snapshot.
3. If it is `overture-files`, find the largest objects in the R2 dashboard and fix the writer; never delete a
   user's sealed files to stay under a storage line.
4. Never disable Litestream, revoke its token or shorten `snapshot.retention` to save storage: a missing
   backup is worse than a storage line, and the 30-day restore is the product's promise (SPEC §3.1).
