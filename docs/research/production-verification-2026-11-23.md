# Production verification after a deploy (Wave 5)

A repeatable, read-only check that `https://tryoverture.com` is up and behaving, plus the exact
runbook for bringing up `admin.tryoverture.com`. Everything here is plain HTTPS `GET`/`POST` to
public endpoints and `node:dns`: it needs no Fly or Cloudflare credential, writes nothing, sends no
email, and never signs in. It works from any machine that can reach the public origin.

- Harness: `scripts/check-production.ts` (Bun + `node:dns`, no dependencies)
- Tests: `scripts/check-production.test.ts` (`bun test scripts/check-production.test.ts`, no network)
- Admin host check: `scripts/check-admin-host.ts` (the existing Fly/Cloudflare-aware check)

## Run it after every deploy

Wait for the **Deploy** workflow on `main` to finish green, then:

```sh
bun run scripts/check-production.ts
```

It prints one line per check as `PASS`, `FAIL` or `SKIP` with the measured time and a detail, then a
count line. Exit code is `0` when nothing failed and `1` on any `FAIL`; a `SKIP` never fails the run.
Every request is bounded to 10 s and made once: there are no retries.

Machine-readable output, for a script or a release note:

```sh
bun run scripts/check-production.ts --json
```

Other origins and flags (admin host separately, help):

```sh
bun run scripts/check-production.ts --origin https://staging.example.test --json
bun run scripts/check-production.ts --admin-origin https://admin.example.test
bun run scripts/check-production.ts --help
```

What it checks:

| Check | Expected |
|---|---|
| `landing` | `/` is 200 HTML and carries the approved pricing copy (`Pay only for applications`, `$9.99`, `$29.99`) |
| `health` | `/api/health` is 200 JSON with `status: "ok"` and `database: "ok"` |
| `signin` | `/signin` is 200 |
| `headers.*` | `/` carries CSP (`default-src`), `nosniff`, `referrer-policy`, HSTS (production) and `x-frame-options` |
| `sw.cache` | `/sw.js` is 200 with `cache-control: no-cache` |
| `assets.404` | a definitely-missing `/assets/*.js` answers 404, not 200 HTML (known gap → `SKIP`) |
| `api.stripe-webhook` | `POST /webhooks/stripe` with no signature is 400/401, never 404 |
| `api.events` | `GET /api/events` with no session is 401 |
| `api.me` | `GET /api/me` with no session is 401, or the anonymous 200 with `user: null` |
| `api.billing-checkout` | `POST /api/billing/checkout` with a valid body and no session is 401 |
| `nav.*` | `/settings/billing`, `/pricing`, `/search`, `/inbox/address` all answer 200 HTML (the app shell) |
| `admin.dns` | `admin.tryoverture.com` resolves, or `SKIP` with the next step |
| `admin.https` | `GET https://admin.tryoverture.com/admin/api/session` is 401/403 or an Access sign-in redirect, never 200 |

Two contracts the panel encodes from the running app, not from older prose:

- `GET /api/me` answers `200` with `user: null` to an anonymous visitor (#512). The harness accepts
  that or a `401`; either proves the guard ran and no identity leaked.
- `POST /api/billing/checkout` validates its body before the session guard, so the harness sends a
  valid body (`{"plan":"week"}`); with an empty body the answer is `400`, not `401`.

## One real run: the `660afbe3` deploy

Run on 2026-11-23 from the devbox against `https://tryoverture.com`, with no Fly or Cloudflare
credential. The deployed release was `main` at `660afbe3` ("Clear the client cache on sign-out…",
#536). Times are that run's and will vary by a few tens of ms.

| Result | Check | ms | Detail |
|---|---|---:|---|
| PASS | landing | 91 | 200 with the approved pricing copy |
| PASS | health | 38 | 200 ok (database ok) with backups, database, status |
| PASS | signin | 33 | 200 text/html; charset=utf-8 |
| PASS | headers.content-security-policy | 91 | CSP with default-src |
| PASS | headers.content-type-options | 91 | nosniff |
| PASS | headers.referrer-policy | 91 | Referrer-Policy set |
| PASS | headers.frame-options | 91 | X-Frame-Options set |
| PASS | headers.hsts | 91 | HSTS max-age=15552000 |
| **FAIL** | sw.cache | 53 | `/sw.js` carries `cache-control: max-age=14400` instead of `no-cache` |
| SKIP | assets.404 | 21 | the SPA fallback still answers a missing asset with 200 text/html |
| PASS | api.stripe-webhook | 36 | 400 for a request with no signature |
| PASS | api.events | 35 | 401 without a session |
| PASS | api.me | 21 | answers 200 with `user: null`, the anonymous payload |
| PASS | api.billing-checkout | 20 | 401 without a session for a valid body |
| PASS | nav.settings.billing | 19 | 200 text/html, the app shell |
| PASS | nav.pricing | 188 | 200 text/html, the app shell |
| PASS | nav.search | 186 | 200 text/html, the app shell |
| PASS | nav.inbox.address | 185 | 200 text/html, the app shell |
| SKIP | admin.dns | 52 | `admin.tryoverture.com` does not resolve (`getaddrinfo ENOTFOUND`) |
| SKIP | admin.https | 0 | skipped because the admin host does not resolve |

Totals: **16 passed, 1 failed, 3 skipped**, exit `1`.

The three non-passes, each with its reason and next step:

1. **`sw.cache` — FAIL, a real production gap.** `https://overture-web.fly.dev/sw.js` from the Fly
   origin carries no `Cache-Control`, and Cloudflare adds the zone default
   `cache-control: max-age=14400` with `cf-cache-status: HIT`. A service worker pinned at the edge for
   four hours can keep a signed-in client on an old build. Fix it on the Cloudflare side with a Cache
   Rule that bypasses cache for `tryoverture.com/sw.js`, or on the app side by sending
   `Cache-Control: no-cache` for `/sw.js`; then this check should turn `PASS` and the run exit `0`.
2. **`assets.404` — SKIP by design.** A missing `/assets/*.js` is still answered by the SPA fallback
   with `200 text/html` (`staticResponseFrom` in `src/server/app.ts`), the same shape that broke
   service-worker updates before. The 404 fix lands in a later deploy; the check will pass on its own
   once the origin answers 404.
3. **`admin.dns` / `admin.https` — SKIP because the admin host is not provisioned.** Nothing resolves
   for `admin.tryoverture.com`; the Wave 5 steps below are the fix. When it resolves, the HTTPS check
   must see `401`/`403` (or the Cloudflare Access redirect) and must never see `200`.

## Wave 5 admin host: `admin.tryoverture.com`

The admin host is the same process as the app, selected by the `Host` header, gated first by
Cloudflare Zero Trust Access and then by the app's own owner check and passkey window. The box's Fly
token is unauthorized for the prod app and no Cloudflare token is present, so the Fly half runs in the
**Ops admin host** workflow (`.github/workflows/ops-admin-host.yml`, Actions → Ops admin host) with the
repository's `FLY_API_TOKEN`, and the Cloudflare half stays in the dashboard. docs/DEPLOY.md has the
current runbook; the manual commands below remain the fallback from an authenticated operator terminal.

### 1. Cloudflare DNS

In the `tryoverture.com` zone add a proxied (orange cloud) record; Access only gates proxied traffic:

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `admin` | `overture-web.fly.dev` | Proxied |

### 2. Fly certificate

Run the workflow with `action: add-cert`; it is idempotent and prints the certificate table and the
validation DNS target. From an authenticated operator terminal the same steps are:

```sh
flyctl certs add admin.tryoverture.com -a overture-web
flyctl certs show admin.tryoverture.com -a overture-web
```

Keep Fly's validation record in place until the certificate is issued.

### 3. Cloudflare Access application

In **Zero Trust → Access → Applications**, add a self-hosted application for
`admin.tryoverture.com` with one `Allow` policy whose `Include` rule is `Emails` and the owner's
address. Session duration: one working day (12 hours). Copy the **Application Audience (AUD) Tag**
and note the team domain (`<team>.cloudflareaccess.com`).

### 4. Fly secrets (names only, never values in the repo)

Save `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` as repository secrets, then run the workflow with
`action: set-access-secrets`; it refuses while either value is missing, masks the values and confirms
with `flyctl secrets list` names only. The fallback from an authenticated operator terminal is:

```sh
fly secrets set \
  ADMIN_ORIGIN=https://admin.tryoverture.com \
  CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com \
  CF_ACCESS_AUD=<application-aud-tag> \
  -a overture-web
```

`CF_ACCESS_JWKS_URL=https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` is accepted instead of
`CF_ACCESS_TEAM_DOMAIN`. The redeploy that follows the secret change is the one that turns the admin
host on.

### 5. Verify the admin path

From an authenticated Fly terminal:

```sh
bun run scripts/check-admin-host.ts
```

Exit `0` means DNS resolves, `/admin/api/session` redirects to Access or answers `401 access_required`,
Fly holds an issued certificate, and the required secret names are present (`ADMIN_ORIGIN`,
`CF_ACCESS_AUD` and a JWKS source). It reads secret names only.
`--json` gives the machine-readable form, `--no-fly` skips the Fly reads, `--origin`/`--host` point at
another admin host, and `--fly-app` reads another Fly app.

Then, from anywhere, the Wave 5 harness should flip its two admin checks to `PASS`:

```sh
bun run scripts/check-production.ts
```

Finally sign in as the owner, open `/profile/account` and confirm the **Admin Portal** card, then open
`/admin` on `tryoverture.com` and confirm the handoff opens `https://admin.tryoverture.com/admin`
through Access and the passkey.

## What this does not cover

Authenticated flows (sign-in, Ready, Inbox, billing, admin portal), writes, real email delivery, live
Stripe events and the database itself stay with the daily live checks on `overture-web` and the
Playwright end-to-end suite in CI. This harness only proves the public surface is up, guarded and
serving the copy it is supposed to serve.
