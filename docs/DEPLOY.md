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
| `scripts/docker-entrypoint.sh` | On start: Litestream restores `/data/app.sqlite` from the replica if it does not exist, then runs `litestream replicate -exec "bun run /app/src/server/main.ts"`; migrations run inside `main.ts`. With `LITESTREAM_RESTORE_ONLY=true` it restores, runs the read-only restored-database check and never starts `main.ts`. With `VACUUM_ONLY=true` it compacts the application database instead, with Litestream and the server stopped |
| `litestream.yml` | Continuous replication (1 s sync) to R2 `overture-backups`, nightly snapshot (`interval: 24h`) kept 30 days (`retention: 720h`); the L0 retention check runs every 5 minutes so its ListObjects cost stays bounded (#281) |
| Deleted accounts in backups | The 35-day lifecycle on `overture-backups` (`app.sqlite/`) and the 30-day snapshot retention are the replay window for an erased account: only keyless ciphertext can come back, because `user_keys` is destroyed first (SPEC §13.2). R2 object deletes are not part of a replay |
| `fly.toml` | App `overture-web`, region `yyz`, `kill_timeout = 300`, `shared-cpu-2x` / 2 GB, volume `data` (10 GB) on `/data`, health check on `/api/health`; `PUBLIC_SIGNUP_ENABLED = "false"` keeps production invite-only (owner, invited and verified users, and the demo account) until M3 public sign-up ships, while `DEMO_LOGIN_ENABLED = "true"` keeps the demo account |
| `.github/workflows/ci.yml` | Adds a `container` job (builds the image, starts it, checks `/api/health`), a `security-and-restore` job (gitleaks over the history, the private-files guard, and the Litestream round-trip against a local file replica: replicate → restore → `integrity_check`, row counts, migrations, untouched `bg_jobs`), and the `ci-ok` aggregator every other job feeds |
| `.github/workflows/deploy.yml` | Skips with a green notice while `FLY_API_TOKEN` is unset; after CI succeeds on `main`: checks the Fly secrets, runs the Cloudflare Email Sending guard over SSH (bounded to 45 s), deploys with `flyctl deploy --remote-only`, then polls the production health route; when any step fails it prints `flyctl status` and the last 120 log lines |
| `.github/workflows/restore-drill.yml` | Weekly (Mondays 06:17 UTC, also `workflow_dispatch`): skips with a green notice while `FLY_API_TOKEN` is unset; otherwise restores from R2 into a throwaway Fly machine, checks the restored SQLite file read-only, destroys the machine |
| `.github/workflows/ops-live.yml` | `workflow_dispatch` only, one action per run: `check-secrets` (Fly secret names only), `onboard-email` (M2-02 script plus `--check`), `setup-vapid` (generates and sets the Web Push VAPID key pair, `rotate_vapid` replaces existing keys), `seed-catalog` (fetches the company seed, loads discovered boards and enqueues one catalog backfill on `overture-web`), `setup-stripe` (creates or reuses the two plans, the webhook and the portal, then sets the Fly secrets), `live-diagnostics` (runtime names present/missing and integer SQLite counts), `vacuum-db` (dry-runs the application database, then compacts it only above the freelist threshold or with `force_vacuum`). Skips with a green notice while `FLY_API_TOKEN` is unset |
| `.github/workflows/vacuum-db.yml` | Weekly (Sundays 05:00 UTC, also `workflow_dispatch` with `dry_run` and `force`): skips with a green notice while `FLY_API_TOKEN` is unset; otherwise dry-runs `/data/app.sqlite`, and only when its freelist exceeds 50 MB (or `force` is set) restarts the one machine in maintenance mode, vacuums it, restarts the server and polls `/api/health` |
| `scripts/check-restored-db.ts` | Restored-database checks, read-only: PRAGMA `integrity_check`, applied-migration count, per-table row counts, untouched `bg_jobs`, zero outbound requests |
| `scripts/restore-drill.ts` | `DRILL_TARGET=local` (CI round-trip) or `DRILL_TARGET=fly` (throwaway machine drill); never starts the app server |
| `litestream-drill.yml` | Restore-only Litestream config for drills: same bucket, dedicated read-only `R2_DRILL_*` credential |

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
   Add the 35-day lifecycle rule on `overture-backups` (prefix `app.sqlite/`) and the 8 GB storage alert;
   the exact commands, the JSON and the read-backs are in `docs/research/cloudflare-spend-guard-runbook.md` §7.
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
   The synthetic lab (#36) needs nothing new to serve `/lab/*`: `APP_ORIGIN` already names the origin the `lab.run`
   job drives (`LAB_BASE_URL` overrides it). A real reCAPTCHA v3 score needs `LAB_RECAPTCHA_SITE_KEY` and
   `LAB_RECAPTCHA_SECRET` from that site key's admin console; without the secret the lab page reports the challenge
   blocked and records no score. The hCaptcha and Turnstile site keys are optional and only change what the pages
   render. Tests point the script and siteverify URLs at same-origin stubs and never contact a vendor.
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
8. In Cloudflare, create a second R2 API token for restore drills: **Object Read only**, scoped to the
   `overture-backups` bucket alone. Set it on the app under drill-only names, never the write pair:
   `fly secrets set R2_DRILL_ACCESS_KEY_ID=… R2_DRILL_SECRET_ACCESS_KEY=… -a overture-web`
   The weekly drill uses `litestream-drill.yml`, which reads only these names, so a drill can list and
   fetch the replica but can never write, delete or replicate into it. `scripts/restore-drill.ts fly`
   refuses to start a drill machine when either name is missing.

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

The deploy guard is gated so it never blocks anything before the owner turns it on. Once the script prints
`verdict: verified`, set the GitHub Actions variable:

```sh
gh variable set REQUIRE_EMAIL_SENDING -b true -R a-hagi613/overture
```

- The **deploy guard** in `.github/workflows/deploy.yml` reads the GitHub Actions repository variable
  `vars.REQUIRE_EMAIL_SENDING` and runs `onboard-email-sending.ts --check` on the running
  release before every deploy. While the switch is off it prints a warning and the deploy continues; with the switch
  on it refuses the deploy with a clear message when the sending domain is missing, disabled or its records do not
  verify. The SSH check is bounded by `timeout 45s`, so a down or unresponsive machine counts as "not ready" instead
  of holding the `deploy-main` concurrency group open; the failure step then prints `flyctl status` and the last 120
  log lines of `overture-web` so the container boot or health failure is visible without opening the dashboard.
- The **live-check guard** is the `mail.sending` result in the daily `mail` check group. It reads the app's runtime
  switch, which `fly.toml` already sets with `[env] REQUIRE_EMAIL_SENDING = "true"`; do not also set it with
  `fly secrets set`, because a secret overrides `[env]` and the repo would stop showing what runs. While the switch is
  off it records `status: "gated"` and does not alert. With the switch on it verifies the domain and all four records and
  fails (with the owner's alert path) when they do not pass. The same group then sends the check message to the
  reserved `live-check@tryoverture.com`, which is not the owner's address, and expects it back through Email Routing.

Run the daily check once from the owner's terminal (`POST https://admin.tryoverture.com/admin/api/live-checks`) and
confirm `mail.sending` and `mail` pass. If the records were just created, Cloudflare usually propagates in 5–15
minutes; re-run `--check` until it prints `verdict: ready`.

## M3-10: the landing on Workers Static Assets (owner runbook)

The landing (`/`) is prerendered by the main build and deployed as Workers Static Assets (`workers/marketing`,
[#284](https://github.com/a-hagi613/overture/issues/284), ADR 0033). Cloudflare attaches the Worker to one explicit
route on `tryoverture.com` and no others. The front-end rebuild (ADR 0037) shipped in #501: it removed the `/pricing`
page and its `tryoverture.com/pricing*` route, and pricing is now the landing's Pricing section. The route list comes from `src/shared/marketing-paths.ts` through `workers/marketing/src/routes.ts`.

| Route | Serves |
|---|---|
| `tryoverture.com/` | `dist-marketing/index.html` |

When the first deploy after the rebuild goes out, open **Workers & Pages → overture-marketing → Settings → Domains &
Routes** and confirm only `tryoverture.com/` is listed; delete `tryoverture.com/pricing*` if it is still there.

Everything else — the app routes in `src/web/route-table.tsx` (`/home` after the rebuild, `/board`, `/inbox`,
`/profile/…`, …), `/api/*`,
`/webhooks/*`, `/assets/*`, `/sw.js`, the manifest and the icons — matches no route and goes straight to
`overture-web` on Fly. ADR 0022 still holds: the marketing pages are on the app's origin, and the app's own HTML and
assets are still served by Fly.

The deployment has no Worker script (`main` is absent in `wrangler.jsonc`), so serving a static page never invokes a
Worker: asset requests are free and unlimited, do not count as Workers requests, and keep serving while a tripped
Workers spending limit blocks script invocations (ADR 0033, `docs/research/cloudflare-paid-plan.md` §3).

`scripts/prerender.tsx` writes `dist-marketing` after `vite build`: one self-contained HTML file per page (the built
stylesheet is inlined, so the page is styled with the origin down) plus a `_headers` file carrying the app's CSP and
security headers. The app's `/assets/*.js` bundle is still referenced for hydration, so a signed-in visitor at `/`
gets the landing too (the rebuild moves the app's Home to `/home`, reached from the landing's sign-in link). Terms and
Privacy stay on Fly until they are prerendered; they are linked from the landing but are not part of this
deployment.

### Deploy

`dist-marketing` must exist (the build writes it):

```sh
bun run build
cd workers/marketing
bunx wrangler deploy
```

Wrangler needs a Cloudflare API token (or `wrangler login`) with **Workers Scripts: Edit** and **Workers Routes:
Edit** on the `tryoverture.com` zone, plus **Zone: Read** for `zone_name`. Put the token in `CLOUDFLARE_API_TOKEN`
and the account id in `CLOUDFLARE_ACCOUNT_ID` in the operator's environment only, never in the repository. `bun run
dry-run` builds the same Worker without deploying, and CI runs it after `bun run verify` (which produces
`dist-marketing`).

Deploy the Worker after the Fly release: until the matching release is live, the page can reference the previous
release's `/assets/` bundle. The page still renders; its hydration waits for the new release.

### Verify

- **The landing answers with the origin down.** Stop the machine on purpose (`fly scale count 0 -a overture-web`), then
  `curl -sS -o /dev/null -w '%{http_code}\n' https://tryoverture.com/` returns `200`; start it again
  with `fly scale count 1 -a overture-web`. The same check during a normal deploy shows the pages up through the
  10–30 s restart (SPEC §3.1).
- **No Worker invocation for app traffic.** Cloudflare dashboard → **Workers & Pages → overture-marketing → Metrics**:
  Worker requests stay at zero for a day of ordinary traffic while static asset requests show in the zone's asset
  metrics. Request `/board`, `/api/health` and an `/assets/*.js` file, then confirm the Worker's request count is
  still zero; those requests answer from Fly and appear in `fly logs -a overture-web`.
- **In the repository.**
  `bun node_modules/playwright/cli.js test test/e2e/marketing-worker.test.ts --workers=1` proves every route in
  `src/web/route-table.tsx` and every API/webhook/asset prefix matches no Worker route, that the config is
  assets-only, and that the landing serves from `dist-marketing` while a stand-in origin answers 503.

A route pattern without a wildcard matches the entire URL, query string included. The root is matched exactly (`tryoverture.com/`): a landing URL with a query string (`/?utm_source=…`) matches no
Worker route and goes to Fly. That keeps arbitrary paths away from the Worker at the cost of falling back to the
origin for tagged landing links.

### Rollback

- **A bad page, same routes:** `cd workers/marketing && bunx wrangler rollback` reverts to the previous deployment;
  `bunx wrangler deployments list` shows the versions.
- **Send everything back to Fly:** `cd workers/marketing && bunx wrangler delete` removes the Worker and its
  route (or delete it under **Settings → Domains & Routes**). `/` is then proxied to
  `overture-web` exactly as before #284; DNS does not change.
- **The route is missing or the Worker is unavailable:** the zone serves `/` from Fly, with the usual
  10–30 s deploy downtime.

No migration, secret or DNS record is part of this deployment.

## M3: Stripe plans, webhook and billing portal (owner runbook)

Billing turns on only when `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are both on `overture-web` (SPEC §11).
`scripts/setup-stripe.ts` creates the two recurring prices and the webhook the app verifies, and configures the billing
portal; it is idempotent, so the same run can be repeated safely.

### 1. Store the key as a repository secret

```sh
gh secret set STRIPE_SECRET_KEY -b <sk_live_…-from-the-Stripe-dashboard> -R a-hagi613/overture
```

A restricted key (`rk_live_…`) works when it grants write access to Products, Prices, Webhooks and Billing Portal
configurations; the script accepts `sk_test_`, `rk_test_`, `sk_live_` and `rk_live_` prefixes and refuses any other.
The key is never printed, committed or written to a file other than the temporary env file below. The script prints
only the key's mode (`test` or `live`) and public Stripe ids (`prod_…`, `price_…`, `we_…`, `bpc_…`).

### 2. Run the setup from GitHub Actions

```sh
gh workflow run ops-live.yml -f action=setup-stripe -R a-hagi613/overture
```

The workflow reads the Fly secret names, passes `--rotate-webhook` automatically when `STRIPE_WEBHOOK_SECRET` is not on
the app yet (or when the `rotate_webhook` input is `true`), runs the script, masks every secret it is about to set and
sets them on `overture-web` in one `flyctl secrets import` call, so the values never appear in a command line. A fresh 32-byte `CARD_FINGERPRINT_SECRET` is generated
with `openssl rand -hex 32` only when the app does not have one. The script's `STRIPE_WEBHOOK_SECRET` lands in
`/tmp/stripe-setup.env` (mode `0600`), which an `always()` step deletes; the workflow finishes by polling
`https://tryoverture.com/api/health`.

| Plan | Product | Price | Lookup key |
|---|---|---|---|
| Week | `Overture Week` | $9.99 USD recurring weekly (50 applications over 7 days) | `overture_week_usd` |
| Month | `Overture Month` | $29.99 USD recurring monthly (250 applications over 30 days) | `overture_month_usd` |

Both products are created with `tax_code=txcd_10103000` (SaaS, personal use), which Stripe Managed Payments requires.

The webhook endpoint is `https://tryoverture.com/webhooks/stripe` and subscribes to the nine events
`src/server/billing/webhooks.ts` handles. The billing portal configuration cancels at period end, updates payment
methods, shows invoice history and switches a subscription between the Week and Month prices with
`proration_behavior=none`; it returns to `https://tryoverture.com/profile/billing` and links the site's privacy and
terms pages (ADR 0037: Billing lives under Profile).

A second run reuses the active lookup-key prices, keeps the existing webhook (its secret is not rotated) and verifies
the portal configuration, so no duplicate product, price or endpoint appears. `rotate_webhook=true` deletes the old
endpoint after the replacement exists, so the app always has one endpoint receiving events.

When the launch price changes on an existing product, the old price still holds the lookup key, so the default run
refuses with the drift message instead of guessing. Re-run with `reconcile_prices=true` to create the replacement price
on the same product with `transfer_lookup_key=true`, archive the old price, update the billing portal configuration to
the new price ids and set them on `overture-web`:

```sh
gh workflow run ops-live.yml -f action=setup-stripe -f reconcile_prices=true -R a-hagi613/overture
```

The same flag exists on the script as `--reconcile-prices`.

### 3. Verify and diagnose

```sh
gh workflow run ops-live.yml -f action=check-secrets -R a-hagi613/overture
gh workflow run ops-live.yml -f action=live-diagnostics -R a-hagi613/overture
```

`check-secrets` prints the sorted Fly secret names (never values), `flyctl status`, and the production health route.
`live-diagnostics` runs `onboard-email-sending.ts --check`, prints `present` or `missing` for every credential and id
name (never a value), then prints the non-secret runtime flags and config (`PUBLIC_SIGNUP_ENABLED`,
`DEMO_LOGIN_ENABLED`, `REQUIRE_EMAIL_SENDING`, `ANTHROPIC_MODEL`, `BROWSER_PROVIDER`), and finally integer row counts
for `users`, `invites`, `applications`, `company_boards` and `postings`; it prints no secret value and no personal
data.

### 4. Roll back

- **A wrong price or webhook id:** re-run `setup-stripe`; the script prints the public ids it reused or created and sets
  them on the app. A hand-set `STRIPE_PRICE_WEEK` or `STRIPE_PRICE_MONTH` is replaced by the next run.
- **A leaked or wrong webhook signing secret:** run the workflow with `rotate_webhook=true`. The replacement endpoint
  exists before the old one is deleted, then the new secret is set on the app.
- **Turn billing off:** `flyctl secrets unset -a overture-web STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET`. The app boots
  with billing off when neither is set; unsetting only one stops the server at boot.
- **Test-mode resources:** the objects the script creates under `sk_test_`/`rk_test_` are test data; delete them in the
  Stripe dashboard when they are no longer needed.

The workflow itself is `workflow_dispatch` only, so reverting this change removes an operator tool without changing a
running release.

### 5. Run it locally

```sh
STRIPE_SECRET_KEY=sk_test_… APP_ORIGIN=https://tryoverture.com bun run scripts/setup-stripe.ts --out-env /tmp/stripe-test.env
```

Add `--reconcile-prices` to replace a drifted lookup-key price and archive the old one; without it the script stops
with the drift message.

Against a test key this creates test-mode products, prices, a webhook and a portal; delete them in the dashboard when
you are done. `--rotate-webhook` replaces the endpoint and writes the new `STRIPE_WEBHOOK_SECRET` to the env file.

## Push notifications and the catalog seed (owner runbook)

Both actions are `workflow_dispatch` runs of `ops-live.yml`; they read `FLY_API_TOKEN` from the repository
secrets, print names and counts only, and never write a key or a secret value to the log.

### 1. VAPID keys for Web Push

```sh
gh workflow run ops-live.yml -f action=setup-vapid -R a-hagi613/overture
```

`scripts/generate-vapid.ts` creates a P-256 key pair with `node:crypto`, writes
`VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` to `/tmp/vapid-setup.env` (mode `0600`) and prints only
`Generated VAPID P-256 keypair (public key written to out-env).` The workflow masks both values with
`::add-mask::`, imports them in one `flyctl secrets import`, polls `https://tryoverture.com/api/health`
for up to 120 s, and an `always()` step deletes the temporary env file. The public key is the 65-byte
uncompressed point `web-push.ts` expects; the private key is the raw 32-byte scalar.

The action is idempotent: it lists the Fly secret names first and, when both are already set, logs
`VAPID keys are already set on overture-web.` and exits 0. Replace them deliberately with:

```sh
gh workflow run ops-live.yml -f action=setup-vapid -f rotate_vapid=true -R a-hagi613/overture
```

Rotating the pair invalidates push subscriptions that browsers registered against the old public key;
each browser must subscribe again, and `VAPID_SUBJECT` (default `mailto:admin@tryoverture.com`) stays
untouched. To turn Web Push off, unset both names together — the server boots with push disabled only
when neither is set — with
`flyctl secrets unset -a overture-web VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY`.
To generate a pair locally, run `bun run scripts/generate-vapid.ts --out-env /tmp/vapid.env`,
copy the values into `fly secrets set`, then delete the file.

### 2. Catalog seed and backfill

```sh
gh workflow run ops-live.yml -f action=seed-catalog -R a-hagi613/overture
```

The action makes one bounded `flyctl ssh console -a overture-web -C <command>` call per step, because
`flyctl` runs that command directly rather than through a shell, so `&&` chaining does not work. Each call
runs under its own `timeout` and stops the action on a timeout (exit 124) or a non-zero exit:

1. `mkdir -p /data/seed` (60 s, root) and `chown app:app /data/seed` (60 s, root);
2. as the unprivileged `app` user, `fetch-seed.ts --dir /data/seed` (300 s) downloads the pinned
   `manifest.json` and `companies.parquet` and verifies their checksums;
3. as `app`, `load-discovered-boards.ts --db /data/app.sqlite --manifest /data/seed/manifest.json
   --companies /data/seed/companies.parquet` (300 s) inserts the boards in batches of at most 500
   (idempotent: a second run loads no duplicate board);
4. as `app`, `enqueue-backfill.ts --db /data/app.sqlite` (120 s) enqueues one `catalog.backfill` job and
   prints the job id, whether it was newly enqueued and the estimated work; a second run does not queue a
   duplicate.

Each command's output is appended to the run's step summary under its own heading, and the action finishes
by checking `https://tryoverture.com/api/health`. The seed files stay in `/data/seed` so a later run
reuses the verified download; the backfill job itself is picked up by the app's job worker.

## Admin host: `admin.tryoverture.com` (owner runbook)

The Admin Portal is the same process as the app, selected by the `Host` header: a request to
`admin.tryoverture.com/admin/api/*` reaches the admin API, and any other host gets the normal app. In production the
admin host sits behind a Cloudflare Zero Trust Access application with a policy for the owner's email only, on top of
the app's own owner check and the passkey window. The values are already in `src/server/config/env.ts`; this section
provisions what the deployment needs around them.

Owners reach the portal from the app: the Profile menu and `/profile/account` carry an **Admin Portal** link, and
visiting `/admin` on `tryoverture.com` shows a handoff card that opens the same path on the admin host. Regular users,
the demo account and anonymous visitors never see the link, because `GET /api/me` returns `adminOrigin: null` for
them (#512).

### 1. DNS and the Fly certificate

Point the admin hostname at the app in Cloudflare DNS and keep the record proxied (orange cloud), because Cloudflare
Access can only gate proxied traffic:

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `admin` | `overture-web.fly.dev` | Proxied |

Then ask Fly for a certificate for that hostname and follow the validation record it prints:

```sh
flyctl certs add admin.tryoverture.com -a overture-web
flyctl certs show admin.tryoverture.com -a overture-web
```

Keep the validation record Fly prints in place until `flyctl certs show` reports `Status = Issued`.

### 2. Cloudflare Zero Trust Access

In **Zero Trust → Access → Applications**, add a self-hosted application for `admin.tryoverture.com` and a single
`Allow` policy whose `Include` rule is `Emails` with the owner's address. Set the session duration to the working day
(for example 12 hours). Copy the application's **Application Audience (AUD) Tag** and note the team domain
(`<team>.cloudflareaccess.com`); the JWKS endpoint is
`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`.

### 3. Fly secrets (names only)

Set the four names from the operator's terminal; the values come from the Access application above and are never
committed, printed or copied into this repository:

```sh
fly secrets set \
  ADMIN_ORIGIN=https://admin.tryoverture.com \
  CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com \
  CF_ACCESS_AUD=<application-aud-tag> \
  CF_ACCESS_JWKS_URL=https://<team>.cloudflareaccess.com/cdn-cgi/access/certs \
  -a overture-web
```

### 4. Verify the whole path

The check script is read-only and idempotent. It resolves DNS, probes `https://<origin>/admin/api/session` over HTTPS
and classifies the answer (a Cloudflare Access sign-in redirect or `401 access_required` passes; a `200 text/html` app
shell is the SPA bug), then reads the Fly certificate and secret **names** with `flyctl`. It never reads or prints a
secret value.

```sh
bun run scripts/check-admin-host.ts
bun run scripts/check-admin-host.ts --json
bun run scripts/check-admin-host.ts --origin https://admin.example.test --fly-app another-app
```

Exit `0` means every check passed; exit `1` prints the gaps. Use `--no-fly` to skip the two Fly reads when `flyctl` is
unavailable, `--host` to name the DNS record when it differs from the origin's hostname, `--origin` to check another
admin origin (it must be `https`), and `--fly-app` to read the certificate and secret names from another Fly app.
The matching unit tests run with `bun test scripts/check-admin-host.test.ts`.

Finally sign in as the owner, open `/profile/account` and confirm the **Admin Portal** card, then open `/admin` on
`tryoverture.com` and confirm the handoff card opens `https://admin.tryoverture.com/admin` through Access and the
passkey.

## Verifying the acceptance criteria

- **A merge to `main` deploys `overture-web` and the health route answers in production**
  The Deploy workflow (`.github/workflows/deploy.yml`) runs only after the CI workflow succeeds on
  `main`, deploys with `flyctl deploy --remote-only`, and fails if `https://overture-web.fly.dev/api/health`
  does not answer. Verify: green Deploy run, and in a terminal
  `curl -fsS https://overture-web.fly.dev/api/health` → `{"status":"ok","database":"ok",...}`. A failed run ends with
  the `Show Fly status and logs after a failed deploy` step, so the machine status and last 120 log lines are in the
  job log; the Email Sending SSH guard is capped at 45 s so a down machine cannot stall the run.
- **Litestream lag is visible and a restore drill has passed once**
  Lag: `curl -fsS https://overture-web.fly.dev/api/health | jq .backups` →
  `{"replication":"ok","lagSeconds":<n>,"replicaTxid":"…","readAgeSeconds":<n>}`. `lagSeconds` measures how
  far the replica (`replicaTxid`) is behind the local database. The server reads the replica's newest
  transaction id (one level at a time from level 0, which holds the newest file, so a healthy replica costs
  one R2 list per read) and the local database's transactions (`litestream ltx -level all`) in the background every
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
  proves a restore into a throwaway machine passed `integrity_check`, holds every applied migration, left
  every `bg_jobs` row untouched and made no outbound request, and the machine was destroyed.
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

## Restarts, shutdown and the health check

Two clocks bound a deploy. Fly stops a machine after `kill_timeout = 300`, but the container's main process is
Litestream, and Litestream's `replicate -exec` gives its child — the Bun server — 30 s after the signal before it logs
`Error: shutdown timed out after 30s: context deadline exceeded`, SIGKILLs the child and exits 1. The server's own
graceful budget (`KILL_TIMEOUT_MS`, default 20 s) therefore has to fit inside that window.

On `SIGINT`/`SIGTERM` (`fly logs` shows the three lines in order):

1. `overture shutdown: SIGINT: draining with a 20000 ms budget`
2. stop accepting, give in-flight requests `SHUTDOWN_QUIET_GRACE_MS` (2 s), then force the long-lived ones shut —
   `/api/events` also ends on the shutdown signal, so a stream cannot hold the stop until the idle timeout;
3. drain in-flight jobs with the remaining budget and requeue them (`interrupted` / lease expiry recovers the rest);
4. `overture shutdown: stopped in <ms>` and exit 0, one second before a SIGKILL backstop. A SIGKILL or exit 1 here
   means Litestream killed the child: the budget and the Litestream deadline have drifted apart again.

A restart also starts the job worker with a settle window (`JOBS_STARTUP_SETTLE_MS`, 5 s). Without it the startup
enqueues (catalog sweep, check-ins, grant expiry, retention, prep) woke the worker in the same second the port opened,
so the new machine's first health checks competed with a full batch of jobs. Queued work is not lost; it starts a few
seconds later.

`/api/health` runs `select 1` and serves the cached replica reading, so it is a main-thread operation: if health checks
fail while the process is alive and `fly logs` shows no application line, the event loop was blocked. The server logs
that directly now — `overture event-loop-lag: Error: the event loop was blocked for <n> ms` — measured on a 1 s timer,
so the next incident has a duration instead of a gap in the log.

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

## Compacting a bloated application database (issue #506)

The catalog split (#490) left the pages its old tables used in `/data/app.sqlite`: production measured 1,602 MB with
1,596 MB of free pages and a 477 MB WAL, while live user rows were about 6 MB, and Litestream replicated every byte.
Those pages only come back when the file is vacuumed offline. Boot never runs it: a `VACUUM` on a large file would hold
startup past Fly's health-check grace period.

`scripts/vacuum-app-db.ts` is the maintenance pass. It prints page, freelist, file and WAL sizes, checkpoints
(`PRAGMA wal_checkpoint(TRUNCATE)`), runs `VACUUM`, checkpoints again and verifies `PRAGMA integrity_check`. It refuses
to write without `--confirm` and refuses while another process holds the write lock; `--dry-run` only reports. It is
safe to re-run: a file with no free pages is left alone.

A Fly volume attaches to exactly one machine, even while that machine is stopped, so a second volume-attached machine
cannot vacuum the live file. `scripts/vacuum-fly.ts` therefore uses the one production machine in a short maintenance
window:

1. `bun run scripts/vacuum-fly.ts plan` runs the dry run over SSH on the running machine and reports its sizes. It
   never writes.
2. `bun run scripts/vacuum-fly.ts compact` repeats the dry run and stops there unless the freelist is above 50 MB or
   `--force` is passed. Then it sets `VACUUM_ONLY=true` on the machine and restarts it; `scripts/docker-entrypoint.sh`
   fixes the volume's ownership, drops to the `app` user, runs
   `scripts/vacuum-app-db.ts /data/app.sqlite --confirm`, writes its output and exit code to `/tmp`, and holds the
   machine open. Litestream and the server never start in that mode.
3. In a `finally` path the workflow restores the normal environment, restarts the machine, waits for it to start and
   polls `https://tryoverture.com/api/health` for 120 s. A failed vacuum still restarts the server, and a failed health
   check fails the job so it alerts instead of serving.

The script verifies `integrity_check` before it reports success, and SQLite leaves the file unchanged when the
checkpoint stays busy or the vacuum aborts. If a run ever reports a failed integrity check, stop the machine and
restore from the replica (the same Litestream restore the drill exercises) before serving traffic.

The weekly `vacuum-db.yml` job does this every Sunday at 05:00 UTC; `ops-live.yml` offers the same run as the
`vacuum-db` action with `force_vacuum`. Both refuse on a release that predates the maintenance mode (deploy `main`
first), and it runs in the quiet 05:00 UTC slot so a deploy rarely overlaps it. Do not run it against
`catalog.sqlite` (which is rebuilt from feeds anyway).

## Restore drill safety

A restore drill must prove the backup is usable without ever running the application on restored
production data (issue #412). The throwaway machine runs the same image with
`LITESTREAM_RESTORE_ONLY=true`, which changes the entrypoint to:

1. restore `/data/app.sqlite` from R2 with `litestream-drill.yml` and the read-only `R2_DRILL_ACCESS_KEY_ID` /
   `R2_DRILL_SECRET_ACCESS_KEY` pair;
2. run `scripts/check-restored-db.ts` against the restored file, opened `readonly` with `PRAGMA query_only = on`:
   `PRAGMA integrity_check`, the applied-migration count (`__drizzle_migrations` and the journal this build
   ships), per-table row counts, a `bg_jobs` snapshot that must stay identical, and an outbound guard that
   refuses and reports any request;
3. print the report and hold the machine open for `RESTORE_DRILL_KEEPALIVE_SECONDS` (default 600) while the drill
   driver runs the same check over SSH for an exit code, then destroys the machine.

`bun run /app/src/server/main.ts` is never reached in this mode, and `main.ts` itself refuses to start when
`LITESTREAM_RESTORE_ONLY=true`: no scheduler, job worker, mail sender, billing
job or outbound client is constructed, so due `application.send`, queued mail and billing jobs in the restored
database cannot be claimed or run. The machine has no volume mount, so it also cannot touch the production
database. Fly gives every machine in an app the app's secrets, so the drill machine also holds the write pair;
only the restore process reads the read-only `R2_DRILL_*` pair, and no application code runs there. The drill
first checks over SSH that the running release carries this drill mode and `litestream-drill.yml`, and refuses to
start when it predates this change, so an old image that would start the app server is never drilled. The local CI
job (`bun run scripts/restore-drill.ts local`) restores into a file replica and runs the same check against it.

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

## The Workable feed pass (M2-25)

`.github/workflows/workable-feed.yml` runs the off-box pass at 04:00 UTC and on `workflow_dispatch`; it never runs on a
pull request or a push. Its first step checks that the repository secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET_FILES` and `R2_ENDPOINT` are set: while any is missing it writes a skip notice to
the step summary and the run finishes green without fetching the feed, publishing a snapshot or pushing an alert, so a
repository without R2 credentials does not turn `main` red every day. The script refuses a live URL unless
`WORKABLE_LIVE_FETCH=1`, which the workflow sets. `WORKABLE_ALERT_NTFY_URL` is optional and only
used to push a failure to the owner's phone. `WORKABLE_FEED_URL` is an optional repository variable; the default is
`https://www.workable.com/boards/workable.xml`.

The pass reads `workable-targets.json` from R2 (the app writes it at 05:00 UTC, values only) and writes
`workable/YYYY-MM-DD.jsonl.gz` plus `workable/manifest.json`. It refuses to publish a snapshot whose row count dropped
more than 20 % from the previous run; `workflow_dispatch` with `--allow-row-drop` is the deliberate override. The app
ingests the manifest at 05:00 UTC in `catalog.workable`, behind the `ats`/`workable` kill switch, which stays on until
the 20-form probe (#235). The alerts are `workable.feed` for a missing snapshot, one older than 26 hours, a row drop
or a failed ingest, and the GitHub job itself fails loudly.

## The Stapply seed refresh (Wave 3.5)

`.github/workflows/stapply-seed.yml` runs weekly (Monday 05:23 UTC) and on `workflow_dispatch`; it never runs on a pull
request or a push. It downloads the ats-scrapers `manifest.json` and `companies.parquet` through
`scripts/refresh-stapply-seed.ts` and **stages** them, it never touches the production pins by itself. Three guards run
before anything is written:

- **Schema:** the manifest is parsed against a Zod schema (`version`, `generated_at`, `companies.parquet_sha256`,
  `companies.rows`) and the parquet columns must be exactly `[ats, name, slug, url]` with the row count the manifest
  declares.
- **SHA-256:** the manifest's `companies.parquet_sha256` must equal the hash of the downloaded bytes (and the declared
  `parquet_size_bytes`, when present, the byte length), so a truncated or swapped file is refused.
- **Row-drop:** a snapshot more than 20 % smaller than the prior staged one is refused; `workflow_dispatch` with
  `allow_row_drop` is the deliberate override after checking upstream.

The prior staged snapshot is restored from the Actions cache and the new one is saved only when the run succeeds, so an
upstream outage, a schema change, a checksum mismatch or a shrunken input leaves the last good snapshot in place. Each
run uploads the staged `manifest.json`, `companies.parquet` and `stapply-refresh.json` summary as an artifact and writes
the same summary to the step summary. Run it once with `workflow_dispatch` before relying on the schedule; nothing
leaves the runner except the cache, the artifact and the summary. A staged snapshot is a candidate: review the
checksums and row delta, re-pin `PINNED_MANIFEST_SHA256` and `PINNED_COMPANIES_PARQUET_SHA256` in
`src/server/catalog/companies-parquet.ts`, then rerun `docs/research/m1-09-runbook.md` §1–2 to load it.
`STAPPLY_MANIFEST_URL` and `STAPPLY_COMPANIES_URL` are optional repository variables; the defaults are the pinned
`https://storage.stapply.ai/jobs/v1/…` URLs. `STAPPLY_ALERT_NTFY_URL` is optional and only pushes an aborted run to the
owner's phone; without it the failing job and its step summary are the alert.

## The sentinel Worker (#283)

`workers/sentinel` is a cron Worker that watches Overture from outside Fly (ADR 0033). Every ten minutes it probes
`https://tryoverture.com/api/health`, reads `workable/manifest.json` from the `overture-files` bucket, and reads
month-to-date R2, Queues and Workers usage from the Cloudflare GraphQL Analytics API. It pushes to
`ALERT_NTFY_URL` at 70 % of an allowance and at 90 % writes `ops/degraded.json`, which the app reads and logs: mail
classification goes rules-only and the live-check R2 round trip is skipped. It never revokes an R2 token — that would
stop Litestream.

```sh
cd workers/sentinel
bunx wrangler secret put ALERT_NTFY_URL          # the owner's ntfy topic
bunx wrangler secret put CLOUDFLARE_ACCOUNT_TAG  # the 32-character account tag
bunx wrangler secret put CLOUDFLARE_ANALYTICS_TOKEN # token with Account Analytics: Read
bunx wrangler deploy
```

`workers/sentinel/README.md` has the thresholds, the alert keys and the monthly invocation budget. The Worker has no
public route (`workers_dev` is false) and writes no console output: each run records itself as `lastRun` inside
`ops/sentinel-state.json`, so one command shows the last run, its alerts and any error:

```sh
bunx wrangler r2 object get overture-files/ops/sentinel-state.json --pipe
```

Cloudflare's dashboard still shows the crons' invocation and error counts; a run whose state write fails throws, so it
appears there as an errored invocation.

What each push means and what to check first:

| Alert | Meaning | First check |
|---|---|---|
| `health` | `/api/health` failed or answered a body that is not `"status":"ok"` from outside Fly | the URL from the owner's machine, then `fly status -a overture-web` and `fly logs -a overture-web` (a failed Deploy run already prints both) |
| `health.recovered` | the probe passes again | nothing; the app's own health alerts record the incident |
| `workable` | `workable/manifest.json` is older than 26 h, missing or unparseable | the last `workable-feed` GitHub Action run, then `bunx wrangler r2 object get overture-files/workable/manifest.json --pipe` |
| `workable.recovered` | the manifest is young again | nothing |
| `usage.<metric>.warn` | one allowance passed 70 % | §3–§5 of `docs/research/cloudflare-spend-guard-runbook.md` |
| `usage.degraded` | one or more allowances passed 90 %; `ops/degraded.json` is set and the app runs rules-only | the same runbook; the flag clears itself when usage drops below 90 % |
| `usage.error` | the GraphQL analytics answer could not be read; the flag, if set, stands | `CLOUDFLARE_ANALYTICS_TOKEN` expiry and Cloudflare's status page |
| `usage.unconfigured` | `CLOUDFLARE_ACCOUNT_TAG` or `CLOUDFLARE_ANALYTICS_TOKEN` is missing | set both secrets and redeploy |

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
