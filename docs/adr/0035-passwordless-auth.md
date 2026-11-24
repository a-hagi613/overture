---
status: accepted
---

# Overture signs in without passwords

Issue #369 (parent #7). The owner ruled on 2026-11-21 that Overture supports **Google, LinkedIn and the emailed
magic link** and nothing else for people, plus the read-only `test@email.com` demo button while
`DEMO_LOGIN_ENABLED=true`. Email + password, which ADR 0026 had scheduled for M2 and #271 built, is removed. The
admin host no longer uses a passkey: it trusts a verified Cloudflare Access JWT for `OWNER_EMAIL` directly.

## Context

Email + password added a stored secret, a breach-range lookup, sign-up and reset mail, three more Turnstile
surfaces and four more rate-limit buckets, for a product whose users already hold a Google or LinkedIn identity or an
inbox. Magic links already work for any address, so a password only gave a second way in to a mailbox the user
controls anyway. Every password feature (verification mail, forgot and reset screens, "wrong password", the pre-hijack
handling of unproven sign-ups) was extra surface to attack, test and keep on the sign-in canvas.

## Decision

- **One screen, three ways in.** `/signin` shows Google, LinkedIn (when configured) and an email field with
  "Email me a sign-in link". There is no sign-up mode: the link, like the providers, creates the account for an
  invited address (ADR 0030) and refuses any other with the same invite copy.
- **No password is stored or accepted.** `/api/auth/sign-in/email`, `/sign-up/email`, `/send-verification-email`,
  `/request-password-reset` and `/reset-password` no longer exist (better-auth's `emailAndPassword`, email
  verification and `haveIBeenPwned` are off). `/forgot-password`, `/reset-password` and `GET /api/password-reset`
  are deleted, with the password and verification mails, the `reset` and `signup` Turnstile actions and the
  per-email sign-in, sign-up and reset limits. The magic-link limit (3 per 15 minutes) and the bot check on the
  social, magic-link and demo endpoints stay.
- **Delete account re-auth is a fresh sign-in.** `POST /api/account/reauth` is gone. The page's one action is "Email
  me a sign-in link" (`POST /api/account/reauth/link`, three asks per window); opening the link creates a session
  that counts as fresh for 15 minutes. A session that is itself fresh needs no step.
- **The admin is Access-only.** `admin.tryoverture.com` has no secondary sign-in: a verified Cloudflare Access JWT
  whose address is `OWNER_EMAIL` authenticates the owner directly on the admin pages, `/admin/api/*` and the
  admin-host `/api/me`, and opens a Reveal with the typed reason alone. Missing or invalid Access credentials fail
  closed with `access_required`; any other address gets `owner_required`. The main app keeps ignoring the Access JWT.
- **`ALLOWED_SIGNUP_EMAILS` is a tester allowlist.** With `PUBLIC_SIGNUP_ENABLED=false`, a comma-separated
  `ALLOWED_SIGNUP_EMAILS` lets those addresses sign up and sign in on the main app. They are ordinary `user`
  accounts; only `OWNER_EMAIL` ever receives the `owner` role.
- **No migration.** `accounts.password` stays as a nullable column and `providerId = "credential"` rows are left in
  place; nothing reads them. Dropping them is a separate, destructive change that needs its own migration slot and
  is not part of this one. The guard that discards an unproven credential-only row when a verified provider signs in
  stays, because such rows can still exist in the database.

## Consequences

- Smaller attack surface and one fewer secret class to protect (SPEC §13.1 and §13.2 say so).
- A person who only used a password signs in with an emailed link from now on; existing sessions are unaffected.
- Sign-in boards drawn for sign-up, forgot, reset and verify-sent are obsolete. `design/reference/signin/` drops
  them, and the remaining states are re-captured from the redrawn canvas (ADR 0027 still governs the dark ground).
