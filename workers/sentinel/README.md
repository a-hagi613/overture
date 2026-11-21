# Sentinel Worker

An independent watcher for Overture's Cloudflare usage and for the app's own health (#283, ADR 0033).
It runs on a cron trigger, so it does not depend on Fly or on GitHub Actions being up.

Every ten minutes it does three things:

1. **Health probe.** `GET ${OVERTURE_HEALTH_URL}` from outside Fly. A 2xx whose body has
   `"status":"ok"` is healthy; a 5xx, a Cloudflare error page, a timeout or any other body is a
   failure and pushes to `ALERT_NTFY_URL` once, then at most every six hours while it stays down.
   Recovery pushes once.
2. **Workable freshness.** Reads `workable/manifest.json` from R2 (written by the Workable Action,
   ADR 0032) and alerts when its `fetchedAt` is older than 26 hours, when the object is missing, or
   when it cannot be parsed. Row-count drops stay with the app's ingest, which already alerts.
3. **Usage watchdog.** Reads month-to-date usage from the Cloudflare GraphQL Analytics API —
   R2 Class A and Class B operations, Queues billable operations, Workers requests and Workers CPU —
   and compares each with its monthly allowance:

   | Metric | Allowance |
   |---|---|
   | `r2.class_a_operations` | 1,000,000 |
   | `r2.class_b_operations` | 10,000,000 |
   | `queues.billable_operations` | 1,000,000 |
   | `workers.requests` | 10,000,000 |
   | `workers.cpu` | 30,000,000 CPU-ms |

   At **70 %** it pushes an ntfy warning. At **90 %** it pushes again and writes the degraded flag
   at `ops/degraded.json` in the files bucket; below 90 % it deletes the flag and pushes a recovery
   note. The app reads that flag (`src/server/platform/degraded.ts`): `email_classify` runs
   rules-only and the live-check R2 round trip is skipped, and it logs each change of state.

The sentinel **never revokes the R2 token**. Revoking it would stop Litestream and lose the backups;
ADR 0033 rejects that guard explicitly. R2 is bounded by design, lifecycle rules and these alerts.

Alert state lives in R2 at `ops/sentinel-state.json` (last health result, last manifest result,
degraded start, last alert per kind), so a ten-minute cron does not flood the phone. The state
object is a Class A write on each run: about 4,300 a month.

The Alpha billable-usage API (`GET /accounts/{account_id}/billable-usage`) is **not called**. Its
response shape has to be recorded from the real account before anything relies on it
(docs/research/cloudflare-paid-plan.md, "Not verified"), and the GraphQL dataset is the primary
source the dashboard itself uses. It stays a follow-up cross-check, not a dependency.

## Configuration

| Name | Kind | Value |
|---|---|---|
| `FILES` | R2 binding | `overture-files`, the bucket the app reads |
| `OVERTURE_HEALTH_URL` | variable | `https://tryoverture.com/api/health` (in `wrangler.jsonc`) |
| `ALERT_NTFY_URL` | secret | the owner's ntfy topic |
| `CLOUDFLARE_ACCOUNT_TAG` | secret | the account's 32-character tag |
| `CLOUDFLARE_ANALYTICS_TOKEN` | secret | a token with **Account Analytics: Read** |
| `CLOUDFLARE_GRAPHQL_URL` | optional variable | defaults to `https://api.cloudflare.com/client/v4/graphql` |

Without the two Cloudflare values the usage check reports `usage=unconfigured` and pushes one
warning a day instead of failing silently. It never contacts an ATS or any other paid service.

## Commands

```sh
cd workers/sentinel
bunx wrangler secret put ALERT_NTFY_URL
bunx wrangler secret put CLOUDFLARE_ACCOUNT_TAG
bunx wrangler secret put CLOUDFLARE_ANALYTICS_TOKEN
bunx wrangler deploy
```

`bunx wrangler deploy --dry-run` builds the Worker without deploying; CI runs that on every build.

## Tests

`test/e2e/sentinel-worker.test.ts` runs the real `runSentinel` handler against local Bun servers
that replay the recorded fixtures in `test/e2e/fixtures/sentinel/`, a real directory standing in for
the R2 binding, and a capture server for ntfy. It needs no Cloudflare credentials and no network.
It covers the healthy run, a failing probe, a missing and a stale manifest, the 70 % and 90 %
thresholds, the flag write and clear, an unreadable GraphQL answer, and the cron/CPU budget.
