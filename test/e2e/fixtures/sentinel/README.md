# Sentinel Worker fixtures

Recorded on 2026-11-21 from the real services; no synthetic payloads (ADR 0013).

| File | Recorded from | Command |
|---|---|---|
| `health-ok.json` | `https://tryoverture.com/api/health` | `curl -sS https://tryoverture.com/api/health` |
| `usage-graphql.json` | `POST https://api.cloudflare.com/client/v4/graphql` for the Overture account | the sentinel's own `USAGE_QUERY`, `since` at the start of the billing month, token with **Account Analytics: Read** |

`health-ok.json` is stored exactly as the app answered it.

`usage-graphql.json` is the whole GraphQL answer for `USAGE_QUERY`: `data.viewer.accounts[0]` with
`r2OperationsAdaptiveGroups`, `queueMessageOperationsAdaptiveGroups` and
`workersInvocationsAdaptive`, plus the `errors` field. It is recorded by the owner or the
orchestrator on production and dropped in unchanged; the dev machine never calls Cloudflare's API
(ADR 0016). This one was recorded live at `2026-11-21T17:48:56Z` with `since` =
`2026-11-01T00:00:00.000Z`: 16 R2 groups, no Queue groups and no Workers invocations on the account,
covering all eleven R2 `actionType`s the sentinel classifies.

The recording is what caught two schema mistakes before they shipped: the Queue dimension is
`queueId` (not `queueID`, which the API rejects as an unknown field) and all three datasets filter
`datetime_geq` with a `Time`, not a `String`.

The threshold tests in `test/e2e/sentinel-worker.test.ts` keep the recording and replace **one**
summed value (`usageWith`), because an account cannot be made to cross an allowance on demand; every
other field, dimension and datum stays as the API returned it.

The test servers replay these and serve the same payloads with failure statuses where the test
needs a failure; no other response body is invented. The `.invalid` ntfy and GraphQL hosts in the
tests are local Bun servers, not recordings: they only capture what the Worker sent.
