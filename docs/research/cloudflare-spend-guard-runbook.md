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

The owner accepted this trade in ADR 0033. The sentinel that warns at 70% before the trip is #283 and is not built
yet, so today the first signal is the 80% email from the limit itself.

## 6. What these guards do not cover

Only Workers and Durable Objects can be blocked. R2, Queues, Workers KV, D1, Workers AI, Vectorize, Browser Run,
Cloudflare Email Sending, Workflows, Containers and Images have no native limit; at most there is an email alert. For
Overture the plausible ones are R2 (Litestream's write rate, #281), Email Sending (3,000 a month, app-side counter
#282) and, if adopted, Workers AI neurons. R2 cannot be blocked natively: revoking its token would stop the backups,
so it stays bounded by design, lifecycle rules and a size alert. The budget alert at $0.50 is the only account-wide
signal until the sentinel (#283) and the app-side counters land.
