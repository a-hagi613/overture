# Ops, launch and docs sweep (#434), 2026-11-22

Audit of observability, shipping, documentation and CI on `origin/main` at `bf6c801`, with the fixes
in the PR that carries this file. Scope: structured logging and telemetry, health and readiness, alerts,
`Dockerfile`, `fly.toml`, Litestream entrypoints, the GitHub workflows and the ops documents
(`docs/SPEC.md`, `docs/DEPLOY.md`, `docs/SALVAGE.md`, ADR 0013, ADR 0022, ADR 0023). No schema
migration and no UI change.

## Fixed findings

| # | Severity | Where | Finding | Fix |
|---|---|---|---|---|
| 1 | High | `docs/SPEC.md` §16.2, §4, §16.5; ADR 0013 | The documents named ten unit tests run with Vitest, including `address.test.ts`, which does not exist; 34 `bun:test` files are on disk. §16.5 listed six OpenTelemetry metrics (`attempt_outcome_total`, `queue_depth`, `llm_cost_micros`, …) that no code emits, and claimed a trace for every request and job when manual spans exist only for the admin audit write and the test-only OTel route. | §16.2 is now a table of the 34 real files and their invariants; ADR 0013 names the restored-database check instead of the deleted `address.test.ts` and adds the allowlist invariant; §16.5 describes the telemetry that exists (OTLP trace/log/metric exporters, the attribute allowlist, the two manual spans) and says plainly that metric series are not emitted and the numbers are computed by `live.check`. |
| 2 | Medium | `.github/workflows/restore-drill.yml` | The weekly drill set up Bun with `bun-version: latest` while `package.json` pins 1.4.5 and every other workflow pins 1.4.5, so a Bun release between Monday runs could break `bun install --frozen-lockfile` in the one job that proves the backups restore. | Pinned `1.4.5`, like CI, deploy, Workable and the Dockerfile, and added `scripts/workflow-config-guard.test.ts`, which fails when any `oven-sh/setup-bun` step differs from `package.json`'s `engines.bun`. |
| 3 | Medium | `.oxlintrc.json`, `scripts/check-lint-config.ts` | The `overture/no-unlisted-unit-test` allowlist still listed `src/server/profile/address.test.ts`, a file deleted when that test was replaced, and nothing checked the allowlist against disk. | Removed the stale entry and added `scripts/lint-config-guard.ts` with a unit test: `bun run lint:config` now fails when the allowlist names a path that does not exist or leaves a unit test file in `src/` or `scripts/` unnamed. |
| 4 | Medium | `docs/SPEC.md` §14 (Profile, Settings, Admin rows), §14 intro, ADR 0022, §4 | §14 documented `DELETE /api/push/:id`, which does not exist (the route is `POST /api/push/unsubscribe {endpoint}`), and omitted `GET /api/push`, the four `/api/notifications` routes, `GET /api/profile/resume`, `GET /api/profile/resume/:id/file`, the admin suspend/reinstate/replay/margin/billing-users/live-check routes, and listed the admin `/applications`, `/reviews` and `/refunds` routes that are not mounted. §14 also promised a generated Hono RPC client; the web uses `fetch` plus Zod response schemas. | The route table now matches `src/server/routes/*.ts`; §14 and ADR 0022 say `fetch` + Zod schemas, not a Hono RPC client. `GET /api/health` has its own row so the ops contract (public, `select 1` plus the cached replica reading) is written down. |
| 5 | Medium | `docs/SPEC.md` §12 | The settings table omitted `limits.send_spacing_minutes`, `jobs.poll_interval_ms`, `jobs.batch_size`, `catalog.sweep_max_boards`, `backups.replica_read_interval_ms` and `live_checks.mail_wait_minutes`, all of which `SETTING_DEFAULTS` defines and the app reads. | Added the six rows with their defaults. |
| 6 | Low | `docs/DEPLOY.md`, ADR 0023 | DEPLOY.md and ADR 0023 called the CI secret-scan and restore job `restore-drill` / `secrets`; the job is `security-and-restore` (gitleaks, the private-files guard and the Litestream round trip, feeding `ci-ok`). | Named the real job in both documents and described what it runs. |
| 7 | Low | `docs/SALVAGE.md` | It said the v1 database is "exported once by `scripts/import-v1.ts`"; no such script exists (the export is `scripts/export-v1-facts.ts`, and the import is `import-v1-facts.ts`). | Named the real export script. |
| 8 | Low | `docs/SPEC.md` §3.2 | The external-services table listed `OPENCODE_API_KEY` for "OpenCode Go, LLM (local dev only)", which nothing in the repository reads. | Removed the row. |
| 9 | Low | `docs/SPEC.md` §5 | The cascade FK example said `REFERENCES user(id)`; the table is `users`. | Corrected to `REFERENCES users(id)`. |

## Verified, not changed

- **No PII or secret in a log line.** Every `logInfo`/`logError`/`logRetry` call site was read: scopes
  and messages carry job kinds, alert kinds, ULIDs, counts, durations and ATS/provider names, never an
  email, name, magic-link token, passkey credential, API key or message body. `logError` passes an error's
  `name: message` only. The OTel span and log exporters and `redactAttributes` drop every attribute
  outside `OTEL_ATTRIBUTE_ALLOWLIST`, covered by `test/e2e/telemetry-redaction.test.ts`.
- **Health and shutdown match the docs and Fly.** `/api/health` runs `select 1` on the main thread and
  serves the cached replica reading, so it never shells out to Litestream; `fly.toml` checks that path
  every 30 s with a 10 s timeout and 60 s grace. `KILL_TIMEOUT_MS` (20 s) fits inside Litestream's 30 s
  child budget, the SIGKILL backstop fires one second past the budget, and the logged lines match
  `docs/DEPLOY.md` (`overture shutdown: SIGINT: draining …`, `stopped in … ms`).
- **Deploy gate and env schema agree.** The required-secret list in `deploy.yml` covers every variable
  `src/server/config/env.ts` requires to boot (`BETTER_AUTH_SECRET`, `OWNER_EMAIL`, `TURNSTILE_SITE_KEY`,
  `TURNSTILE_SECRET`, `MASTER_KEY_V1`) plus the R2 names files and Litestream need; the Cloudflare mail
  names stay behind `REQUIRE_CLOUDFLARE_EMAIL_SECRETS`, as documented.
- **Container job and runtime.** The CI container run feeds `fly.toml`'s own `[env]` to `docker run`,
  disables Litestream and test routes, supplies a real 32-byte master key and polls `/api/health`; the
  runtime image runs as uid 10001 after the entrypoint fixes the volume's ownership, and no stage copies
  `.env` or a credential file.
- **Workflows.** Third-party actions stay SHA-pinned; `ci-ok` still aggregates every needed job; e2e and
  the container build still wait for the gate, and one failing e2e shard cancels the rest.

## Left for a follow-up (not a documentation fix)

The application emits no request, job or RED metric series and installs no OpenTelemetry
auto-instrumentation. That is a real gap, but adding instruments touches the dispatch, mail, catalog and
scheduler hot paths, so it belongs in its own ticket rather than this docs/CI sweep; SPEC §16.5 now states
the current behaviour instead of an unimplemented metric list.

## Rebased onto `origin/main` at `af59f781`

When this PR was rebased, `main` had moved on; two findings needed re-checking against the merged code:

- §16.2 and ADR 0013: `main` added six unit test files after `bf6c801` (`billing/webhooks`, `account/erase`,
  `dispatch/browser/session-slots`, `platform/jobs/queue`, `platform/llm/batch-store`, `platform/llm/anthropic-batches`),
  and the §14 admin row gained `/storage-report`. The table lists every file on disk, ADR 0013 names the same set,
  and the admin row matches the merged `src/server/routes/admin.ts`.
- §16.5 and §19: §19's risk table still pointed at a `discovery_poll_total` metric no code emits. It now names the
  `catalog.worker` and `workable.feed` alerts, and §16.5 names `ALERT_KINDS` in `platform/alerts.ts` as the complete
  alert set.

## Rebased again onto `origin/main` at `5d5a256b`

`main` moved on once more and added fourteen unit tests (`billing/summary`, `inbox/linked-mail`, `inbox/threads`,
`matching/applications`, `pipeline/approved-plan`, `pipeline/email-notes`, `pipeline/reviews`, `pipeline/send-queue`,
`platform/access/access`, `platform/alert-detail`, `platform/db/migration-snapshot`, `platform/http-body`,
`profile/personal-crypto`, `profile/time-zone`), and dropped `profile/address.test.ts`. §16.2, §4 and ADR 0013 now list
all 48 files on disk with their invariants, and the `.oxlintrc.json` allowlist is the union of both rebases.

## Rebased again onto `origin/main` at `bc75bad9`

`main` merged the Sweep 4 API error contract (#470) while this PR waited for CI. §14 now keeps `main`'s newer
one-error-envelope paragraph and its separate `Notifications` row instead of folding notifications into
`Settings`, adds the resume `GET`/`:id/file` routes and the `GET /api/push` detail, and the unit-test count is
unchanged at 48.

## Verification

```
bun run lint:config   # 714 rules at error, 63 off, 48 unit test files listed and present
bun test scripts/lint-config-guard.test.ts scripts/workflow-config-guard.test.ts
bun fmt --check
bun run verify        # 7/7
```
