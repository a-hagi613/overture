# Admin Portal Diagnosis, Feature Blueprint & Implementation Tickets (2026-11-23)

## 1. Why `/admin` Was Invisible & Unreachable

Live production probes (`curl` + `flyctl secrets list -a overture-web`) and code inspection show **four independent layers** blocking the Admin Portal today:

1. **No DNS record or Fly TLS certificate for `admin.tryoverture.com`:**
   - `src/server/config/env.ts:46` sets `ADMIN_ORIGIN = "https://admin.tryoverture.com"`.
   - `src/server/app.ts:379-384` only mounts `adminHost` (`/admin/api/*`) when `isAdminHost(hostname, env.ADMIN_ORIGIN)` is true.
   - Live probe: `curl https://admin.tryoverture.com/admin` fails with **DNS error `(6) Could not resolve host`**. `flyctl certs list -a overture-web` has only `tryoverture.com`.
2. **Missing Cloudflare Access secrets on Fly:**
   - `src/server/routes/admin.ts:217-254` requires `verifier !== null` (`CF_ACCESS_JWKS_URL`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`), returning `401 access_required` whenever those env vars are unset.
   - `flyctl secrets list -a overture-web` confirms none of `CF_ACCESS_*` are set on production.
3. **Missing `ADMIN_ORIGIN` in Better Auth `trustedOrigins` (`src/server/auth/index.ts:200-205`):**
   - `trustedOrigins` only lists `APP_ORIGIN` and `AUTH_ALLOWED_HOSTS` — NOT `env.ADMIN_ORIGIN`.
   - Even after DNS and Access are provisioned, registering/asserting the admin WebAuthn Passkey (`POST /api/auth/passkey/*`) from `https://admin.tryoverture.com` will fail Better Auth's Origin check (`403 Invalid Origin`).
4. **Silent HTML fallback on `tryoverture.com/admin`:**
   - Visiting `https://tryoverture.com/admin` returns `200 OK` and mounts the React `AdminShell`, which fetches `GET /admin/api/overview`.
   - Because `tryoverture.com` is NOT `adminHost`, `/admin/api/overview` falls through to `staticResponseFrom` (`src/server/app.ts:387`), returning `200 text/html` (`index.html`) instead of `401 { error: "access_required" }`! The admin UI has no redirect to `admin.tryoverture.com` and no in-app owner link.

---

## 2. Target Admin Identity & Entry Flow

```
Owner on https://tryoverture.com/home
  ├── Sees owner-only "Admin Portal" link (sidebar menu & Profile -> Account)
  └── Or visits https://tryoverture.com/admin directly
        │
        ▼ (Handoff card / redirect to https://admin.tryoverture.com/admin)
Cloudflare Access Gate (tryoverture Zero Trust team, owner email only)
        │ Injects verified Cf-Access-Jwt-Assertion
        ▼
Host Router (`isAdminHost` -> `adminHost`)
  ├── 1. Verify Cloudflare Access JWT email matches owner
  ├── 2. Verify Better Auth session exists & user.role === "owner" (trustedOrigins includes ADMIN_ORIGIN)
  └── 3. Verify WebAuthn Passkey assertion within 12-hour window (`PASSKEY_ASSERTION_WINDOW_MS`)
        │
        ▼
Admin Portal (/admin) — Full Operations Console
```

- **Regular users & demo users** never see the in-app Admin link, get redirected/refused at Cloudflare Access + `owner_required`, and cannot access `/admin/api/*`.
- Note on main-host `/admin/api/*` (fixed in **T2 / #503**): requests to `/admin/api/*` on `tryoverture.com` immediately return `401 { error: "access_required" }` JSON instead of HTML.

---

## 3. Complete Admin Inventory: Built vs Missing

### 3.1 Existing Admin UI Routes (14 pages in `src/web/routes/admin/`)
| Route | Page | What It Does Today |
|---|---|---|
| `/admin` | `overview.tsx` | Job status counts, user/session counts, active kill switches, 30-day cost gate summary, monthly mail cap, last 20 audit rows |
| `/admin/users` | `users.tsx` | Search/list users |
| `/admin/users/:id` | `user.tsx` | User profile summary, Reveal PII with audit reason (ADR 0015), suspend / reinstate |
| `/admin/invites` | `invites.tsx` | Create / revoke beta invites and view invite grant policy |
| `/admin/grants` | `grants.tsx` | List and issue manual Application grants |
| `/admin/billing` | `billing.tsx` | Per-user billing balances and statuses |
| `/admin/billing/margin` | `margin.tsx` | 30-day per-plan gross vs net vs modeled/actual cost & margin table |
| `/admin/billing/reconciliation` | `billing-reconciliation.tsx` | Daily Stripe ↔ ledger mismatch inspector |
| `/admin/billing/users/:id` | `billing-user.tsx` | Single-user ledger & subscription detail |
| `/admin/billing/users/:id/refund` | `billing-refund.tsx` | Issue Stripe refunds with audit reason |
| `/admin/provider-report` | `provider-report.tsx` | Browser provider × ATS completion/challenge/cost matrix + synthetic lab launcher |
| `/admin/settings` | `settings.tsx` | Raw key/value `settings` editor + `kill_switches` toggles |
| `/admin/catalog` | `catalog.tsx` | Per-ATS hourly cap, kill switches, and tag import triggers |
| `/admin/mail-health` | `mail-health.tsx` | Inbound/outbound mail health & employer reply-rate metrics |

### 3.2 Backend Endpoints Already Built With **ZERO Admin UI**
`src/server/routes/admin.ts` already implements these endpoints, but no UI screen calls them:
- `GET /admin/api/storage-report` (`:765`) — disk, SQLite sizes, R2 backup/file byte attribution
- `GET /admin/api/llm-usage` (`:1200`) — Anthropic calls, tokens, cache hits, cost micros by purpose
- `GET /admin/api/attempts` (`:1206`) — Browser attempt history, duration, proxy bytes, cost
- `GET /admin/api/attempts/:id/live` (`:1242`) — Live Browser Use view URL for active send
- `GET /admin/api/attempts/:id/replay` (`:1274`) — Session recording replay URL
- `GET /admin/api/live-checks` & `POST /admin/api/live-checks` (`:1357-1359`) — Production live-check results & manual trigger

### 3.3 Missing Operational Capabilities (To Build in ADM-1 – ADM-6)
1. **Owner entry & `/admin` main-host handoff (`ADM-1` / #512)**
2. **Support Tickets Queue (`/admin/support` — `ADM-2` / #513)**
3. **System Health, SQLite/WAL/Storage & Live Checks UI (`/admin/system` — `ADM-3` / #514)**
4. **Background Job Queue & Dead-Letter Inspector (`/admin/jobs` — `ADM-4` / #515)**
5. **Live Browser Attempts, Replay & LLM Spend UI (`/admin/attempts`, `/admin/llm` — `ADM-5` / #516)**
6. **Full Searchable Audit Log (`/admin/audit`), Launch Readiness Controls Panel, Persistent Alerts Feed & React Query Migration (`ADM-6` / #517)**

---

## 4. Detailed Implementation Tickets (`ADM-1` through `ADM-6`)

### ADM-1 ([#512](https://github.com/a-hagi613/overture/issues/512)): Owner Entry, `/admin` Main-Host Redirect & Provisioning Runbook
- **Depends on:** T2 (`#503` adds `ADMIN_ORIGIN` to `trustedOrigins` and JSON 401 on `/admin/api/*`).
- **Backend (`src/server/routes/me.ts`):** When `session?.user.role === "owner"`, include `adminOrigin: env.ADMIN_ORIGIN` on `GET /api/me` (omit/null for non-owners).
- **Front end:**
  - `src/web/routes/admin/shell.tsx` / `gate-screen.tsx`: When mounted on an origin that does not match `me.adminOrigin` (in production, i.e., `hostname !== new URL(adminOrigin).hostname`), render an Ember handoff card with a direct link/redirect button `"Continue to Admin Portal"` -> `${adminOrigin}${pathname}${search}`.
  - `src/web/components/sidebar-profile-menu.tsx` & `src/web/routes/profile-account.tsx`: Show an `"Admin Portal"` menu item / badge link only when `session.user.role === "owner"`.
- **Ops/Docs (`docs/DEPLOY.md`, `scripts/check-admin-host.ts`):** Document and verify Cloudflare DNS (`admin.tryoverture.com`), Fly cert, Zero Trust Access policy, and `CF_ACCESS_*` secrets.
- **Agents:** DeepSeek (`/api/me` + check script + docs) / Antigravity Neon (UI handoff + owner link).

### ADM-2 ([#513](https://github.com/a-hagi613/overture/issues/513)): Support Tickets Queue (`/admin/support`)
- **Depends on:** T8 (`#510` adds `support_tickets` table & persistence on `POST /api/support`).
- **Backend (`src/server/routes/admin.ts`):**
  - `GET /admin/api/support` (`?status=open|in_progress|resolved|closed|all&limit=50`): returns `{ openCount, tickets }` with decrypted messages via `deps.personal` and joined user name/email.
  - `PATCH /admin/api/support/:id` (`{ status, adminNotes? }`): updates status/notes/`resolvedAt` and writes `admin_audit` (`action: "support.update"`).
  - `POST /admin/api/support/:id/reply` (optional if `mail` passed in `AdminDeps`): sends outbound reply quoting `[Ref: referenceId]`, writes `admin_audit` (`action: "support.reply"`).
  - Include `openSupportTickets` in `GET /admin/api/overview`.
- **Front end (`src/web/routes/admin/support.tsx`):**
  - Filter tabs (`Open`, `In progress`, `Resolved`, `All`), category pill, link to `/admin/users/:id`, message detail drawer, internal notes box, status transition buttons.
- **Agents:** DeepSeek (API) + Antigravity Neon (UI).

### ADM-3 ([#514](https://github.com/a-hagi613/overture/issues/514)): System Health, Database/WAL/Storage & Live Checks (`/admin/system`)
- **Backend (`src/server/routes/admin.ts`):**
  - Extend `GET /admin/api/storage-report` (or add `GET /admin/api/system`): report `app.sqlite` & `catalog.sqlite` byte size, `-wal` size, `page_count`, `freelist_count` (reclaimable MB), Litestream status/lag, memory RSS, load average, uptime, and boolean readiness flags (`cfAccessConfigured`, `ntfyConfigured`, `stripeMode: "live" | "test" | "unconfigured"`, `publicSignupEnabled`, `demoLoginEnabled`, `browserProvider`). **Never expose secret values.**
  - Add `POST /admin/api/system/checkpoint`: runs `PRAGMA wal_checkpoint(TRUNCATE)` on `app.sqlite` / `catalog.sqlite`, writes `admin_audit` (`action: "system.wal_checkpoint"`), returns before/after WAL bytes.
- **Front end (`src/web/routes/admin/system.tsx`):**
  - Runtime & integration health pills, SQLite + freelist + WAL gauge with **Run WAL Checkpoint** button, R2 storage attribution table (wiring `GET /admin/api/storage-report`), and Live Checks table + **Run Live Checks Now** trigger (wiring `GET/POST /admin/api/live-checks`).
- **Agents:** DeepSeek (API) + Antigravity Neon (UI).

### ADM-4 ([#515](https://github.com/a-hagi613/overture/issues/515)): Background Job Queue & Dead-Letter Inspector (`/admin/jobs`)
- **Backend (`src/server/routes/admin.ts`):**
  - `GET /admin/api/jobs` (`?status=...&kind=...&limit=100`): lists `bg_jobs` rows ordered by `updatedAt DESC`, returning `countsByKindStatus` and sanitized job metadata (`lastError`, `attempts`, `maxAttempts`, `lockedUntil`, `dedupeKey`, bounded `payloadPreview`).
  - `POST /admin/api/jobs/:id/retry`: requeues `dead`/`failed` job (`status = 'queued'`, `attempts = 0`, `runAt = now`, `lockedUntil = null`, `lastError = null`) + `admin_audit` (`action: "job.retry"`). Returns `409` if job is `running`.
  - `POST /admin/api/jobs/:id/cancel`: cancels `queued`/`dead` job safely + `admin_audit` (`action: "job.cancel"`).
- **Front end (`src/web/routes/admin/jobs.tsx`):**
  - Status & kind filters, error message preview, Retry/Cancel actions with toast, and Overview alert link when `dead > 0`.
- **Agents:** DeepSeek (API) + Antigravity Neon (UI).

### ADM-5 ([#516](https://github.com/a-hagi613/overture/issues/516)): Live Attempts, Browser Replay & LLM Spend (`/admin/attempts` & `/admin/llm`)
- **Backend:** Already implemented in `src/server/routes/admin.ts:1200-1305`!
- **Front end (`src/web/lib/admin-api.ts`, `src/web/routes/admin/attempts.tsx`, `src/web/routes/admin/llm.tsx`):**
  - Add Zod schemas & React Query loaders matching `GET /admin/api/attempts`, `/attempts/:id/live`, `/attempts/:id/replay`, and `/llm-usage`.
  - `/admin/attempts`: filterable attempt table (ATS, posting, provider, outcome, duration, proxy MB, cost), **Watch Live** button, and **View Replay** viewer/link.
  - `/admin/llm`: daily/total spend vs cap, cost breakdown by `purpose` & `model`, prompt-cache hit ratio, and recent calls log.
- **Agent:** Antigravity Neon (`gemini-4-neon-high`).

### ADM-6 ([#517](https://github.com/a-hagi613/overture/issues/517)): Audit Log, Launch Controls, Alerts Feed & React Query Migration
- **Depends on:** ADM-1 – ADM-5.
- **Backend (`src/server/routes/admin.ts`, `src/server/platform/audit/index.ts`):**
  - Upgrade `GET /admin/api/audit` to support `?action=&targetUserId=&q=&limit=50&before=` pagination.
  - Add `GET /admin/api/alerts` (owner alert notifications + live active problems: enabled global/ATS kill switches, dead jobs, backup lag, mail cap warning) & `POST /admin/api/alerts/ack`.
- **Front end:**
  - Migrate `src/web/lib/admin-resource.ts` from raw `useEffect` to React Query (`@tanstack/react-query`) while preserving `AdminRefusalCode` gate behavior (`access_required`, `sign_in_required`, `owner_required`, `passkey_required`).
  - Build `/admin/audit` searchable audit table with JSON detail viewer.
  - Add **Launch Readiness Controls** section on `/admin/settings` (guided controls for `limits.daily_cap`, `browser.max_concurrent_sessions`, `limits.send_window`, `llm.model` check, and kill-switch banners) + persistent **Alerts Feed** on `/admin` Overview.
  - Polish Admin shell & tables with Ember `Card`, `Badge`, `Button`, and `ds.ts` typography tokens.
- **Agents:** DeepSeek (API) + Antigravity Neon (UI).
