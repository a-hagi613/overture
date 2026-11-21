# Sentinel Worker fixtures

Recorded on 2026-11-21 from the real services; no synthetic payloads (ADR 0013).

| File | Recorded from | Command |
|---|---|---|
| `health-ok.json` | `https://tryoverture.com/api/health` | `curl -sS https://tryoverture.com/api/health` |

`usage-graphql.json` comes from the Cloudflare GraphQL Analytics API for the Overture account
(`POST https://api.cloudflare.com/client/v4/graphql`, the sentinel's own query, `since` at the
start of the billing month). It is recorded by the owner or the orchestrator on production and
dropped in unchanged; the dev machine never calls Cloudflare's API (ADR 0016).

The test servers replay these and serve the same payloads with failure statuses where the test
needs a failure; no other response body is invented.
