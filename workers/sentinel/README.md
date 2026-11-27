# Sentinel Worker

An independent watcher for Overture's Cloudflare usage and for the app's own health (#283, ADR 0033).
Its Workable-snapshot check was removed with the retired feed (#706).
It runs on a cron trigger, so it does not depend on Fly or on GitHub Actions being up.

Every ten minutes it does three things:

1. **Health probe.** `GET ${OVERTURE_HEALTH_URL}` from outside Fly. A 2xx whose body has
   `"status":"ok"` is healthy; a 5xx, a Cloudflare error page, a timeout, a non-JSON body or any
   other status is a failure and pushes to `ALERT_NTFY_URL` once, then at most every six hours while
   it stays down. Recovery pushes once.
2. **Usage watchdog.** Reads month-to-date usage from the Cloudflare GraphQL Analytics API —   R2 Class A and Class B operations, Queues billable operations, Workers requests and Workers CPU —
   and compares each with its monthly allowance:

   | Metric | Allowance |
   |---|---|
   | `r2.class_a_operations` | 1,000,000 |
   | `r2.class_b_operations` | 10,000,000 |
   | `queues.billable_operations` | 1,000,000 |
   | `workers.requests` | 10,000,000 |
   | `workers.cpu` | 30,000,000 CPU-ms |

   At **70 %** it pushes one ntfy warning per metric. At **90 %** it writes the degraded flag at
   `ops/degraded.json` in the files bucket and pushes one summary listing every metric over the line.
   Below 90 % it deletes the flag and pushes a recovery note. The app reads that flag
   (`src/server/platform/degraded.ts`): `email_classify` runs rules-only and the live-check R2 round
   trip is skipped, and it logs each change of state.
3. **Signed ops health (#634).** When `OVERTURE_OPS_HEALTH_SECRET` is set, the sentinel also polls
   `GET /internal/ops/health` on the app with an HMAC-SHA256 signature over
   `METHOD\npath\ntimestamp`. It pages when RAM is above 80 %, NVMe `/data` above 75 %, event-loop
   lag p95 above 500 ms, or the last hour's ATS apply failure rate is above 30 % of at least five
   attempts. Without the secret the check is skipped and the two checks above behave exactly as
   before, so a test environment without the secret keeps working. The thresholds alert body points
   at `docs/runbooks/ops-resource-ceilings.md`.

The sentinel **never revokes the R2 token**. Revoking it would stop Litestream and lose the backups;
ADR 0033 rejects that guard explicitly. R2 is bounded by design, lifecycle rules and these alerts.

Alert state lives in R2 at `ops/sentinel-state.json` (last health result, degraded start, last
alert per kind), so a ten-minute cron does not flood the phone. The state
object is a Class A write on each run: about 4,300 a month. The degraded flag is **not** rewritten
while it is unchanged, because during a degraded period a Class A write every ten minutes would add
load exactly where the watchdog is asking the app to shed it.

A push that ntfy rejects (non-2xx, timeout, missing secret) is recorded in the run and left unmarked,
so the next run retries it: a quiet phone never looks like a healthy system. If the state object
itself cannot be read, the sentinel treats the run as a first one and alerts again rather than
staying silent, and it records why.

## Seeing what the sentinel saw

The Worker writes no console output — `src` here logs through `process.stderr`, which a Worker does
not have, and the lint rule set bans `console`. Every run instead records itself in the state object
it already writes:

```json
{
  "lastRun": {
    "at": "2026-11-21T15:00:00.000Z",
    "health": "ok",
    "usage": "ok",
    "degraded": false,
    "flag": "absent",
    "alerts": [],
    "errors": []
  }
}
```

```sh
bunx wrangler r2 object get overture-files/ops/sentinel-state.json --pipe
```

That one object answers "did the cron run, and what did it find?", and the `at` field changes every
run, so a stopped cron is visible. `errors` carries what could not be done (a push ntfy refused, a
flag write that failed, state that could not be parsed). Cloudflare's dashboard shows the crons'
invocation and error counts; a state write that fails throws, so the invocation shows as an error.

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
| `OVERTURE_OPS_HEALTH_URL` | variable | `https://tryoverture.com/internal/ops/health` (in `wrangler.jsonc`) |
| `OVERTURE_OPS_HEALTH_SECRET` | secret | the app's `OPS_HEALTH_SECRET`; unset skips the ops check |

Without the two Cloudflare values the usage check reports `usage=unconfigured` and pushes one
warning a day instead of failing silently. It never contacts an ATS or any other paid service.

`limits.cpu_ms` is 500: a runaway loop stops long before it can spend CPU, while a real run (one
health call, one GraphQL answer, a few R2 reads) is far below it. At 4,320 runs a month, even every
run maxing the limit would stay under the 30 M CPU-ms allowance. `workers_dev` is false: the Worker
answers cron triggers only, with no public hostname.

## Commands

```sh
cd workers/sentinel
bunx wrangler secret put ALERT_NTFY_URL
bunx wrangler secret put CLOUDFLARE_ACCOUNT_TAG
bunx wrangler secret put CLOUDFLARE_ANALYTICS_TOKEN
bunx wrangler deploy
```

`bunx wrangler deploy --dry-run` (and `bun run dry-run` here) builds the Worker without deploying;
CI runs that on every build.

## Tests

`test/e2e/sentinel-worker.test.ts` runs the real `runSentinel` handler against local Bun servers
that replay the recorded fixtures in `test/e2e/fixtures/sentinel/`, a real directory standing in for
the R2 binding, and a capture server for ntfy. It needs no Cloudflare credentials and no network.
It covers the healthy run and what it records, a failing probe and a wrong health body, the 70 % and 90 % thresholds, the flag write, its no-op when
unchanged and its clear, an unreadable GraphQL answer and a GraphQL error answer, the unconfigured
path, a failing ntfy that is retried, unreadable state, and the cron/CPU budget.

Browser e2e is not needed and does not run: the spec passes `--project=chromium` because the suite
is one project, but it opens no page.
