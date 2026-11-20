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
   The server refuses to boot without the required ones, so the **Deploy** workflow checks each required
   name with `fly secrets list` first and fails before deploying when one is missing; production keeps its
   current release. The OAuth names are not in that check. Later milestones add their own secrets the same way and to that list; nothing
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
