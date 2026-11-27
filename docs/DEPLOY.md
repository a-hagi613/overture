# DEPLOY.md

One-time human steps to go from this repository to a live, backed-up `overture-web`, and how to verify
each acceptance criterion of [issue #10](https://github.com/a-hagi613/overture/issues/10).

Everything in this document is done by a human or by the repository's manual workflows; nothing here creates cloud
resources automatically. No secret value ever appears in this repository: secrets are set with `gh secret set NAME`
and `fly secrets set NAME=VALUE` (the admin-host workflow copies the Cloudflare Access values from repository secrets
to Fly), against names only.

## What the repo already provides

| File | Role |
|---|---|
| `Dockerfile` | Multi-stage build on Bun 1.4: installs, builds the SPA (`dist/`), ships a slim runtime with Litestream 0.5.18 (checksum-verified) |
| `scripts/docker-entrypoint.sh` | On start: Litestream restores `/data/app.sqlite` from the replica if it does not exist, then runs `litestream replicate -exec "bun run /app/src/server/main.ts"`; migrations run inside `main.ts`. With `LITESTREAM_RESTORE_ONLY=true` it restores, runs the read-only restored-database check and never starts `main.ts`. With `VACUUM_ONLY=true` it compacts the application database instead, with Litestream and the server stopped |
| `litestream.yml` | Continuous replication (1 s sync) to R2 `overture-backups`, nightly snapshot (`interval: 24h`) kept 30 days (`retention: 720h`); the L0 retention check runs every 5 minutes so its ListObjects cost stays bounded (#281) |
| Deleted accounts in backups | The 35-day lifecycle on `overture-backups` (`app.sqlite/`) and the 30-day snapshot retention are the replay window for an erased account: only keyless ciphertext can come back, because `user_keys` is destroyed first (SPEC §13.2). R2 object deletes are not part of a replay |
| `fly.toml` | App `overture-web`, region `yyz`, `kill_signal = "SIGTERM"`, `kill_timeout = 300`, `shared-cpu-2x` / 2 GB, volume `data` (10 GB) on `/data`, health check on `/api/health`; `PUBLIC_SIGNUP_ENABLED = "false"` keeps production invite-only (owner, invited and verified users, and the demo account) until M3 public sign-up ships, while `ALLOWED_SIGNUP_EMAILS` can name comma-separated tester addresses that may still sign up, and `DEMO_LOGIN_ENABLED = "true"` keeps the demo account |
| `.github/workflows/ci.yml` | Adds a `container` job (builds the image, starts it, checks `/api/health`), a `security-and-restore` job (gitleaks over the history, the private-files guard, and the Litestream round-trip against a local file replica: replicate → restore → `integrity_check`, row counts, migrations, untouched `bg_jobs`), and the `ci-ok` aggregator every other job feeds |
| `.github/workflows/deploy.yml` | Skips with a green notice while `FLY_API_TOKEN` is unset; after CI succeeds on `main`: checks the Fly secrets (the freehire key only when `REQUIRE_FREEHIRE_API_KEY` is on), runs the Cloudflare Email Sending guard over SSH (bounded to 45 s), deploys with `flyctl deploy --remote-only`, then polls the production health route; when any step fails it prints `flyctl status` and the last 120 log lines |
| `.github/workflows/restore-drill.yml` | Weekly (Mondays 06:17 UTC, also `workflow_dispatch`): skips with a green notice while `FLY_API_TOKEN` is unset; otherwise restores from R2 into a throwaway Fly machine, checks the restored SQLite file read-only, destroys the machine |
| `.github/workflows/ops-live.yml` | `workflow_dispatch` only, one action per run: `check-secrets` (Fly secret names only), `onboard-email` (M2-02 script plus `--check`), `setup-vapid` (generates and sets the Web Push VAPID key pair, `rotate_vapid` replaces existing keys), `seed-catalog` (fetches the company seed, loads discovered boards and enqueues one catalog backfill on `overture-web`), `setup-stripe` (creates or reuses the two plans, the webhook and the portal, then sets the Fly secrets; `stripe_env` chooses the `sandbox` or `production` Stripe account, default `sandbox`), `sync-ops-secrets` (pushes the optional ops secrets and flags, including `ALLOWED_SIGNUP_EMAILS` and `FREEHIRE_API_KEY`, to `overture-web`), `live-diagnostics` (runtime names present/missing and integer SQLite counts), `vacuum-db` (dry-runs the application database, then compacts it only above the freelist threshold or with `force_vacuum`). Skips with a green notice while `FLY_API_TOKEN` is unset |
| `.github/workflows/ops-admin-host.yml` | `workflow_dispatch` only, for the admin host: `status` (certificate table, Fly secret names only, app status), `add-cert` (idempotent certificate for `admin.tryoverture.com`, then the same report), `set-access-secrets` (pushes the Cloudflare Access values held as repository secrets to Fly, names only afterwards). Fails with a clear message while `FLY_API_TOKEN` is unset |
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
   bucket without the three credentials, or the credentials partly set) stops the server at boot. Every new sealed
   object binds its `user_id` into the associated data; objects written before that change still open through the
   legacy associated data once, and the app logs `crypto.aad.legacy_fallback` for each such read.
   Sign-in (M1-06) adds `BETTER_AUTH_SECRET` (at least 16 random characters, or `BETTER_AUTH_SECRETS` for a
   non-destructive rotation: see the Better Auth secret rotation runbook below), `OWNER_EMAIL`,
   `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` (a Turnstile widget for `tryoverture.com`), and optionally
   `TURNSTILE_HOSTNAMES` (defaults to the `APP_ORIGIN` and `ADMIN_ORIGIN` hostnames, so both
   `tryoverture.com` and `admin.tryoverture.com` must be allowed on the widget; never localhost or 127.0.0.1 in
   production).
   The OAuth clients are optional until they exist, one pair at a time: `GOOGLE_CLIENT_ID` with
   `GOOGLE_CLIENT_SECRET`, and `LINKEDIN_CLIENT_ID` with `LINKEDIN_CLIENT_SECRET` (redirect URIs
   `https://tryoverture.com/api/auth/callback/google` and `…/api/auth/callback/linkedin`, plus
   `http://localhost:3000/api/auth/callback/{google,linkedin}` for local development; the generic OAuth
   plugin registers the core `/callback/:id` route, so there is no `oauth2` segment).
   A provider whose pair is not both set is not registered and its button does not render; the
   emailed sign-in link works on its own. Setting only one name of a pair stops the server at boot.
   Resume and Facts (M1-13) add `MASTER_KEY_V1`, generated with `openssl rand -base64 32`
   (base64 that decodes to exactly 32 bytes). A rotation to `MASTER_KEY_V2` follows the master-key runbook
   below: stage the new secret, deploy, dry run, run the re-wrap job, verify, then remove the old secret.
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
   `REQUIRE_CLOUDFLARE_EMAIL_SECRETS` is set (M1-90 section below). `FREEHIRE_API_KEY` stays out of the required
   list until `REQUIRE_FREEHIRE_API_KEY` is set, so deploys keep working on the free plan until the owner buys the
   API plan after the #710 walk (launch runbook below). Later milestones add their own secrets the same way and to
   that list; nothing else exists in `fly.toml`.
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

### Apply aliases and the notify sending domain (issue #566)

Two optional settings name the mail domains; neither is a secret and both default safely:

| Setting | Default | What it does |
|---|---|---|
| `ALIAS_EMAIL_DOMAIN` | `MAIL_DOMAIN` (`tryoverture.com`) | the domain of every person's readable apply alias (`alex.chen.4k@tryoverture.com`) |
| `NOTIFY_MAIL_DOMAIN` | `notify.tryoverture.com` | the isolated outbound sending domain for transactional mail |

The full alias is stored on `mailboxes.apply_address`, so moving to a stealth apex later is one env change (set it on
the app, with `fly secrets set` or under `[env]` in `fly.toml`):

```sh
fly secrets set ALIAS_EMAIL_DOMAIN=tryoverture.com -a overture-web
```

Only new assignments use the new domain; aliases already handed out keep the address employers were given. The
apex catch-all in the inbound Email Worker (issue #561) answers on the alias domain and forwards employer replies from
`notify@notify.tryoverture.com`; each user's forwarding address still works beside it. When the alias domain changes,
keep the old domain's catch-all in place while any alias is stored on it, because the app resolves an alias by its
full stored address.

Onboard the notify sending domain once Workers Paid is active:

```sh
fly ssh console -a overture-web -C "bun run /app/scripts/onboard-email-sending.ts --notify --dry-run"
fly ssh console -a overture-web -C "bun run /app/scripts/onboard-email-sending.ts --all"
```

`--all` onboards and verifies both `MAIL_DOMAIN` and `NOTIFY_MAIL_DOMAIN`; `--check --all` is the read-only form. The
Ops Live `onboard-email` action runs both, and its record check reports both. The deploy guard still checks only
`MAIL_DOMAIN`, so merging this does not block a deploy before the notify domain is onboarded. If `CLOUDFLARE_ZONE_ID`
is unset the script walks up from `notify.tryoverture.com` to the `tryoverture.com` zone, which needs **Zone: Read**
on the token.

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
`/webhooks/*`, `/assets/*`, `/sw`, the manifest and the icons — matches no route and goes straight to
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

The Worker must serve the HTML of the release that is **already live on Fly**, because the page hydrates from that
release's `/assets/*` bundle. A second `bun run build` is not equivalent: `.dockerignore` gives the Docker build
context a smaller file set for Tailwind to scan, so the same commit hashed `/assets/main-*.js` differently inside the
image than on a full checkout. The Worker then referenced a `main-*.js` that only existed in its own build, the origin
answered 404, and the landing never hydrated (blank live supply count, frozen hero counter). `src/web/styles.css`
pins Tailwind's scan to `src/` and `index.html` so the two contexts now agree, and the deploy no longer rebuilds the
page at all.

`deploy-workers` therefore syncs the page from the running machine and verifies it twice:

```sh
# what .github/workflows/deploy.yml runs, in order
remote_archive="/tmp/overture-dist-marketing-$$.tgz"
flyctl ssh console -q -a overture-web -C \
  "sh -c 'set -e; trap \"rm -f ${remote_archive}\" EXIT; tar -czf ${remote_archive} -C /app dist-marketing; echo OVERTURE-TAR-BEGIN; base64 ${remote_archive}; echo OVERTURE-TAR-END'" \
  > archive.txt
awk '$0 == "OVERTURE-TAR-BEGIN" { inside = 1; started = 1; next }
     $0 == "OVERTURE-TAR-END" { inside = 0; closed = 1; next }
     inside { print }
     END { if (!started || !closed) exit 3 }' archive.txt | base64 -d | tar -xzf -
bun run scripts/verify-marketing-assets.ts --dir dist-marketing --base https://overture-web.fly.dev
cd workers/marketing && bunx wrangler deploy
bun run scripts/verify-marketing-assets.ts --dir dist-marketing --base https://tryoverture.com --attempts 5
```

`flyctl ssh console -C` does not run its argument through a shell: the machine's SSH server splits the string into
words (honouring quotes) and executes the first word with the rest as its arguments, so a bare `;`, `|` or `&&` is
just another argument. A pipeline passed bare therefore makes the remote `printf` print the script as literal text —
that is exactly how the deploy failed with `gzip: stdin: unexpected end of file`. Always wrap a multi-statement remote
command in `sh -c '…'`, whose single argument is the whole script, and `set -e` inside it so a failed `tar` or `base64`
becomes the console's exit code instead of an empty archive. The script itself stays free of single quotes, because
the wrapper owns them; the sentinels are plain words, so `echo` needs no quoting.

The remote tarball is named after the local shell's pid and removed by an `EXIT` trap, so a manual recovery can run
next to a deploy without either copy truncating or deleting the archive the other is still streaming. The local
`${remote_archive}` is expanded by your shell, not by the machine, which is why the value is interpolated into the
quoted command rather than computed remotely.

`flyctl ssh console` also prints its own connection text (for example `Connecting to fdaa:…`) on stdout, and a raw
gzip stream fed straight to `tar` would be corrupted by it. The step passes `-q` to silence the progress indicators
and carries the archive base64-encoded between sentinel markers, so only payload lines reach `tar`: a stray notice is
discarded, and a missing frame or corrupt payload fails the job instead of extracting a partial page.

The sync fails the job when `/app/dist-marketing/index.html` is missing: shipping stale HTML is never the fallback.
`scripts/verify-marketing-assets.ts` fetches every `/assets/*` the page references with `GET` (never `HEAD`: the Fly
proxy answers `HEAD /` differently while a machine is cold or restarting, and a `HEAD` never proves the hydrate
payload downloads) and fails on a non-200 or an empty body, so a mismatch stops the deploy instead of a visitor.

A `deploy-workers` run that fails before `wrangler deploy` leaves the previous Worker version live while Fly already
serves the new release, so `/` can 404 its assets until the Worker is updated. Recover by re-running the job
(`gh run rerun <run-id> --failed`) or by running the manual snippet above; both only read the machine and deploy the
page, so they are safe to repeat. The cross-check in the `container` CI job and the pre-deploy verify make a silent
drift impossible, which is the failure this ordering trades against.

For a manual deploy, never build twice: take the page from the machine that serves its assets, exactly as the
workflow does.

```sh
mkdir -p dist-marketing
remote_archive="/tmp/overture-dist-marketing-$$.tgz"
flyctl ssh console -q -a overture-web -C \
  "sh -c 'set -e; trap \"rm -f ${remote_archive}\" EXIT; tar -czf ${remote_archive} -C /app dist-marketing; echo OVERTURE-TAR-BEGIN; base64 ${remote_archive}; echo OVERTURE-TAR-END'" \
  > archive.txt
awk '$0 == "OVERTURE-TAR-BEGIN" { inside = 1; started = 1; next }
     $0 == "OVERTURE-TAR-END" { inside = 0; closed = 1; next }
     inside { print }
     END { if (!started || !closed) exit 3 }' archive.txt | base64 -d | tar -xzf -
bun run scripts/verify-marketing-assets.ts --dir dist-marketing --base https://overture-web.fly.dev
cd workers/marketing
bunx wrangler deploy
cd ../..
bun run scripts/verify-marketing-assets.ts --dir dist-marketing --base https://tryoverture.com --attempts 5
```

Wrangler needs a Cloudflare API token (or `wrangler login`) with **Workers Scripts: Edit** and **Workers Routes:
Edit** on the `tryoverture.com` zone, plus **Zone: Read** for `zone_name`. Put the token in `CLOUDFLARE_API_TOKEN`
and the account id in `CLOUDFLARE_ACCOUNT_ID` in the operator's environment only, never in the repository. `bun run
dry-run` builds the same Worker without deploying, and CI runs it after `bun run verify` (which produces
`dist-marketing`).

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
  `bun node_modules/playwright/cli.js test test/e2e/marketing-hydration.test.ts --workers=1` serves the built
  `dist-marketing/index.html` at `/` against the app's own `/assets/*` and `/api/supply` (after `bun run build`), and
  fails on a missing asset, any console error or any `>= 400` response, or a live count that never leaves `—`.

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
Regular Stripe Billing handles the charges and Stripe Tax calculates the tax; Overture is the seller and Stripe the
payment processor (ADR 0018, ADR 0031). `scripts/setup-stripe.ts` creates the two recurring prices and the webhook the
app verifies, and configures the billing portal; it is idempotent, so the same run can be repeated safely.

### 1. Store the keys as repository secrets

The owner keeps two Stripe accounts, each with its own secret key, plus the legacy single-key name as a fallback:

```sh
gh secret set STRIPE_SANDBOX_SECRET_KEY -b <sk_test_…-from-the-Sandbox-dashboard> -R a-hagi613/overture
gh secret set STRIPE_PROD_SECRET_KEY -b <sk_live_…-from-the-Production-dashboard> -R a-hagi613/overture
```

`setup-stripe` reads `STRIPE_SANDBOX_SECRET_KEY` for `stripe_env=sandbox` and `STRIPE_PROD_SECRET_KEY` for
`stripe_env=production`; in production it falls back to the older `STRIPE_SECRET_KEY` repository secret when the
production name is unset. It fails with a clear `::error::` naming the missing secret rather than guessing.

A restricted key (`rk_test_…` / `rk_live_…`) works when it grants write access to Products, Prices, Webhooks and
Billing Portal configurations; the script accepts `sk_test_`, `rk_test_`, `sk_live_` and `rk_live_` prefixes and
refuses any other. The key is never printed, committed or written to a file other than the temporary env file below.
The script prints only the key's mode (`test` or `live`) and public Stripe ids (`prod_…`, `price_…`, `we_…`,
`bpc_…`).

### 2. Run the setup from GitHub Actions

```sh
gh workflow run ops-live.yml -f action=setup-stripe -f stripe_env=sandbox -R a-hagi613/overture
gh workflow run ops-live.yml -f action=setup-stripe -f stripe_env=production -R a-hagi613/overture
```

`stripe_env` is a choice input (`sandbox` or `production`) that defaults to `sandbox`, so a run without it configures
the sandbox account. The workflow picks that account's secret, masks it with `::add-mask::`, and only then exports it
to the script and to `flyctl secrets import`; an unknown value stops the run.

The workflow reads the Fly secret names, passes `--rotate-webhook` automatically when `STRIPE_WEBHOOK_SECRET` is not on
the app yet, when the `rotate_webhook` input is `true`, or when the app currently runs the other account's key
(`CURRENT_STRIPE_ENV`, read over SSH from the key prefix only and never printed, differs from `stripe_env`), runs the
script, masks every secret it is about to set and
sets them on `overture-web` in one `flyctl secrets import` call, so the values never appear in a command line. That
last check makes a `sandbox` ↔ `production` switch rotate the webhook even when the caller omits `rotate_webhook`, so
the app always receives the matching account's signing secret in the same import. A fresh 32-byte `CARD_FINGERPRINT_SECRET` is generated
with `openssl rand -hex 32` only when the app does not have one. The script's `STRIPE_WEBHOOK_SECRET` lands in
`/tmp/stripe-setup.env` (mode `0600`), which an `always()` step deletes; the workflow finishes by polling
`https://tryoverture.com/api/health`. The step summary records the configured `stripe_env` and the variable names
written to the app, never their values.

| Plan | Product | Price | Lookup key |
|---|---|---|---|
| Week | `Overture Week` | $9.99 USD recurring weekly (50 applications over 7 days) | `overture_week_usd` |
| Month | `Overture Month` | $29.99 USD recurring monthly (250 applications over 30 days) | `overture_month_usd` |

Both products are created with `tax_code=txcd_10103000` (SaaS, personal use), the tax code Stripe Tax uses to calculate
the tax on each charge. No Managed Payments parameter is set: Checkout is a standard `mode=subscription` session and
the products, prices, webhook and portal configuration are the plain Stripe Billing objects.

The webhook endpoint is `https://tryoverture.com/webhooks/stripe` and subscribes to the nine events
`src/server/billing/webhooks.ts` handles: `checkout.session.completed` and `checkout.session.async_payment_succeeded`,
`customer.created`, `customer.updated`, `invoice.paid`, `invoice.payment_failed`, and `customer.subscription.created`,
`customer.subscription.updated` and `customer.subscription.deleted`. Each delivery is verified against
`Stripe-Signature` and claimed once in `stripe_events`, so a retry is a no-op. Refunds are not a webhook: the admin
refund asks Stripe for the refund first, then records the refunded grant, its ledger row and its audit entry in one
local transaction; a crash between those two steps leaves a Stripe refund with no local record, which the daily
reconciliation reports as `refund_without_ledger` rather than losing silently. Because the reconciliation compares
Stripe's invoices and refunds with the ledger, a `charge.refunded` delivery would add no state and the endpoint does
not subscribe to it. The billing portal configuration cancels at period end, updates payment
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

## Launch: freehire API plan, live Stripe and public sign-up (owner runbook, issue #708)

The launch code ships before the owner steps, so `main` keeps deploying while the plan, live Stripe and the public
switch are still pending (`Part of #708`; the owner steps close it). `FREEHIRE_API_KEY` is optional in
`src/server/config/env.ts`: unset or empty keeps the free plan, a value sends `Authorization: Bearer …` on every
freehire search and change-feed request. No test, CI job or scheduled job calls freehire with the key.

### 1. Wait for #710, then buy the freehire API plan

- Owner: finish the #710 live walk with three users first. The plan is bought only after it passes (owner,
  2026-11-26).
- Buy the $29/month API plan from freehire and copy the key once. The price rises to $39/month after 2026-12-01, so
  buying before then avoids the increase.
- Store it as a repository secret (never in the repo, a log or the step summary):

```sh
gh secret set FREEHIRE_API_KEY -b <key-from-freehire> -R a-hagi613/overture
```

### 2. Sync the key, then turn the deploy gate on

```sh
gh workflow run ops-live.yml -f action=sync-ops-secrets -R a-hagi613/overture
gh variable set REQUIRE_FREEHIRE_API_KEY -b true -R a-hagi613/overture
```

`sync-ops-secrets` masks `FREEHIRE_API_KEY`, imports it in the same single `flyctl secrets import -a overture-web`
call as the other ops secrets, lists only the name in the step summary, and finishes by polling the health route. An
unset repository secret is skipped, so a sync before the purchase never clears a value on the app.

`REQUIRE_FREEHIRE_API_KEY=true` makes the **Deploy** secret gate refuse any release whose Fly secret list lacks
`FREEHIRE_API_KEY` (step 5 above, `.github/workflows/deploy.yml`). Leave the variable unset until step 1 is done: the
gate then does not name the key, so deploys stay green on the free plan. The deploy job runs on every CI success and
only reads the secret names from `flyctl secrets list`; it never receives the key, and the key reaches Fly only
through the manual sync.

Verify names only (values are never printed):

```sh
gh workflow run ops-live.yml -f action=check-secrets -R a-hagi613/overture
```

`FREEHIRE_API_KEY` must appear in the list, and `/api/health` must answer. If a later freehire call returns 401 or 403,
the key is wrong or expired; set it again and re-run the sync.

### 3. Live-mode Stripe checklist (from the old #254 list)

Run the setup against the Production account and confirm each object in the Stripe dashboard:

```sh
gh workflow run ops-live.yml -f action=setup-stripe -f stripe_env=production -R a-hagi613/overture
```

- **Products and prices:** `Overture Week` at $9.99 USD recurring weekly (lookup key `overture_week_usd`) and
  `Overture Month` at $29.99 USD recurring monthly (`overture_month_usd`), both with tax code `txcd_10103000` (SaaS,
  personal use). A drifted price is replaced with `-f reconcile_prices=true`, never guessed.
- **Webhook:** one endpoint `https://tryoverture.com/webhooks/stripe` subscribed to the nine events in
  `src/server/billing/webhooks.ts`; `STRIPE_WEBHOOK_SECRET` is set on the app in the same run. A sandbox ↔ production
  switch rotates it automatically.
- **Billing portal:** cancels at period end, updates payment methods, shows invoices, switches Week ↔ Month with no
  proration, returns to `https://tryoverture.com/profile/billing` and links the privacy and terms pages.
- **Tax settings (dashboard, owner only):** turn on Stripe Tax in the Production account and add the registrations
  for the places you sell to. The repo sets each product's tax code and does not send an automatic-tax parameter, so
  confirm the tax line on a sandbox Checkout before the live keys go on. Overture is the seller; Stripe is the
  processor (ADR 0031).
- **Keys:** `check-secrets` must list `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_WEEK`,
  `STRIPE_PRICE_MONTH` and `CARD_FINGERPRINT_SECRET`; a half-set pair stops the server at boot by design.
- **No real charges for testing:** use test cards and `stripe_env=sandbox` for every rehearsal. Nothing in CI or a
  scheduled job ever charges a card.

### 4. Turn public sign-up on

The flag is `PUBLIC_SIGNUP_ENABLED` (`src/server/config/env.ts`; default `true`). `fly.toml` sets it to `"false"` on
purpose today, and this launch keeps it there until the owner's cutover.

- **Preferred:** a one-line launch PR flips `fly.toml` to `PUBLIC_SIGNUP_ENABLED = "true"`. The repo then shows what
  runs, and the next Deploy ships it.
- **Immediate alternative, no code change:** `fly secrets set -a overture-web PUBLIC_SIGNUP_ENABLED=true`. The secret
  overrides `[env]` on the next machine restart, but it hides the switch from `fly.toml`, so a reader of the repo would
  think sign-up is still closed.

Either way, confirm with `gh workflow run ops-live.yml -f action=live-diagnostics -R a-hagi613/overture`: the step
prints `PUBLIC_SIGNUP_ENABLED=true` along with the other non-secret flags. The landing is already live on the marketing
Worker (`https://tryoverture.com/`); a signed-in visitor still gets the app at `/home`.

Only do this after step 3: with billing configured and public sign-up on, preparation, scoring and sending stay
gated for accounts with no Applications left (fail-closed), and Turnstile plus the per-IP rate limits are what protect
the free trial. `ALLOWED_SIGNUP_EMAILS` is only the M2 tester allowlist; it can be unset once anyone may sign up:

```sh
fly secrets unset -a overture-web ALLOWED_SIGNUP_EMAILS
```

### 5. Post-launch watch: first 20 paying users, 30 days of reconciliation

- **Acceptance walk:** a fresh public user signs up, gets freehire matches through the paid key, uses the 3-application
  trial and sees the Tracker. Record it in the launch note on #708.
- **First hour after the cutover:** watch `/api/health`, the admin Users page (`/admin/users`) for sign-up volume and
  Turnstile challenges, and the job list (`/admin/jobs`) for failed preparation. If sign-ups are abusive or error
  rates jump, unset `PUBLIC_SIGNUP_ENABLED` (or revert the `fly.toml` PR): the machine restarts onto the invite-only
  gate in minutes.
- **First 20 paying users:** for each, check the Stripe payment, the grant and ledger row, and that the Tracker shows
  the plan's Applications. The admin billing pages are `/admin/billing` and `/admin/billing/reconciliation`.
- **30-day Stripe-to-ledger gate (old #255):** the `billing.reconcile` job runs ten minutes after UTC midnight and
  records `clean` or the mismatch kinds (`invoice_without_grant`, `grant_without_invoice`, `refund_without_ledger`,
  `ledger_without_refund`, `refund_ledger_missing`). A day that is not `clean` raises the `billing.mismatch` alert.
  Launch close-out needs **30 clean days** after the first 20 paying users; a mismatch is investigated, never
  dismissed.
- **freehire spend:** the key is only spent by real user pulls (paid users every 3 hours, the trial on demand); watch
  the plan's usage in the freehire dashboard for the first days.
- **Roll back:** `fly secrets unset -a overture-web FREEHIRE_API_KEY` returns to the free plan; `gh variable unset
  REQUIRE_FREEHIRE_API_KEY -R a-hagi613/overture` stops the deploy gate naming the key. For sign-up, unset the secret
  (or revert the `fly.toml` PR) and restart the machine; `PUBLIC_SIGNUP_ENABLED=false` restores the invite-only gate.

## Signup allowlist for regular testers (optional, owner runbook)

`sync-ops-secrets` also pushes the optional regular-testers allowlist from a repository secret to `overture-web`:

```sh
gh secret set ALLOWED_SIGNUP_EMAILS -R a-hagi613/overture
gh workflow run ops-live.yml -f action=sync-ops-secrets -R a-hagi613/overture
```

When the repository secret is set, the action masks it, adds `ALLOWED_SIGNUP_EMAILS=…` to the same single
`flyctl secrets import -a overture-web` call as the other ops secrets, and lists only the variable name in the step
summary. An unset secret is skipped, so a run never clears a value already on the app; remove it deliberately with
`flyctl secrets unset -a overture-web ALLOWED_SIGNUP_EMAILS`. A run with nothing to import fails with
`No secrets or flags were configured to sync.` The action still finishes by polling the health route.

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
`flyctl` runs that command directly rather than through a shell, so `&&` chaining does not work (wrap multi-step work
in `sh -c '…'` instead; see the marketing sync above). Each call runs under its own `timeout` and stops the action on
a timeout (exit 124) or a non-zero exit:

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

## Better Auth secret rotation (issue #578)

Better Auth signs and encrypts sessions with `BETTER_AUTH_SECRET`. Rotating it with a single secret would sign out
every session and strand any payload still encrypted with the old value. `BETTER_AUTH_SECRETS` instead lists the
secrets by version, current first, and Better Auth reads every version while writing new values under the first:

```sh
openssl rand -base64 32                       # the new secret, never copy it into the repo or a log
fly secrets set -a overture-web \
  BETTER_AUTH_SECRETS="2:<new>,1:<old>" \
  BETTER_AUTH_SECRET=<old>
```

The order matters: the first entry is the current signing/encryption key, every later entry is decryption-only.
Keeping the old `BETTER_AUTH_SECRET` alongside it is the backward-compatible fallback for bare-hex payloads written
before versioned secrets existed. The process starts with either form, so this is safe on its own:

```sh
fly secrets set -a overture-web BETTER_AUTH_SECRETS="2:<new>,1:<old>"
```

Then:

1. **Deploy or restart** and confirm a fresh sign-in works on the public host and an existing session still opens
   (no sign-out wave). Check `/api/health`.
2. **Keep version 1 for at least the session lifetime** (`session.expiresIn` is 30 days). New sessions are written
   under version 2 immediately, so every old token either refreshes or expires during this window. Pending invites
   hashed with the old secret also continue to open because invites are looked up against every accepted secret.
3. **Retire the old version** only after that window: set `BETTER_AUTH_SECRETS="2:<new>"` and unset
   `BETTER_AUTH_SECRET`. This is the only step that would sign out a session that never refreshed; if you need to
   roll back before it, restore both values exactly as they were.
4. **Verify** one fresh sign-in and one old-session refresh after retirement, then remove the archived old value from
   your own secret store only when no backup or pending invite can still need it.

There is no database migration in this rotation: sessions keep living in the `sessions` table, and only the envelope
header of their stored tokens changes. The same runbook repeats with `3:<newest>,2:<previous>`.

## Master-key rotation (owner runbook, issue #541)

Rotating the master key re-wraps every person's data key under a new `MASTER_KEY_V<n>`; it never re-encrypts
their facts, mail or resumes, because those are sealed with the per-person data key, which does not change.
The routine is a background job (`maintenance.master-key-rotation`) with a `--dry-run` that only counts. It
also re-seals a queued deleted-account notice under the current key, so retiring an old key cannot strand the
erased person's confirmation. The full order matters: deploy the release that accepts the chain, add the new
secret with the raised version, dry run, run the job, verify, then remove the old secret. Decisions are in
ADR 0039.

1. **Deploy the release that carries the rotation first** and confirm `https://tryoverture.com/api/health` is
   green. The release is safe with `MASTER_KEY_CURRENT=1`; the important part is that the running code already
   accepts the version chain before the secret below restarts the machines. (If you prefer the add-then-deploy
   order, stage the secrets with `fly secrets set --stage …` and let the deploy apply them.)

2. **Generate the new key and raise the current version in one secret update**:

   ```sh
   openssl rand -base64 32                       # MASTER_KEY_V2, never copy it into the repo or a log
   fly secrets set -a overture-web MASTER_KEY_V2=<the value> MASTER_KEY_CURRENT=2
   ```

   Set both: with `MASTER_KEY_CURRENT=2` the restart needs `MASTER_KEY_V1` and `MASTER_KEY_V2` (the boot
   check names any missing version), new data keys are wrapped under V2, and reads keep working because the
   app still holds V1 for rows wrapped under it. Setting the new key without raising the version is refused by
   the rotation script rather than silently re-wrapping nothing. `fly secrets list -a overture-web` shows both
   names.

3. **Dry run** — counts the rows that would be re-wrapped, writes nothing, and is safe while the app serves:

   ```sh
   fly ssh console -a overture-web -C "bun run /app/scripts/rotate-master-key.ts --db /data/app.sqlite --dry-run"
   ```

   The JSON prints `{"dryRun": true, "remaining": <rows>, "notices": <n>, "rotated": 0, ...}`. A fresh
   deployment with no accounts reports zero. `notices` counts queued or failed deleted-account notices still
   sealed under an older key; the live run re-seals them, because a notice holds the erased person's name and
   address directly under the master key and must not be stranded by retiring the key it used.

4. **Run the job**. Queue it from the machine; the running app's job worker takes it in bounded batches of
   250 rows, each commit in one immediate transaction, and queues its own next run while rows remain:

   ```sh
   fly ssh console -a overture-web -C "bun run /app/scripts/rotate-master-key.ts --db /data/app.sqlite --enqueue"
   ```

   It prints the `bg_jobs` id and `inserted`. Watch it on `/admin/jobs` (kind `maintenance.master-key-rotation`)
   or in the logs (`master_key.rotation`); each batch writes `master_key.rotate` to `admin_audit` and the last
   run writes `master_key.rotate.summary`. To run it inline instead (for example on a stopped copy), drop
   `--enqueue`; it re-wraps until nothing is left and prints the summary. Both paths resume after a crash,
   because the next run selects only rows still below the current version.

5. **Verify** the job is finished with a second dry run; it must report `remaining: 0` and `notices: 0`. Reads
   keep working throughout because the app tries the row's version, then `MASTER_KEY_CURRENT`, then every
   older key.

6. **Check the app** on `/api/health` and open one page that shows a resume and a fact. While `MASTER_KEY_V1`
   stays configured you can roll back with `fly secrets set -a overture-web MASTER_KEY_CURRENT=1`; rows already
   re-wrapped under V2 keep opening, and new keys wrap under V1 again. Do not leave it there: run the job
   again before removing V1.

7. **Remove the old secret from the live process only after the retention guard passes**:

   ```sh
   fly secrets unset -a overture-web MASTER_KEY_V1
   ```

   The restart verifies that no `user_keys` row still needs V1. If one does, the process refuses to start
   instead of serving unreadable values; re-set `MASTER_KEY_V1`, run the job again, and repeat. Before unsetting,
   confirm `user_keys` has **0** rows on V1 (step 5's dry run) and keep the V1 value **archived offline** for at
   least `litestream.yml`'s `snapshot.retention` (**720h / 30 days**) after the last row moves. The app logs a
   `master_key.retirement` warning naming any configured key that wraps no row; that warning is the reminder, not
   permission to destroy the value. Backups from before the rotation only open with the old key, so do not destroy
   the archive until a post-rotation Litestream snapshot **and a restore drill** pass. Keep the value in your own
   secret store (never in the repo) for as long as those backups are retained.

The next rotation repeats the same steps with `MASTER_KEY_V3` and `MASTER_KEY_CURRENT=3`; the chain then starts
at V2, because V1 has been retired.

## Admin host: `admin.tryoverture.com` (owner runbook)

The Admin Portal is the same process as the app, selected by the `Host` header: a request to
`admin.tryoverture.com/admin/api/*` reaches the admin API, and any other host gets the normal app. In production the
admin host sits behind a Cloudflare Zero Trust Access application with a policy for the owner's email only, and the
app trusts only a verified Access identity for `OWNER_EMAIL`; there is no second sign-in and no passkey. The values
are already in `src/server/config/env.ts`; this section provisions what the deployment needs around them.

There are two ways in:

1. **From the app, the normal route.** Sign in at `https://tryoverture.com` with the owner account, open the
   **Profile** menu and choose **Admin Portal**. The same link is on `/profile/account`. It opens
   `https://admin.tryoverture.com/admin` in a new tab. Regular users, the demo account and anonymous visitors never
   see it, because `GET /api/me` returns `adminOrigin: null` for them (#512).
2. **Straight to the admin host.** Go to `https://admin.tryoverture.com/admin`; a bare
   `https://admin.tryoverture.com/` redirects there. Cloudflare Access asks for the owner's identity first and the
   app then opens `/admin` directly: there is no magic-link step and no passkey step, and `/signin` redirects to
   `/admin` for the verified owner.

Only the owner account enters. A test or demo account cannot enter by design: the Access policy names the owner's
email, and any other verified identity gets `403 owner_required` (the plain page naming the owner account for a
browser navigation). A missing or invalid Access credential fails closed with `401 access_required` on the admin API.
The admin host still serves its own `/api/me` and auth routes, but the owner session comes from Access; magic links
remain available for the main app. Social sign-in buttons are hidden on the admin host because the Google and
LinkedIn clients register the `tryoverture.com` callback only. The Turnstile widget must allow both hosts;
`TURNSTILE_HOSTNAMES` defaults to the `APP_ORIGIN` and `ADMIN_ORIGIN` hostnames when it is unset.

### 1. Add the Fly certificate from the workflow

The box's Fly token cannot see `overture-web`, and no Cloudflare API token is stored in this repository, so this section
does not run on the box. The repository's `FLY_API_TOKEN` secret can see the app, so the **Ops admin host** workflow
(`.github/workflows/ops-admin-host.yml`) does the Fly half:

**Actions → Ops admin host → Run workflow → `action: add-cert`**.

The job adds `admin.tryoverture.com` to `overture-web` when it is not there yet (it prints that and continues when it
is), then prints the certificate table with the validation DNS target, the Fly secret **names** (never values) and the
app status. Run `action: status` at any time for the same read-only report; it changes nothing.

### 2. Add the Cloudflare DNS record

In the `tryoverture.com` zone add:

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `admin` | `overture-web.fly.dev` | Proxied |

Keep the `admin` record **proxied** (orange cloud), because Cloudflare Access can only gate proxied traffic. If
`action: status` prints a `DNSValidationTarget` / `DNSValidationInstructions`, follow it exactly: add the record it
names, and keep a validation record such as `_acme-challenge.admin` **DNS-only** until the certificate is issued (a
proxied challenge can fail). Re-run `action: status` until `admin.tryoverture.com` shows `Ready`.

### 3. Create the Access application and push its values

In **Zero Trust → Access → Applications**, add a self-hosted application for `admin.tryoverture.com` and a single
`Allow` policy whose `Include` rule is `Emails` with the owner's address. Set the session duration to the working day
(for example 12 hours). Copy the application's **Application Audience (AUD) Tag** and note the team domain
(`<team>.cloudflareaccess.com`); the JWKS endpoint is
`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`.

Save the values as repository secrets, never in this repository:

```sh
gh secret set CF_ACCESS_AUD -R a-hagi613/overture
gh secret set CF_ACCESS_TEAM_DOMAIN -R a-hagi613/overture
```

`CF_ACCESS_JWKS_URL` can override the certs URL when you prefer to pin the full
`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` URL, but production still needs
`CF_ACCESS_TEAM_DOMAIN` with `CF_ACCESS_AUD`: it is the only value that names the issuer whose `iss` claim is
verified, so a JWKS URL alone stops the server at boot.

Then run **Actions → Ops admin host → Run workflow → `action: set-access-secrets`**. It refuses unless
`CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` are repository secrets, masks every value with `::add-mask::`, sets
`ADMIN_ORIGIN=https://admin.tryoverture.com`, `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` on `overture-web` with
`flyctl secrets set`, and confirms with `flyctl secrets list` **names only**. `CF_ACCESS_JWKS_URL` is optional and only
overrides the certs URL; when both are set it must name the same team.

Cloudflare Access gates the host before the app's owner check: without an Access assertion the admin API answers
`401 access_required`, so never point DNS at the app without the Access application in place.

### 4. Verify the whole path

The check script is read-only and idempotent. It resolves DNS, probes `https://<origin>/admin/api/session` over HTTPS
and classifies the answer (a Cloudflare Access sign-in redirect or `401 access_required` passes; a `200 text/html` app
shell is the SPA bug), then reads the Fly certificate and secret **names** with `flyctl`. Run it from a terminal whose
`flyctl` can see `overture-web` (the box's token cannot; `--no-fly` skips the two Fly reads). It never reads or prints a
secret value.

```sh
bun run scripts/check-admin-host.ts
bun run scripts/check-admin-host.ts --json
bun run scripts/check-admin-host.ts --origin https://admin.example.test --fly-app another-app
```

Exit `0` means every check passed; exit `1` prints the gaps. Use `--no-fly` to skip the two Fly reads when `flyctl` is
unavailable, `--host` to name the DNS record when it differs from the origin's hostname, `--origin` to check another
admin origin (it must be `https`), and `--fly-app` to read the certificate and secret names from another Fly app.
Paste the full result on the issue or pull request. The matching unit tests run with
`bun test scripts/check-admin-host.test.ts`.

Finally sign in as the owner, open `/profile/account` and confirm the **Admin Portal** card, then open `/admin` on
`tryoverture.com` and confirm the handoff card opens `https://admin.tryoverture.com/admin` through Access with no
second sign-in. Open `https://admin.tryoverture.com/` on its own and confirm it lands on `/admin` rather than the
public landing page.

### Rollback

The workflow only adds and reports; removal stays with an authenticated operator. Taking the admin host out of service
is a DNS change **first**; the Access values stay on the shared app because production now refuses to boot without
them:

```sh
flyctl certs remove admin.tryoverture.com -a overture-web
```

Then delete the `admin` CNAME and any `_acme-challenge` validation record in the Cloudflare DNS zone, and delete the
Access application. Deleting the DNS record takes the host offline; deleting only the certificate breaks HTTPS. The app
still refuses requests without an Access assertion (`401 access_required`), but do not leave the host public.

Do not `flyctl secrets unset CF_ACCESS_AUD CF_ACCESS_TEAM_DOMAIN` on the current release: that restart stops the app
for the public host too. Remove those secrets only after deploying a release that no longer requires them (or rolling
back to a release from before the fail-closed change), and delete the repository secrets at the same time:

```sh
# only after a release whose env check does not require the Access values is deployed
flyctl secrets unset CF_ACCESS_AUD CF_ACCESS_TEAM_DOMAIN CF_ACCESS_JWKS_URL -a overture-web
gh secret delete CF_ACCESS_AUD -R a-hagi613/overture
gh secret delete CF_ACCESS_TEAM_DOMAIN -R a-hagi613/overture
```

## After a deploy

Once the **Deploy** workflow on `main` is green, check the public surface with the read-only harness
(plain HTTPS, no Fly or Cloudflare credential, exit `1` on any `FAIL`):

```sh
bun run scripts/check-production.ts
bun run scripts/check-production.ts --json
```

It checks the landing pricing copy, `/api/health`, `/signin`, the security headers, `/sw` caching,
a missing `/assets/*.js`, the unauthenticated API guards and webhook, the SPA navigation paths, and
`admin.tryoverture.com` DNS/Access. Cloudflare rewrites `Cache-Control` to `max-age=14400` for static `.js`
files, so the service worker is registered and checked at the extensionless `/sw`; the legacy `/sw.js` is a
reported `SKIP`. The check list, the Wave 5 admin-host provisioning steps and a
recorded run are in `docs/research/production-verification-2026-11-23.md`.

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

Two clocks bound a deploy. Fly sends `SIGTERM` (`kill_signal = "SIGTERM"`) and stops a machine after
`kill_timeout = 300`, but the container's main process is Litestream, so its `replicate -exec` wrapper also owns a
clock. `litestream.yml` sets `shutdown-timeout: 280s`: Litestream forwards the signal to the Bun server, waits for it
to exit, and only then bounds its final WAL sync and close inside what remains of that 280 s. The server's own
graceful budget (`KILL_TIMEOUT_MS`, default 240 s) fits inside it, leaving Fly roughly 60 s of its 300 s window for
Litestream to flush the final WAL to R2 and exit 0.

On `SIGINT`/`SIGTERM` (`fly logs` shows the three lines in order):

1. `overture shutdown: SIGINT: draining with a 240000 ms budget`
2. stop claiming new queue jobs at once (the worker's claim loop checks the shutdown signal), stop backups, and end
   every open `/api/events` stream through the same signal; stop accepting, give in-flight requests
   `SHUTDOWN_QUIET_GRACE_MS` (2 s), then force the long-lived ones shut;
3. drain in-flight jobs with the budget minus a 10 s flush reserve, then requeue whatever is still running
   (`interrupted` / lease expiry recovers the rest). An active browser send is *not* aborted by the signal: its
   browser stays open until the drain budget runs out, so a 60–180 s submission can finish, commit its ledger state
   and be marked `done` before exit. A send waiting for a pasted or mailed verification code stops immediately
   instead of spending the budget: the signal ends that wait because the shutdown also stops the paste route and new
   `mail.ingest` claims, so the code cannot arrive; that attempt is released as `interrupted` and does not use one of
   its two tries. Only at the end of the budget does the last-resort abort close the browser, and the shutdown waits
   for the handler to record the interruption (attempt outcome, credit release and next slot) before it closes the
   databases;
4. flush OTel, close `app.sqlite` and `catalog.sqlite`, then `overture shutdown: stopped in <ms>` and exit 0, with a
   SIGKILL backstop one second past the budget. A SIGKILL or exit 1 here means Litestream killed the child: the
   budget and the Litestream deadline have drifted apart again.

A restart also starts the job worker with a settle window (`JOBS_STARTUP_SETTLE_MS`, 5 s). Without it the startup
enqueues (catalog sweep, check-ins, grant expiry, retention, prep) woke the worker in the same second the port opened,
so the new machine's first health checks competed with a full batch of jobs. Queued work is not lost; it starts a few
seconds later.

### SQLite checkpoints belong to Litestream

When the container runs Litestream, `scripts/docker-entrypoint.sh` exports `LITESTREAM_OWNS_CHECKPOINTS=true` on that
one path, and `app.sqlite` opens with `PRAGMA wal_autocheckpoint = 0`: a writer's own commit never runs a checkpoint
and never blocks on one while the machine serves. Running `main.ts` directly (`bun run dev`, `bun run start`, or the
image with `LITESTREAM_ENABLED=false`) leaves SQLite's automatic checkpoint on, because no process would replace it.
Litestream owns checkpointing for the replicated file and does it on its own
schedule in v0.5.18: a PASSIVE checkpoint every minute (`checkpoint-interval`), one when the WAL passes ~1000 pages
(~4 MB, `min-checkpoint-page-count`), and a blocking TRUNCATE backstop at ~121k pages (~500 MB) that stops unbounded
WAL growth even if a reader lingers. The app's `journal_size_limit = 64 MB` then caps the WAL file when SQLite
resets the log at a checkpoint, so `app.sqlite-wal` stays bounded under bursty writes. `catalog.sqlite` is not
replicated and keeps SQLite's automatic checkpoint (1000 pages), because no Litestream process watches that file.

The one gap to know about: Litestream only checkpoints after a sync succeeds, so while R2 is unreachable the WAL keeps
growing on the volume until replication recovers, because SQLite no longer checkpoints on its own. That is the
deliberate trade for never blocking a user write on a checkpoint; the volume's free-space alert and the storage report
surface it, and a failing replica is already an alertable incident. If a long R2 outage ever needs a manual recovery,
stop the machine, checkpoint the file offline (`scripts/vacuum-app-db.ts --dry-run` prints the sizes first), and
restart it.


`/api/health` runs `select 1` and serves the cached replica reading, so it is a main-thread operation: if health checks
fail while the process is alive and `fly logs` shows no application line, the event loop was blocked. The server logs
that directly now — `overture event-loop-lag: Error: the event loop was blocked for <n> ms` — measured on a 1 s timer,
so the next incident has a duration instead of a gap in the log.

## Operator scripts against the live database

Operator scripts run against the same `/data/app.sqlite` the server is using, so every one that writes does it in
small batches: at most 500 rows per transaction, with the event loop yielded between batches. A long single
transaction would hold the write lock past the app's `busy_timeout` (5 s); the server would then log `SQLITE_BUSY`,
retry the claim or poll, and keep serving reads, but the batch would still have stalled writes for seconds.

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
after that at the next UTC midnight. The nightly run covers the checks that spend nothing: `mail`, `r2` and `alerts`.
The `forms` check (a real Browser Use session per ATS) and the `llm` check (four Haiku calls) spend real money, so
they are manual-only (#680) and never run on the schedule.

Run the nightly set on demand from the owner's terminal with the admin API, using the Cloudflare Access cookie and the
owner's session:
`curl -X POST https://admin.tryoverture.com/admin/api/live-checks/run`, then
`curl https://admin.tryoverture.com/admin/api/live-checks` for the recorded pass/fail and timing per check. The same
rows are in the `live_check_results` table.

Run the spending groups by hand only when you want them, naming every group you want:

```sh
curl -X POST https://admin.tryoverture.com/admin/api/live-checks \
  -H 'content-type: application/json' \
  --data '{"groups": ["forms", "llm"]}'
```

Omitting `groups` runs the nightly set, so the button on the admin System page and the bare `curl` can never open a
Browser Use session. The forms check captures one open posting per ATS from the catalog and never fills or submits. The mail group first
runs the `mail.sending` guard: gated with `status: "gated"` until `REQUIRE_EMAIL_SENDING` is on, then it verifies
`tryoverture.com` and its bounce MX, SPF, DKIM and DMARC records and fails with the owner's alert path when one is
missing. When it passes, the mail check sends to the reserved `live-check@tryoverture.com` (which maps to no user; it
is never the owner's address), and the follow-up `live.check.mail` job records whether it came back through Email
Routing and the Worker with `auth='pass'` and the matching code within `live_checks.mail_wait_minutes` (default 5, a
Settings value). Failures raise `alert.raised`, create an owner notification, and push to the phone when
`ALERT_NTFY_URL` is set as a Fly secret.

Observability has two paths. Logs, traces and OTLP metrics still go to the owner's Grafana Cloud account when
`OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` are set. Separately, Fly's built-in Grafana
(`fly-metrics.net`) scrapes the app's private Prometheus listener: with `METRICS_ENABLED=true` (set in `fly.toml`) the
app serves `GET /metrics` on IPv6 `::` port `9091`, declared by `[metrics]` in `fly.toml` and never mounted on the
public `:3000` app. The committed dashboard `docs/ops/grafana/overture-prod-dashboard.json` imports as
"Overture production" and organizes all six rows (Runtime & Catalog, API Latency, Apply & ATS Health, LLM & Tagging,
Queue/Mail/Billing, Fly System Resources). Select the Prometheus datasource that scrapes `:9091`; the last row uses
Fly's own `fly_instance_*` series.

`/api/health` stays public and deliberately minimal. The richer answer lives at the HMAC-authenticated
`GET /internal/ops/health`: set `OPS_HEALTH_SECRET` as a Fly secret, and the sentinel Worker polls it when
`OVERTURE_OPS_HEALTH_SECRET` is set, paging on RAM above 80 %, NVMe above 75 %, event-loop lag p95 above 500 ms or an
ATS failure spike. The sentinel sends `x-overture-ops-timestamp` and `x-overture-ops-signature` (HMAC-SHA256 over
`METHOD\npath\ntimestamp`); a missing, expired or wrong signature fails closed.

## The sentinel Worker (#283)

`workers/sentinel` is a cron Worker that watches Overture from outside Fly (ADR 0033). Every ten minutes it probes
`https://tryoverture.com/api/health`, and reads month-to-date R2, Queues and Workers usage from the Cloudflare
GraphQL Analytics API. It pushes to
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
