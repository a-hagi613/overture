# Security and hardening review (issue #182), 2026-11-21

Scope: `main` at `77ae6fb` (M1 plus the M2 code merged so far: invites, admin, inbound mail, password and email sign-in). Read-only code analysis plus `bun audit`. Nothing was run against production, an ATS or hiring.cafe (ADR 0016). Fly and Cloudflare dashboards were not inspected; those items are marked **needs owner/prod check**.

Method: manual review of auth, admin, inbound mail, crypto, fetchers, config and headers, ranked P1 (fix before the beta wave), P2 (fix in M2), P3 (backlog). The Claude Code `security-review` and `/code-review high` skills were not run as separate passes; this was a single manual pass, so treat the list as high-signal rather than exhaustive.

**Verdict:** no remote-unauthenticated data exposure found. Two P1s (suspension does not end an active session; test routes can ship open to production by a single env var), several P2s that are cheap to close. M2's exit criterion is "no P1 privacy/security finding": close P1-1 and P1-2 first.

## Summary table

| # | Sev | Finding | Where |
|---|---|---|---|
| 1 | P1 | Suspending a user does not revoke or block existing sessions | `src/server/routes/admin.ts:548`, `src/server/auth/index.ts:340` |
| 2 | P1 | `ENABLE_TEST_ROUTES=true` in production exposes an unauthenticated session/user dump and state mutators | `src/server/config/env.ts:24`, `src/server/app.ts:190`, `src/server/routes/test-only.ts:2599` |
| 3 | P2 | Suspension and invite checks are bypassed by Gmail aliases; unverified sign-ups persist | `src/server/auth/invites.ts:61`, `src/server/auth/index.ts:249,298` |
| 4 | P2 | Web-push endpoint is a user-controlled outbound URL (blind SSRF) | `src/server/routes/notifications.ts:16`, `src/server/platform/push/web-push.ts:218` |
| 5 | P2 | No security headers (CSP, frame, nosniff, referrer, HSTS) on the app or admin host | `src/server/app.ts` (none set) |
| 6 | P2 | Admin API ignores the Cloudflare Access identity; session email is never matched | `src/server/routes/admin.ts:149` |
| 7 | P2 | Reveal (ADR 0015) is not built, yet admin routes show user metadata and live browser views | `src/server/routes/admin.ts:440,1043` |
| 8 | P2 | Email pre-registration of an allowed address (account pre-hijack) | `src/server/auth/index.ts:188,298` |
| 9 | P2 | Client IP for auth rate limits and Turnstile trusts `x-forwarded-for` | `src/server/auth/turnstile-gate.ts:43`, `src/server/auth/index.ts:260` |
| 10 | P3 | Inbound DKIM "alignment" is loose and DMARC/SPF are ignored | `src/server/inbox/auth.ts:6,25` |
| 11 | P3 | Sign-in, sign-up and magic link reveal who is on the allowlist | `src/server/auth/index.ts:109,254,377` |
| 12 | P3 | Single master key, no rotation path; DEK wrap has no user binding | `src/server/app.ts:86`, `src/server/platform/crypto.ts:64` |
| 13 | P3 | Inbound body fully buffered before the size check when content-length is absent | `src/server/routes/inbound.ts:75-85` |
| 14 | P3 | `GET /api/password-reset` is unauthenticated, not Turnstile-gated or limited | `src/server/routes/password-reset.ts:12` |
| 15 | P3 | Dependency audit: 3 moderate, all dev/transitive | `bun audit` |
| 16 | P3 | Access verifier builds the issuer from `teamDomain` even when only a JWKS URL is set | `src/server/platform/access/index.ts:67` |

## Findings

### 1. P1: Suspension does not end an existing session
- **Evidence:** `admin.ts:548-595` sets `users.suspended_at` and pauses the profile; it does not delete rows in `sessions`. The only enforcement is `session.create.before` (`auth/index.ts:340-353`, new sessions only), the email-keyed checks at sign-in, and `dispatch.ts:156` (stops sending). Every user route resolves the user through `auth.api.getSession` (18 call sites) with no suspended check. A suspended user with a live cookie (sessions last 30 days, `auth/index.ts:177`) keeps full read/write access to profile, mail, applications, push.
- **Impact:** the suspend button does not do what an owner expects, which matters most for the "remove an abusive or compromised beta user" case.
- **Fix:** in the suspend transaction delete the user's `sessions` rows; add a `suspended_at` check in a shared `requireUser` helper (or a better-auth `session.get` hook) so a stale session is refused; reinstate stays as is. Test: suspend with an open session, next request is 403.

### 2. P1: Test routes can be enabled in production by one env var
- **Evidence:** `env.ts:24` allows `ENABLE_TEST_ROUTES` in any `NODE_ENV`; the production `superRefine` (`env.ts:133`) does not forbid it. `app.ts:190` mounts `/__test__` with no authentication. `test-only.ts:2599-2620` returns all users and **session tokens**; `/auth/role` (`:2622`) sets any user's role; `/jobs/*`, `/clock/offset`, mail sink and notification seeders are also open. `main.ts:137` also starts HTTP interception when set. The Fly `fly.toml` does not set it today, but a mistyped `fly secrets set` or copied `.env` would.
- **Impact:** full account takeover and owner escalation, no auth required.
- **Fix:** add a `superRefine` issue: `NODE_ENV === "production"` with `ENABLE_TEST_ROUTES` true is a startup error; also assert in `createApp` that `testRoutes` is false when `NODE_ENV=production`. Add a unit test on the env schema.

### 3. P2: Gmail aliases bypass suspension; unverified sign-ups persist
- **Evidence:** the allowlist and invites use `normaliseEmail` (dots and `+tag` collapsed for Gmail, `email.ts:3`), but `suspendedUserWithEmail` (`invites.ts:61`) matches the exact lower-cased address. A suspended `a@gmail.com` can sign up as `a+2@gmail.com`: `mayJoin` passes (accepted invites still count as live, `invites.ts:42`), `user.create.after` returns early for an unverified user (`auth/index.ts:308`), and the row stays. After verification `update.after` does nothing. Result: a second, usable account and no grant. `liveInviteFor` returning accepted invites also lets any alias pass `mayJoin`.
- **Fix:** compare suspension by normalised mailbox (store a normalised-email column or HMAC like invites); make `mayJoin` use `pendingInviteFor` or the existing-user path only; delete or block unverified rows that cannot be accepted at create time instead of after verification; one account per normalised mailbox (unique index).

### 4. P2: Blind SSRF through the push endpoint
- **Evidence:** `notifications.ts:16` accepts any `https://` URL; `web-push.ts:218` POSTs to it with default redirect following and sends a VAPID `authorization` header. No host allowlist, no private-address check.
- **Impact:** any signed-in beta user can make the Fly machine POST to internal https hosts (Fly `.internal`, other services) and to arbitrary hosts; the response status is also observable through the subscription "gone" handling. Low data impact, but it is the only user-controlled outbound URL found.
- **Fix:** allowlist known push-service hostnames (`fcm.googleapis.com`, `*.push.apple.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com`), set `redirect: "manual"`, and resolve-and-reject private ranges if the allowlist is widened.

### 5. P2: No security headers
- **Evidence:** repo-wide search finds no CSP, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` or HSTS (Fly's `force_https` redirects but sends no HSTS). `staticResponseFrom` (`app.ts:56-76`) serves files with no headers.
- **Impact:** the admin SPA (`admin.tryoverture.com`) can be framed (clickjacking of owner actions); no CSP backstop for any XSS in rendered mail, posting or resume text.
- **Fix:** a Hono middleware on both hosts: `Content-Security-Policy` (default-src 'self', Turnstile and push origins explicitly, `frame-ancestors 'none'`), `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security` (preload only after the owner agrees), `Permissions-Policy`. Run a CSP report-only pass first; the e2e layout guards should catch breakage.

### 6. P2: Admin gate does not tie the Access identity to the session user
- **Evidence:** `admin.ts:151-171` verifies the Access JWT, then the better-auth session, role and passkey recency, but never compares `identity.email` (`access/index.ts:84`) with `session.user.email`. The passkey assertion window is recorded per user, not per session (`passkey/index.ts:10`).
- **Impact:** defence in depth only (Cloudflare Access still gates the host and the owner role is required). Matters if a second owner row appears (see 3) or Access policy is widened.
- **Fix:** require `isSameMailbox(identity.email, session.user.email)`; bind the assertion to the session id; add a test for a mismatched identity.

### 7. P2: Reveal is not built, but personal data is reachable from admin
- **Evidence:** ADR 0015 and SPEC §Admin require Reveal (passkey, reason, 15 minutes, audited) for resumes, Facts, mail and Snapshots. No `reveal` code exists in `src/server`. `admin.ts:440-` decrypts and returns the resume filename and user detail; `admin.ts:1043,1075` return provider live-view and recording URLs for any attempt (a browser session on a user's application form).
- **Fix:** this is the M2 Reveal ticket; make it a blocker for the beta wave, and until then drop filename decryption from `/users/:id` and put the live/replay routes behind the same grant.

### 8. P2: Pre-registration of an allowed address
- **Evidence:** `emailAndPassword.requireEmailVerification` stops sign-in but not creation. Anyone passing Turnstile can sign up with the owner's or an invitee's address and a chosen password (`mayJoin` is address-only, `auth/index.ts:141`); the row exists with `emailVerified=false`. If the real owner/invitee later signs in with Google or a magic link, the account links to that row and the attacker's password is still valid (classic pre-hijack).
- **Fix:** on a verified sign-in (social or magic link) to an account that has a password credential created before verification, delete the unverified credential (better-auth hook on `account.create`/`user.update`), or send the verification link first and create the row only on verification. Add a test with a pre-registered address.

### 9. P2: Client IP is attacker-influenced
- **Evidence:** `turnstile-gate.ts:43-53` falls back to the first `x-forwarded-for` entry; better-auth's own IP limiter (`auth/index.ts:260-272`) has no `advanced.ipAddress` configuration, so it uses its default header list. On Fly the trusted header is `fly-client-ip`.
- **Impact:** per-IP limits can be sidestepped by rotating a forged header. The per-email limits (`auth/index.ts:91`) still bound the account-targeting cases, so impact is moderate.
- **Fix:** configure `advanced.ipAddress.ipAddressHeaders: ["fly-client-ip"]`, drop the `x-forwarded-for` fallback in production. **Needs prod check:** confirm the Fly proxy overwrites `fly-client-ip`.

### 10. P3: Inbound authentication is looser than ADR 0006 describes
- **Evidence:** `inbox/auth.ts:6-15` treats the DKIM signing domain and the From domain as aligned when either is a subdomain of the other, with no public-suffix handling; `result.dmarc` and `result.spf` are not consulted (`:25-52`). The "pass" gates reading codes and Stage moves (`ingest.ts:306-314`); code reading is further limited to ATS mail domains, which bounds the impact.
- **Fix:** use the DMARC result from `mailauth` (`result.dmarc.status.result === "pass"`) or organisational-domain alignment with a public-suffix list; keep "fail" semantics for ADR 0006.

### 11. P3: Allowlist enumeration
- `/sign-in/email`, sign-up and magic link answer a distinct `forbidden` for addresses that are not allowed (`auth/index.ts:109,254,377`), and "account_suspended" for suspended ones. Turnstile and per-email limits slow this. **Fix:** answer uniformly ("check your email") and send nothing; keep the distinct states to the admin view.

### 12. P3: Crypto
- Only `MASTER_KEY_V1` is read (`app.ts:86-88`, `env.ts:74`); `MASTER_KEY_CURRENT` selects a version number but no second key can be supplied, so rotation (ADR 0014) is not yet possible. The DEK is wrapped with AES-GCM and no associated data (`crypto.ts:64-78`), so a wrapped DEK copied between users' rows would unwrap; row-level ciphertext does bind table/column/row (`crypto.ts:33`). AES-GCM with random 96-bit IVs per value is fine at this scale. **Fix:** `MASTER_KEY_V<n>` map and a re-wrap script; bind the wrap to the user id as AAD (migrate by re-wrapping).

### 13. P3: Inbound body buffering
- `inbound.ts:75-85` reads the whole body before enforcing 25 MiB when `content-length` is missing or wrong. The HMAC check runs after the read. Fly's 2 GB machine can take a few of these. **Fix:** stream with a counter or use Hono `bodyLimit`; reject before reading when headers are absent.

### 14. P3: Password-reset token probe
- `password-reset.ts:12-45` returns the email for a valid reset token. The token is a secret already, so low risk, but it is not Turnstile-gated or limited and tokens are stored unhashed in `verifications`. **Fix:** rate-limit by IP; consider hashing identifiers (better-auth option) before the beta wave.

### 15. P3: Dependencies
- `bun audit` (Bun 1.4.5): 3 moderate, all transitive/dev: `esbuild` ≤0.24.2 dev-server request issue (via drizzle-kit, vite/tsx, wrangler), `glob`/`minimatch` DoS via an OpenTelemetry resource detector. None reaches request handling. `dependabot.yml`, CodeQL and gitleaks run in CI. **Fix:** `bun audit fix` after the M2 builds, or pin overrides; add `bun audit --audit-level high` to CI.

### 16. P3: Access verifier issuer
- `access/index.ts:67` builds `https://${teamDomain}` even when only `CF_ACCESS_JWKS_URL` is set, giving `https://undefined`; every admin request then fails closed. Not exploitable; require `CF_ACCESS_TEAM_DOMAIN` when the audience is set.

## Checked and found sound
- Inbound mail HMAC: timestamp window, constant-style compare through a keyed double-HMAC, body hash bound, address MAC, 503 when the secret is unset (`shared/inbound-mail.ts:86-134`, `routes/inbound.ts:70-110`).
- Per-user envelope encryption with AAD per column/row; raw mail sealed before storage (`inbound.ts:120-128`); no personal data in `live-check` objects other than the system mailbox.
- Session cookies: better-auth defaults (httpOnly, secure on https, SameSite=Lax); trusted origins limited to `APP_ORIGIN`; `AUTH_ALLOWED_HOSTS` only adds `http://` hosts when explicitly set.
- Admin fails closed when Access is not configured (`admin.ts:178`); every admin mutation records an audit row.
- Static file serving resolves and prefixes against the root (`app.ts:57-66`); no traversal found.
- Outbound fetchers (Greenhouse, Lever, Ashby, Personio, Workable, liveness, form-read) build URLs from catalogue tokens with `encodeURIComponent`; Personio uses `redirect: "manual"`. Prompt injection from postings is handled by the HTML sanitiser/guard (`pipeline/guard/posting-guard.ts`) and facts-only answers (ADR 0007); the LLM port has no tool calls.
- Resume upload: size and MIME checked at the route, parsed with `unpdf` in-process (a malicious PDF can still cost CPU; see ticket T9).
- Container runs the app as non-root after the entrypoint chown; no secret in the image (`Dockerfile`).

## Needs owner/prod check
- Fly: `fly secrets list` should not contain `ENABLE_TEST_ROUTES`; confirm `fly-client-ip` is trustworthy; confirm the `*.fly.dev` hostname does not serve the admin host without Access (the app-side JWT check covers it, so this is defence in depth).
- Cloudflare: Access policy for `admin.tryoverture.com` limited to the owner; WAF rate rules on `/api/auth/*` and `/internal/mail/inbound` (needs the paid plan decisions in ADR 0033); Turnstile hostnames exclude localhost in production (the env check already enforces this).
- R2: backup and files buckets use separate tokens with least privilege (Litestream and the app share `R2_ACCESS_KEY_ID` in `litestream.yml:12`).

## Proposed tickets (each a separate issue under M2 #6)
| Ticket | Sev | Scope | Blocks beta wave |
|---|---|---|---|
| T1 Suspension kills sessions and blocks stale sessions | P1 | finding 1 | yes |
| T2 Production refuses `ENABLE_TEST_ROUTES` | P1 | finding 2 | yes |
| T3 One account per normalised mailbox; suspension by mailbox; no unverified leftovers | P2 | findings 3, 8 | yes |
| T4 Push endpoint allowlist, no redirects | P2 | finding 4 | yes |
| T5 Security headers and CSP (report-only first) | P2 | finding 5 | yes |
| T6 Admin: bind Access identity and passkey assertion to session; Reveal gating for filenames and live views | P2 | findings 6, 7 | yes, with the Reveal ticket |
| T7 Trusted client IP (`fly-client-ip`) for limits and Turnstile | P2 | finding 9 | no |
| T8 Inbound DMARC-based auth, stream the body, uniform auth errors | P3 | findings 10, 11, 13, 14 | no |
| T9 Master key map, DEK AAD, re-wrap script; PDF parse worker limits | P3 | finding 12 | no |
| T10 CI `bun audit` gate and dependency bumps | P3 | finding 15, 16 | no |
