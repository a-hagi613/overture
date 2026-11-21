# DEPLOY.md

One-time human steps to go from this repository to a live, backed-up `overture-web`, and how to verify
each acceptance criterion of [issue #10](https://github.com/a-hagi613/overture/issues/10).

Everything in this document is done by a human; nothing here creates cloud resources automatically.
No secret value ever appears in this repository: secrets are set with `fly secrets set NAME=VALUE` and
`gh secret set NAME` from the operator's own terminal, against names only.

## What the repo already provides

| File | Role |
|---|---|
| `Dockerfile` | Multi-stage build on Bun 1.4: installs, builds the SPA (`dist/`), ships a slim runtime with Litestream 0.5.18 (checksum-verified) |
| `scripts/docker-entrypoint.sh` | On start: Litestream restores `/data/app.sqlite` from the replica if it does not exist, then runs `litestream replicate -exec "bun run /app/src/server/main.ts"`; migrations run inside `main.ts` |
| `litestream.yml` | Continuous replication (1 s sync) to R2 `overture-backups`, nightly snapshot (`interval: 24h`) kept 30 days (`retention: 720h`) |
| `fly.toml` | App `overture-web`, region `yyz`, `kill_timeout = 300`, `shared-cpu-2x` / 2 GB, volume `data` (10 GB) on `/data`, health check on `/api/health` |
| `.github/workflows/ci.yml` | Adds a `container` job (builds the image, starts it, checks `/api/health`) and a `restore-drill` job (Litestream round-trip against a local file replica: replicate → restore → `integrity_check`, row counts, migrations) |
| `.github/workflows/deploy.yml` | Skips with a green notice while `FLY_API_TOKEN` is unset; after CI succeeds on `main`: `flyctl deploy --remote-only` with `FLY_API_TOKEN`, then polls the production health route |
| `.github/workflows/restore-drill.yml` | Weekly (Mondays 06:17 UTC, also `workflow_dispatch`): skips with a green notice while `FLY_API_TOKEN` is unset; otherwise restores from R2 into a throwaway Fly machine, checks it, destroys the machine |
| `scripts/check-restored-db.ts` | Restored-database checks: PRAGMA `integrity_check`, applied-migration count, per-table row counts, optional health-route probe |
| `scripts/restore-drill.ts` | `DRILL_TARGET=local` (CI round-trip) or `DRILL_TARGET=fly` (throwaway machine drill) |

## One-time human steps

Run from an authenticated `flyctl` (the org examples below use Fly.io's defaults; adjust the org name).

1. Create the app (this registers the app so deploys have a target):
   `fly apps create overture-web --org <your-org>`
2. Lock the app to exactly one machine (spec: `fly scale count` stays 1):
   `fly scale count 1 -a overture-web`
3. Create the volume in `yyz`:
   `fly volumes create data -a overture-web -r yyz -s 10`
4. In Cloudflare, create an R2 bucket for backups named `overture-backups`, plus an R2 API token with
   Object Read & Write scoped to that bucket. Note the account ID, access key ID and secret access key.
   The encrypted files bucket is a second R2 bucket named `overture-files`; `R2_BUCKET_FILES` is required
   alongside the other R2 names. The bucket exists and the secret is set on `overture-web`.
5. Set only the backup and app secrets on the app (values come from the previous step, never the repo):
   `fly secrets set R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET_BACKUPS=overture-backups R2_BUCKET_FILES=overture-files -a overture-web`
   With `R2_BUCKET_FILES` set the app stores encrypted resumes and mail in R2, and a half-set R2 files config (the
   bucket without the three credentials, or the credentials partly set) stops the server at boot.
   Sign-in (M1-06) adds `BETTER_AUTH_SECRET` (at least 16 random characters), `OWNER_EMAIL`,
   `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` (a Turnstile widget for `tryoverture.com`), and optionally `TURNSTILE_HOSTNAMES` (defaults to the `APP_ORIGIN` hostname; never localhost or 127.0.0.1 in production).
   The OAuth clients are optional until they exist, one pair at a time: `GOOGLE_CLIENT_ID` with
   `GOOGLE_CLIENT_SECRET`, and `LINKEDIN_CLIENT_ID` with `LINKEDIN_CLIENT_SECRET` (redirect URIs
   `https://tryoverture.com/api/auth/oauth2/callback/google` and `…/oauth2/callback/linkedin`).
   A provider whose pair is not both set is not registered and its button does not render; the
   emailed sign-in link works on its own. Setting only one name of a pair stops the server at boot.
   Resume and Facts (M1-13) add `MASTER_KEY_V1`, generated with `openssl rand -base64 32`
   (base64 that decodes to exactly 32 bytes), never rotated without the re-wrap step that
   re-wraps every user's data key under the new master key.
   Outbound mail (M1-90) adds `CLOUDFLARE_EMAIL_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; the pair is set together or
   not at all, and the Cloudflare section below covers them. `CLOUDFLARE_ZONE_ID` joins them for the M2-02 sending-domain
   script and guards. With neither the in-memory sink is used, as in development
   and tests.
   The server refuses to boot without the required ones, so the **Deploy** workflow checks each required
   name with `fly secrets list` first and fails before deploying when one is missing; production keeps its
   current release. The OAuth names are not in that check, and the Cloudflare mail names join it only once
   `REQUIRE_CLOUDFLARE_EMAIL_SECRETS` is set (M1-90 section below). Later milestones add their own secrets the same way and to that list; nothing
   else exists in `fly.toml`.
6. Create a deploy token (Full permissions on the app) and store it as a repository secret:
   `gh secret set FLY_API_TOKEN -b <token-in-your-terminal> -R a-hagi613/overture`
7. Point DNS at the app in Cloudflare: `tryoverture.com` (proxied) → `overture-web.fly.dev`, then
   `fly certs add tryoverture.com -a overture-web`. `tryoverture.com` is already registered.

Merge to `main` and watch the first run of the **Deploy** workflow.

Until step 6 is done, the **Deploy** and **Restore drill** workflows do not go red: their first step
maps the `FLY_API_TOKEN` repository secret to an environment variable and skips the remaining steps
successfully, with a `::notice::` annotation and a job summary pointing at this document. The weekly
drill and every merge-to-`main` deploy therefore stay green while the one-time steps are pending.

## M1-90: outbound mail through Cloudflare Email Sending (owner runbook)

Overture's own mail (magic links first, later verification, digests, receipts and "ready to send" notices) leaves from
`no-reply@tryoverture.com` through Cloudflare Email Sending ([issue #90](https://github.com/a-hagi613/overture/issues/90),
SPEC §11, ADR 0028, `docs/research/cloudflare-email-sending.md`). The app selects the Cloudflare adapter only when
`CLOUDFLARE_EMAIL_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are both set. With neither it keeps the in-memory sink used in
development and tests. A half-set pair stops the server at boot with a message naming the missing variable.

Email Sending is in Beta and Cloudflare's terms call Beta Services "intended for testing purposes only"; the owner
accepted that risk for sign-in mail on 2026-11-21 (ADR 0028). Sending to arbitrary recipients needs the **Workers Paid**
plan: 3,000 emails a month included, then $0.35 per 1,000.

### Onboarding the sending domain

In the Cloudflare dashboard, **Compute → Email Service → Email Sending → Onboard Domain**, choose `tryoverture.com`
and review the records Cloudflare will add. `tryoverture.com` is already on Cloudflare DNS, which the service requires.
Onboarding adds these records on the `cf-bounce` subdomain:

| Type | Name | Value |
|---|---|---|
| MX | `cf-bounce.tryoverture.com` | `route1.mx.cloudflare.net`, `route2…`, `route3…` (priorities assigned by Cloudflare) |
| TXT | `cf-bounce.tryoverture.com` | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| TXT | `cf-bounce._domainkey.tryoverture.com` | `v=DKIM1; h=sha256; k=rsa; p=…` (Cloudflare generates and manages the key) |
| TXT | `_dmarc.tryoverture.com` | Cloudflare adds `v=DMARC1; p=reject;` only when no DMARC record exists; an existing record is kept |

The apex MX, the apex SPF include and the `cf2024-1._domainkey` DKIM record belong to Email Routing and the inbound
Worker; Email Sending does not touch them. DNS usually propagates in 5–15 minutes for Cloudflare-hosted domains, up to
24 hours globally. The `cf-bounce` records stay managed by Email Sending for the life of the domain configuration.

### API token and Fly secrets

Create a Cloudflare API token with the **Email Sending: Edit** permission (API name `Email Sending Write`), preferably
scoped to this account, and note the account id from the dashboard. Put both on the app:

```sh
fly secrets set CLOUDFLARE_EMAIL_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… -a overture-web
```

The server sends with a bearer token by `fetch`; no SDK and no configuration set are involved.

### The deploy gate

The **Deploy** workflow lists the Cloudflare names in its required-secret gate, behind the repository variable
`REQUIRE_CLOUDFLARE_EMAIL_SECRETS`, so the gate stays green until production relies on Cloudflare. Once the secrets
above exist, flip it:

```sh
gh variable set REQUIRE_CLOUDFLARE_EMAIL_SECRETS -b true -R a-hagi613/overture
```

### Verifying

Request a sign-in link at `https://tryoverture.com/signin`, confirm it arrives from `no-reply@tryoverture.com`, and
open it to sign in. Development and the e2e suite never call Cloudflare: ADR 0013 intercepts the send endpoint inside
the app process with MSW and asserts the request body.

## M2-02: Cloudflare Email Sending for every recipient (owner runbook)

Sending to anyone but the owner needs **Workers Paid** and `tryoverture.com` onboarded as a sending domain
([issue #211](https://github.com/a-hagi613/overture/issues/211), SPEC §11.2, ADR 0028,
`docs/research/cloudflare-email-sending.md`). This section is what the owner runs once the plan is paid. Nothing here
is needed for the owner-only phase, and the guards stay gated until `REQUIRE_EMAIL_SENDING` is turned on.

### 1. Set the Fly secrets

The script and the live check read the same secrets as the sender, plus the zone id:

```sh
fly secrets set CLOUDFLARE_EMAIL_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_ZONE_ID=… -a overture-web
```

`CLOUDFLARE_ZONE_ID` is on the `tryoverture.com` overview page in the Cloudflare dashboard (right-hand column). The
API token needs **Email Sending: Edit** (API name `Email Sending Write`); if `CLOUDFLARE_ZONE_ID` is not set, the
script tries `GET /zones?name=tryoverture.com`, which also needs **Zone: Read**. Setting the zone id avoids that
second permission. The token is never printed, committed or copied anywhere.

### 2. Run the onboarding script on `overture-web`

```sh
fly ssh console -a overture-web -C "bun run /app/scripts/onboard-email-sending.ts --dry-run"
fly ssh console -a overture-web -C "bun run /app/scripts/onboard-email-sending.ts"
```

The script is idempotent: it lists the sending subdomains first and only creates (or re-enables) the one that is
missing, so a second run prints `action: none` and changes nothing. `--dry-run` prints what it would do and sends no
request that writes. It reads the expected records back from Cloudflare and verifies the four the sending domain
needs:

| Record | Name | Check |
|---|---|---|
| bounce MX | `cf-bounce.tryoverture.com` | at least one, pointing at `*.mx.cloudflare.net` |
| SPF | `cf-bounce.tryoverture.com` | `v=spf1 include:_spf.mx.cloudflare.net` |
| DKIM | `cf-bounce._domainkey.tryoverture.com` | `v=DKIM1` with a public key |
| DMARC | `_dmarc.tryoverture.com` | `v=DMARC1; p=reject` |

It never writes a zone DNS record: only the sending subdomain is created, so the apex MX, the apex SPF include and the
`cf2024-1._domainkey` record that Email Routing and the inbound Worker depend on are untouched. Cloudflare manages the
records it adds, including a DMARC record only when the domain has none; Overture's existing `p=reject; rua=…` record
is kept.

`--check` is the read-only form used by the deploy guard and by the daily live check:

```sh
fly ssh console -a overture-web -C "bun run /app/scripts/onboard-email-sending.ts --check"
```

It prints the plan state (`Workers Paid` when Cloudflare's Email Sending API answers), the domain state and each
record, then exits 0 only when every record verifies.

### 3. Turn the guards on

The guards are gated so they never block anything before the owner pays. Turn both switches on after the script
prints `verdict: verified`:

```sh
fly secrets set REQUIRE_EMAIL_SENDING=true -a overture-web
gh variable set REQUIRE_EMAIL_SENDING -b true -R a-hagi613/overture
```

- The **deploy guard** in `.github/workflows/deploy.yml` runs `onboard-email-sending.ts --check` on the running
  release before every deploy. While the switch is off it prints a warning and the deploy continues; with the switch
  on it refuses the deploy with a clear message when the sending domain is missing, disabled or its records do not
  verify.
- The **live-check guard** is the `mail.sending` result in the daily `mail` check group. While the switch is off it
  records `status: "gated"` and does not alert. With the switch on it verifies the domain and all four records and
  fails (with the owner's alert path) when they do not pass. The same group then sends the check message to the
  reserved `live-check@tryoverture.com`, which is not the owner's address, and expects it back through Email Routing.

Run the daily check once from the owner's terminal (`POST https://admin.tryoverture.com/admin/api/live-checks`) and
confirm `mail.sending` and `mail` pass. If the records were just created, Cloudflare usually propagates in 5–15
minutes; re-run `--check` until it prints `verdict: ready`.

## Verifying the acceptance criteria

- **A merge to `main` deploys `overture-web` and the health route answers in production**
  The Deploy workflow (`.github/workflows/deploy.yml`) runs only after the CI workflow succeeds on
  `main`, deploys with `flyctl deploy --remote-only`, and fails if `https://overture-web.fly.dev/api/health`
  does not answer. Verify: green Deploy run, and in a terminal
  `curl -fsS https://overture-web.fly.dev/api/health` → `{"status":"ok","database":"ok",...}`.
- **Litestream lag is visible and a restore drill has passed once**
  Lag: `curl -fsS https://overture-web.fly.dev/api/health | jq .backups` →
  `{"replication":"ok","lagSeconds":<n>,"replicaTxid":"…","readAgeSeconds":<n>}`. `lagSeconds` measures how
  far the replica (`replicaTxid`) is behind the local database. The server reads the replica's newest
  transaction id and the local database's transactions (`litestream ltx -level all`) in the background every
  `backups.replica_read_interval_ms` (default `30000`, changed in Settings). `/api/health` only serves that
  cached reading and never runs litestream, so it answers in milliseconds even when the R2 listing is slow.
  `readAgeSeconds` is how old that reading is. `lagSeconds` is `0` when the replica holds every local
  transaction, so an idle, fully replicated database reads `0` forever instead of growing without bound.
  When the local database has transactions the replica does not hold yet, `lagSeconds` is the age in
  seconds of the oldest such write; above ~300 s means R2 replication is falling behind. A write shows up
  within one read interval. If the last reading is older than three intervals (the reader has stopped),
  `replication` is `"unknown"`, not `"ok"`, and `readAgeSeconds` says how old it is. `"unavailable"` means the
  last reading could not list the replica or the local transactions. Right after a cold start with no replica
  yet, the first reading can be `"unknown"` or `"unavailable"` for up to one read interval. Drill: run the **Restore drill** workflow once
  (`gh workflow run "Restore drill" -R a-hagi613/overture`); it is scheduled weekly thereafter. A run
  proves a restore into a throwaway machine passed `integrity_check`, has applied migrations and
  answers `/api/health`, and the machine was destroyed.
- **Secrets come only from Fly secrets; none are printed or committed**
  `.env` is git-ignored; the Zod config (`src/server/config/env.ts`) takes values from process env,
  which on Fly is exactly Fly secrets. R2 and deploy credentials exist only as Fly/GitHub secrets.
  Verify: `fly secrets list -a overture-web` (names only), and `gh secret list -R a-hagi613/overture`.
- **`fly scale count` is 1**
  Verify: `fly scale show -a overture-web` → 1 machine; `fly platform vm-sizes` configurations live in
  `fly.toml` (`shared-cpu-2x`, 2 GB) and the volume (`data`, 10 GB) is attached to that machine only.

## Moving encrypted files to R2 (one-off)

After `R2_BUCKET_FILES` is set and the app is on the R2 adapter, the files already written to the volume
under `/data/objects` are still only there. Copy them from a shell on `overture-web` and verify each
sha256 (`--dry-run` first, if you like):

`fly ssh console -a overture-web -C "bun run /app/scripts/move-objects-to-r2.ts --dry-run"` then
`fly ssh console -a overture-web -C "bun run /app/scripts/move-objects-to-r2.ts"`.

The script is idempotent (objects already in R2 with the same sha256 are skipped), never writes to a
different key, and never deletes the local files. When it prints `verified`, it also prints the exact
`rm -rf` command for the local copy; run it only after checking R2.

## M1-19: importing the owner's v1 Facts (owner run)

The v1 export holds the owner's answers, so it is encrypted at rest and never enters the repository, a pull
request, a log or a test fixture. The two scripts print counts and keys only, never values.

1. Export on the v1 machine, with the v1 database mounted read-only. The script opens the file with
   `readonly: true`, refuses a database without the answer-bank and learned-answer tables, and writes one
   JSON file with mode 600:
   `bun run scripts/export-v1-facts.ts --db <v1 database> --out <export.json>`
2. Move the export off the v1 machine, encrypt it, and keep it with the other private files.
3. Import into `overture-web` for the owner's account:
   `bun run scripts/import-v1-facts.ts --db <v2 database> --user <owner email> --in <export.json>`
   The report lists every fact it imported or updated (with its key and v1 source key) and every skipped row
   with one of `no_catalog_key`, `unknown_question`, `invalid_value` or `kept_user_fact`. Re-running is
   idempotent: it updates the same rows and never overwrites a Fact whose source is `user` or `review`.
4. Delete the decrypted export from both machines.

## Operator scripts against the live database

Operator scripts run against the same `/data/app.sqlite` the server is using, so every one that writes does it in
small batches: at most 500 rows per transaction, with the event loop yielded between batches. A long single
transaction would hold the write lock past the app's `busy_timeout` (5 s); the server would then log `SQLITE_BUSY`,
retry the claim or poll, and keep serving reads, but the batch would still have stalled writes for seconds.

- `scripts/retag-feed-workplace.ts` clears Lever and Ashby board and posting content hashes in batches of 500 and
  never touches closed or Greenhouse rows. Re-running it is safe: the second run reports `postingsReset: 0`.
- `scripts/import-v1-facts.ts` applies encrypted facts in batches of 500 and is idempotent (it updates the same rows
  and never overwrites a Fact whose source is `user` or `review`).
- `scripts/load-discovered-boards.ts` inserts discovered boards in transactions of at most 500 boards and is
  idempotent.
- `scripts/census.ts` only reads the database and writes its Markdown report to disk.

Do not open a long manual transaction on the volume while the server runs. The server's background job loop, SSE
poller and request handlers retry `SQLITE_BUSY` and log it instead of exiting; an unhandled rejection from a
background loop or timer is logged and alerted (`process.unhandled`), not fatal.

## Restore drill safety

The throwaway machine runs the same image with `LITESTREAM_RESTORE_ONLY=true`: it restores from R2 and
serves the app from an empty ephemeral filesystem. It never mounts the production volume and never
runs a Litestream replicator, so the drill cannot overwrite or contend with the live backup.

## Runtime security

- **The container runs unprivileged.** The runtime image creates a dedicated system user `app`
  (uid/gid `10001`, nologin shell). The entrypoint itself starts as root for exactly one purpose —
  Fly mounts volumes as root, so it fixes the ownership of the data directory — and then re-execs
  itself as `app` via `gosu` without ever returning to root. The only long-running processes are
  therefore `litestream replicate` and the Bun server, both as uid `10001`. Verified locally with
  `docker top` after an image run.
- **No secret is baked into the image or printed in logs.** Neither Dockerfile stage copies anything
  beyond built artifacts (`dist/`, `src/`, `drizzle/`, `scripts/`, `litestream.yml`) — there is no
  `.env` or credential file in the runtime layers. R2 credentials reach Litestream only at start as
  environment variables set by `fly secrets set` (deploy step 5 above): `litestream.yml` references
  them as `${R2_ACCOUNT_ID}`, `${R2_ACCESS_KEY_ID}` and `${R2_SECRET_ACCESS_KEY}`, and the
  entrypoint passes the config they live in to `litestream replicate`. The workflows never echo
  `FLY_API_TOKEN`; the guard step maps the secret to an environment variable and only tests emptiness.
- **Third-party Actions are SHA-pinned.** `superfly/flyctl-actions/setup-flyctl`,
  `oven-sh/setup-bun`, `docker/setup-buildx-action` and `docker/build-push-action` are pinned to full
  commit SHAs (with the ref noted in the step name); only first-party `actions/*` actions keep their
  version tags, and the e2e container image is pinned to its digest.

## M1-32: the early cloud probe (owner runbook)

[Issue #39](https://github.com/a-hagi613/overture/issues/39) adds a one-off, owner-run probe
(`scripts/probe.ts`) that validates the Browser Use pipeline against five real Greenhouse forms. It
runs only on `overture-web` through `fly ssh console` and refuses to run anywhere else; every
Browser Use session is always stopped through the API in a `finally` path, even on failure or
timeout. Metrics land in the `probe_forms` table so later milestones never re-apply to these
postings, and the run prints a summary comparing proxy MB per form and the projected cost per
completed application against the $0.03 gate.

1. Upload the resume to the volume (the run file references it by path, default `/data/probe/resume.pdf`):
   `fly sftp shell -a overture-web`, then `put <local resume.pdf> /data/probe/resume.pdf`.
2. Write the run file to `/data/probe/run.json`. It lives privately at
   `~/overture-private/probe-run.json` (never in the repo), so upload it with
   `fly sftp shell -a overture-web`, then `put ~/overture-private/probe-run.json /data/probe/run.json`:
   the five Greenhouse Posting URLs the owner picked, the owner-approved answer per question
   (every `approved` must be `true` for `--confirm` to do anything), the two-letter country of
   the residential exit, and the resume path from step 1.
3. Dry run — fills and uploads but never submits, prompts nothing (`fly ssh console -a overture-web`):
   `bun run /app/scripts/probe.ts --run-file /data/probe/run.json`
4. Real run — same command plus `--confirm`; when the console says Greenhouse emailed a
   verification code, open the inbox, read the code and type it into the console prompt:
   `bun run /app/scripts/probe.ts --run-file /data/probe/run.json --confirm`
5. Delete the resume and the run file from the volume afterwards so no PII sits on the machine:
   `fly sftp shell -a overture-web`, then `rm /data/probe/resume.pdf /data/probe/run.json`.

`BROWSER_USE_API_KEY` is a Fly secret on `overture-web`; its value is never stored in or printed by
this repository. The probe needs no other configuration.


## Daily live checks

`live.check` runs daily on `overture-web`; its first run is about five minutes after the first production boot, and
after that at the next UTC midnight. Run it on demand from the owner's terminal with the admin API, using the
Cloudflare Access cookie and the owner's session:
`curl -X POST https://admin.tryoverture.com/admin/api/live-checks`, then
`curl https://admin.tryoverture.com/admin/api/live-checks` for the recorded pass/fail and timing per check. The same
rows are in the `live_check_results` table.

The forms check captures one open posting per ATS from the catalog and never fills or submits. The mail group first
runs the `mail.sending` guard: gated with `status: "gated"` until `REQUIRE_EMAIL_SENDING` is on, then it verifies
`tryoverture.com` and its bounce MX, SPF, DKIM and DMARC records and fails with the owner's alert path when one is
missing. When it passes, the mail check sends to the reserved `live-check@tryoverture.com` (which maps to no user; it
is never the owner's address), and the follow-up `live.check.mail` job records whether it came back through Email
Routing and the Worker with `auth='pass'` and the matching code within `live_checks.mail_wait_minutes` (default 5, a
Settings value). Failures raise `alert.raised`, create an owner notification, and push to the phone when
`ALERT_NTFY_URL` is set as a Fly secret.

No Grafana is provisioned by this repository: the OTLP endpoint and dashboards remain in the owner's Grafana account.
The application computes the SPEC §16.5 alert thresholds from its own database and machine, so the daily check and
the test-only drill route exercise every alert kind without Grafana. If dashboards are wanted, set
`OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` on the app and create them by hand in Grafana.

## Capturing fixtures

After a deploy, queue one capture for each M1 ATS on `overture-web` (it never clicks Submit):

```sh
fly ssh console -a overture-web -C "bun run /app/scripts/capture-forms.ts --ats greenhouse --url <apply_url>"
fly ssh console -a overture-web -C "bun run /app/scripts/capture-forms.ts --ats lever --url <apply_url>"
fly ssh console -a overture-web -C "bun run /app/scripts/capture-forms.ts --ats ashby --url <apply_url>"
```

Each command prints the queued job id and exits; the worker opens the page in Browser Use, writes the sanitised form
and its assets to the `fixtures/{ats}/` prefix in R2, and stops the session through the API. Check the job row in
`bg_jobs` (`status = done`, no `last_error`) and the R2 prefix; the captured HTML contains no `<script`, event handler,
filled value, email or token. A developer pulls the files with `scripts/pull-forms.ts`.
