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
5. Set only the backup and app secrets on the app (values come from the previous step, never the repo):
   `fly secrets set R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET_BACKUPS=overture-backups -a overture-web`
   Later milestones add their own secrets the same way; nothing else exists in `fly.toml`.
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
  `{"replication":"ok","lagSeconds":<n>,"replicaTxid":"…"}`. `lagSeconds` measures how far the replica
  (`replicaTxid`) is behind the local database: the health route reads the local database's latest
  transaction id and the newest replicated one (`litestream ltx -level all` on the
  replica) on every call, and reports `0` when they match — an idle, fully replicated database reads
  `0` forever instead of growing without bound. When the local database has transactions the replica
  does not hold yet, `lagSeconds` is the age in seconds of the oldest such write; above ~300 s means
  R2 replication is falling behind. Drill: run the **Restore drill** workflow once
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
- **Third-party Actions are SHA-pinned.** `superfly/flyctl-actions/setup-flyctl` and
  `oven-sh/setup-bun` are pinned to full commit SHAs (with the ref noted in the step name); only
  first-party `actions/*` actions keep their version tags.
