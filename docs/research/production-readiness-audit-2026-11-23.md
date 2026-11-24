# Full-Stack Production Readiness Audit (2026-11-23)

Comprehensive production-readiness audit of Overture covering back end, front end (PR #501), database, security, infrastructure, multi-user scalability, unit economics, and the Admin Portal.

- **Main branch baseline:** `origin/main` (`176ae2fa`, 2026-11-22)
- **Front-end rebuild baseline:** PR #501 (`a-hagi613/canvas-design-implementation-agents` at `a26f465a`, 373 files changed, +19,251 / -14,884)
- **Prior audit context:** [backend-audit-2026-11-23.md](backend-audit-2026-11-23.md) (contract check against 29 endpoints, 37 application details, 6 threads; cross-user scoping 10/10 404s; live read-only production probe of `overture-web`)
- **Admin Portal guide & backlog:** [admin-portal-plan-2026-11-23.md](admin-portal-plan-2026-11-23.md)

---

## 1. Executive Verdict & Readiness Matrix

**Verdict: NOT ready to open public sign-up (`PUBLIC_SIGNUP_ENABLED` is correctly `"false"` in `fly.toml`).** The core billing ledger, encryption, job queue, ATS dispatch gates, and Litestream replication foundations are sound, **but four live production gaps and four rebuild blockers must close before onboarding real users.**

| Area | Status | Key Evidence & Live Findings |
|---|---|---|
| API contracts (Zod ↔ server) | **Pass (base)** | 29 GETs, 37 Application details, 6 threads parse cleanly against SPA Zod schemas for fresh owner & demo. Needs shared `src/shared/api/*` schema modules to prevent future drift. |
| Multi-user data scoping | **Pass** | User queries filter by `session.user.id`; personal fields decrypted via `personal.openFor(userId, ...)`; 0/10 cross-user Application reads leaked data (all 404). |
| Security & Auth | **RED (live)** | **H3:** `/api/events`, `/api/settings`, `/api/kill-switches`, `/api/search` readable signed-out; `alert.raised` broadcasts with `userId = null`. **H4:** `Fly-Client-IP` sees Cloudflare POP IP instead of `CF-Connecting-IP`. Resume upload lacks `%PDF-` magic-byte check; `/api/support` lacks `demoLocked`. |
| Admin Portal | **RED (live)** | Unreachable in prod: `admin.tryoverture.com` has no DNS/TLS cert, `CF_ACCESS_*` Fly secrets are missing, `ADMIN_ORIGIN` missing from `better-auth` `trustedOrigins`, main-host `/admin/api/*` serves HTML 200. |
| Database & WAL | **YELLOW (live)** | `app.sqlite` is **1,602 MB** with **1,596 MB free pages** (unreclaimed after ADR 0036 split #490) + **477 MB WAL**; `catalog.sqlite` is 821 MB. Missing hot-path indexes on `events`, `messages`, `applications`, `grants`. |
| Infrastructure & Alerting | **YELLOW (live)** | Fly `yyz` `shared-cpu-2x` (2 GB RAM, 10 GB vol, 31% disk used), Litestream lag 0s, Stripe **live mode**, `limits.daily_cap` raised 2 → 10. **`ALERT_NTFY_URL` & OTel exporters are unset** — prod alerts do not reach phone. |
| Multi-user Scalability | **YELLOW** | Single VM + SQLite handles ~50–200 active users after index fixes, **EXCEPT `browser.max_concurrent_sessions = 1`** limits total platform throughput to ~7–12 sends/hr across all users. `GET /api/threads` is unpaged; `/api/home` runs unused `matching.upNext`. |
| Front-end Perf & Bundle | **RED (PR #501)** | `dist/assets/main-*.js` is **2.3 MB uncompressed** (zero `React.lazy()` route splitting; Landing/SignIn download `@dnd-kit`, `recharts`, `motion`, and all 14 Admin pages). |
| Unit Economics | **Modeled OK / Unmeasured** | Week `$9.99 / 50` (**77.1% margin**), Month `$29.99 / 250` (**70.1% margin**) at `$0.027/app` modeled cost; `DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5"`. Zero real sends measured yet; zombie timeout can drop 15m → 12m. |
| Core User Flows (PR #501) | **RED (PR #501)** | PR #501 is `CONFLICTING` with `main` (4 files). **B2** (Board Archive doesn't withdraw approved sends), **B3** (Ready hides Approved, no unapprove, fake Skip Undo, wrong sent count), **B4** (Resume clears billing/onboarding pauses), **H1** (double Checkout), **H5** (no redirects), **H6** (localStorage Calendar), **H7/H7b** (Support access & Legal cards dropped). *(B1 explicitly skipped by owner.)* |

---

## 2. Direct Answers to Owner Questions

### H2 (`limits.daily_cap`) — Already Updated
Production `limits.daily_cap` was raised from `2` to `10` with an `admin_audit` row (matching the code default; `/api/health` returned `200`).

### H4 Explained — Why Every Visitor Shares One Rate-Limit Bucket
- `tryoverture.com` runs behind **Cloudflare** (`server: cloudflare`) proxying to **Fly.io** (`via: 1.1 fly.io`).
- `src/server/auth/client-ip.ts:24-27` sets `clientIp()` to read ONLY `Fly-Client-IP` when `FLY_APP_NAME` is defined.
- Because the TCP connection to Fly comes from Cloudflare's edge node, `Fly-Client-IP` is **Cloudflare's POP IP** (shared by thousands of visitors in the same city), NOT the visitor's real IP.
- Better Auth's rate limits (`/sign-in/magic-link`: 3/15m, `/demo/sign-in`: 3/15m, `/sign-in/social`: 10/15m, global: 100/60s) key on that IP. At launch, the **4th person in a metro region** requesting a magic link within 15 minutes gets HTTP `429`.
- **Fix (#503):** When `stampedByFlyProxy(request)` is true and `Fly-Client-IP` matches Cloudflare's published IPv4/IPv6 CIDR ranges, extract `CF-Connecting-IP`; otherwise strip `CF-Connecting-IP` and use `Fly-Client-IP`.

### H7 & H7b Explained — Missing Compliance Cards on `/profile/account`
- **H7 (Support Access Log):** ADR 0015 guarantees users can view every admin Reveal under "Support access" (`GET /api/support-access`). PR #501 deleted `settings-support-access.tsx` and `support-access-api.ts` without restoring a card in `src/web/routes/profile-account.tsx`.
- **H7b (Legal & Consent Card):** Terms §878 promises users can review Terms, Privacy, and their accepted consent version (`useConsent()`). PR #501 deleted `settings-legal.tsx`, leaving `settings-legal-row.tsx` orphaned and no legal links inside `/profile/account`.
- **Fix (#509):** Restore both cards (`<SupportAccessCard />` and `<AccountLegalCard />`) on `/profile/account` using existing `copy.settings.supportAccessPage` and `copy.settings.legal*` strings.

---

## 3. Infrastructure, Database, Security & Scale Findings (New Depth)

### 3.1 Security & Privacy Gaps
1. **Unauthenticated Endpoints & Global SSE Broadcast (H3 — #502):**
   - `src/server/routes/api.ts:71-120` exposes `GET /api/settings`, `GET /api/settings/:key`, `GET /api/kill-switches`, `GET /api/search`, and `GET /api/events` without auth.
   - `src/server/platform/sse/hub.ts:59-61` delivers `row.userId === null` rows to ALL subscribers and replays from arbitrary `Last-Event-ID: 0`. `src/server/platform/alerts.ts:74` writes `alert.raised` with `userId = null`.
   - **Fix (#502):** Remove `/api/settings*` and `/api/kill-switches`, require auth + rate limit on `/api/search`, require session on `/api/events`, deliver strictly `row.userId === subscriber.userId` with bounded catch-up (max 200 rows / 10 min), and emit `alert.raised` per owner ID.
2. **Spoofable Resume MIME Check (Medium — #505):**
   - `src/server/routes/profile.ts:43` only validates `file.type === "application/pdf"` (`Content-Type` header), without inspecting bytes for the `%PDF-` signature (`0x25 0x50 0x44 0x46 0x2d`).
3. **Malformed `Host` Header 500 + Main-Host `/admin/api/*` Fallback (#503):**
   - `src/server/app.ts:380` runs `new URL(\`http://${hostHeader}\`)` outside `try/catch` (uncaught 500 on malformed `Host`).
   - On `tryoverture.com`, `/admin/api/*` falls through to `staticResponseFrom` serving `200 text/html` instead of JSON `401`.
4. **`/api/support` Hardening (#510):**
   - `src/server/routes/support.ts` (on PR #501) uses `zValidator` instead of `validJson`, re-implements `readSession`, omits `demoLocked`, omits `replyTo: user.email`, consumes rate limit prior to send errors, and does not store tickets in SQLite.

### 3.2 Database, Backups & Infrastructure
1. **`app.sqlite` 1.6 GB Bloat & 477 MB WAL (#506 + Ops):**
   - Live probe on `overture-web`: `/data/app.sqlite` = `1602.28 MB` (`page_size=4096`), **`freeMb = 1596.12 MB`** (99.6% empty freelist left by ADR 0036 catalog extraction #490), `app.sqlite-wal` = `476.8 MB`, `catalog.sqlite` = `820.6 MB` (`freeMb = 0.004 MB`).
   - Every Litestream snapshot copies 1.6 GB for ~6 MB of real rows, slowing restore drills and consuming R2 storage/egress.
   - **Fix:** Run one-time maintenance `wal_checkpoint(TRUNCATE)` + `VACUUM` (`scripts/vacuum-app-db.ts` added in #506), plus tune `PRAGMA cache_size = -16384`, `PRAGMA temp_store = MEMORY`, `PRAGMA journal_size_limit = 67108864`.
2. **Missing Hot-Path SQLite Indexes (#506, Drizzle migration `0058`):**
   - `events(user_id, seq)` and `events(created_at)`
   - `messages(user_id, created_at)`
   - `applications(user_id, status)`
   - `grants(user_id, starts_at)`
3. **Production Observability & Phone Alerting Off (Ops):**
   - `flyctl secrets list -a overture-web` shows `ALERT_NTFY_URL` and `OTEL_EXPORTER_OTLP_*` are NOT configured. `raiseAlert()` silently skips phone pushes (`src/server/platform/alerts.ts:57`).

### 3.3 Multi-User Scalability Bottlenecks
1. **Browser Session Concurrency = 1 (CRITICAL for multi-user launch):**
   - Production `browser.max_concurrent_sessions` defaults to `1` (`src/server/dispatch/browser/session-slots.ts`). At ~5–9 min/attempt, the entire platform can send only **6–12 applications per hour** across ALL users. With 10 paying users trying to send 10/day, the send window backs up immediately.
   - Because Browser Use executes browsers in the cloud (not inside the 2 GB Fly VM), Fly memory/CPU is NOT the bottleneck here. Raise `browser.max_concurrent_sessions` to `5`–`10` (matching your Browser Use plan concurrency) via `/admin/settings` before beta wave.
2. **Front-end JS Bundle Monolith = 2.3 MB (#511):**
   - `src/web/route-table.tsx` statically imports every page (`BoardPage`, `HomePage` charts, `CalendarPage`, `Onboarding*`, and all 14 `Admin*` routes). `dist/assets/main-*.js` is **2.3 MB**.
   - Fix via route-level `React.lazy()` + manual vendor chunking while keeping `scripts/prerender.tsx` working for `/`.
3. **Unused Server Work & Unbounded Reads:**
   - `/api/home` runs `matching.upNext(...)` (fact decryption + ranking) on every Home load and SSE invalidation (`#510`).
   - `GET /api/threads` decrypts every thread ever received without pagination (`#506`).
   - Workspace search fires on every keystroke with no debounce (`#509`, up to 1,500 AES decrypts/keystroke).
   - `useLiveUpdates` never invalidates `["ready"]` / `["threads"]`, and `useMarkRead` doesn't invalidate `["nav"]` (`#509`).

### 3.4 Unit Economics Check
- **Verified pricing (`src/server/billing/margin.ts` & `docs/research/final-prices.md`):**
  - **Trial:** 3 Applications free (~$0.08 acquisition cost).
  - **Week:** **$9.99 / 50 Applications / 7 days** → $0.200 gross / **$0.187 net** (after regular Stripe Billing 3.6% + $0.30 domestic; $0.184 on an international card). Corrected from the Managed Payments figures in WS-1a (#564).
  - **Month:** **$29.99 / 250 Applications / 30 days** → $0.120 gross / **$0.114 net** ($0.113 international). Corrected in WS-1a (#564).
  - **Fixed infra:** **$20.76/mo** (Fly VM $13.39 + 10 GB vol $1.50 + CF Workers $5.00 + domain $0.87). **Break-even: 1 Month subscriber covers fixed infra.**
- **Model check:** `src/server/platform/llm/models.ts:13` defaults to `DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5"` ($0.05/$0.25 per MTok batch), NOT the 10× pricier `claude-haiku-4-5`. Verify `settings['llm.model']` is unset or `claude-haiku-5-5` in prod.
- **Cost levers:** Drop `SESSION_TIMEOUT_MINUTES` from `15` → `12` (`src/server/dispatch/executor.ts:62`, in `#506`) to cut worst-case zombie session holds by 20% while keeping the 10-min code-paste flow intact. Complete the owner 5-app live run (#38) to replace modeled Browser Use proxy MB (2.71 MB) with real ATS measurements.

---

## 4. Complete Execution Roadmap & GitHub Issues

All 16 tickets are cut as GitHub Issues and split into parallelizable waves respecting file ownership and Drizzle migration serialization (only one open PR holds the next migration number at a time).

| Ticket | Issue | Scope & Key Findings Closed | Branch / Base | Agent / Model | Risk / Merge Gate |
|---|---|---|---|---|---|
| **T1** | [#502](https://github.com/a-hagi613/overture/issues/502) | Lock down `/api/events`, `/api/settings`, `/api/kill-switches`, `/api/search`; per-user SSE & alerts (**H3**) | `main` | DeepSeek (`deepseek-v4.1-flash`) | **High** — `YES, MERGE NOW` |
| **T2** | [#503](https://github.com/a-hagi613/overture/issues/503) | Cloudflare CIDR `CF-Connecting-IP` (**H4**), `ADMIN_ORIGIN` `trustedOrigins`, safe `Host`, `/admin/api/*` 401 JSON | `main` | DeepSeek (`deepseek-v4.1-flash`) | **High** — `YES, MERGE NOW` |
| **T3a** | [#504](https://github.com/a-hagi613/overture/issues/504) | Block duplicate Checkout (**H1**), allow demo `GET /api/billing` (**M8**), fix Stripe portal default URL (**H5**) | `main` | DeepSeek (`deepseek-v4.1-flash`) | **High** — `YES, MERGE NOW` |
| **T3b** | [#505](https://github.com/a-hagi613/overture/issues/505) | Running-state module (**B4** server, **M4**), `changesOf` try/catch, nav unread threads (**M3**), PDF magic bytes | `main` | DeepSeek (`deepseek-v4.1-flash`) | **High** — `YES, MERGE NOW` |
| **T4** | [#506](https://github.com/a-hagi613/overture/issues/506) | Drizzle migration `0058` (4 hot-path indexes), SQLite pragmas, `vacuum-app-db.ts`, paged `/api/threads`, 12m timeout | `main` *(holds mig `0058`)* | DeepSeek (`deepseek-v4.1-flash`) | **High** — `YES, MERGE NOW` |
| **T5** | [#507](https://github.com/a-hagi613/overture/issues/507) | Merge `origin/main` into PR #501 (resolve 4 conflicts), add route redirects & `/home` manifest/notify URLs (**H5**), clean 29 orphans | PR #501 (`canvas-design-implementation-agents`) | DeepSeek (`deepseek-v4.1-flash`) | Merge `--merge` into #501 |
| **T6** | [#508](https://github.com/a-hagi613/overture/issues/508) | **B2** Board truthful drag/archive + withdraw approved; **B3** Ready Approved list + Undo/unapprove, rollback, honest copy, **M6/M9** | PR #501 *(after T5)* | Neon (`gemini-4-neon-high`) | `YES, MERGE NOW` |
| **T7** | [#509](https://github.com/a-hagi613/overture/issues/509) | **B4** UI Home Resume gate; **H1** UI portal switch; **H7/H7b** Support Access & Legal cards; **M2** Search debounce; **M3** SSE map | PR #501 *(after T5)* | Neon (`gemini-4-neon-high`) | `YES, MERGE NOW` |
| **T8** | [#510](https://github.com/a-hagi613/overture/issues/510) | **M5** `/api/support` + `support_tickets` DB (`0059`); **H6** server `calendar_custom_events`; **M1** drop `upNext` from `/api/home` | PR #501 *(after T4+T5)* | DeepSeek (`deepseek-v4.1-flash`) | **High** — `YES, MERGE NOW` |
| **T9** | [#511](https://github.com/a-hagi613/overture/issues/511) | Route-level `React.lazy()` + Vite chunks (cut 2.3 MB JS bundle) + React Query `staleTime` tuning | PR #501 *(after T5)* | Neon (`gemini-4-neon-high`) | `YES, MERGE NOW` |
| **ADM-1** | [#512](https://github.com/a-hagi613/overture/issues/512) | Owner-only Admin link, `/admin` host redirect/handoff, provisioning check script & docs | `main` *(after T2)* | DeepSeek / Neon | `YES, MERGE NOW` |
| **ADM-2** | [#513](https://github.com/a-hagi613/overture/issues/513) | Support Tickets Queue (`/admin/support` + API + Overview badge) | *(after T8)* | DeepSeek + Neon | `YES, MERGE NOW` |
| **ADM-3** | [#514](https://github.com/a-hagi613/overture/issues/514) | System Health, SQLite/WAL/Storage Monitor, WAL Checkpoint API & Live Checks UI (`/admin/system`) | `main` | DeepSeek + Neon | `YES, MERGE NOW` |
| **ADM-4** | [#515](https://github.com/a-hagi613/overture/issues/515) | Background Job Queue & Dead-Letter Inspector (`/admin/jobs` + retry/cancel API) | `main` | DeepSeek + Neon | `YES, MERGE NOW` |
| **ADM-5** | [#516](https://github.com/a-hagi613/overture/issues/516) | Live Attempts, Browser Replay & LLM Spend Dashboard (`/admin/attempts` & `/admin/llm` using existing APIs) | PR #501 / `main` | Neon (`gemini-4-neon-high`) | `YES, MERGE NOW` |
| **ADM-6** | [#517](https://github.com/a-hagi613/overture/issues/517) | Searchable Audit Log (`/admin/audit`), Launch Readiness Controls, Alerts Feed, React Query `useAdminResource` | *(after ADM-1..5)* | DeepSeek + Neon | `YES, MERGE NOW` |

```
Wave 1 (Parallel on main):  T1(#502)   T2(#503)   T3a(#504)   T3b(#505)   T4(#506, mig 0058)
Wave 1B (On PR #501):       T5(#507, merge main + H5 + orphans)
                                │
        ┌───────────────────────┼───────────────────────┬──────────────────────────┐
        ▼                       ▼                       ▼                          ▼
Wave 2 (On #501):           T6(#508)                T7(#509)                   T9(#511)
        │                                               │
        └────────► after T4+T5: T8(#510, mig 0059) ◄────┘
                                │
Wave 3 (Admin):             ADM-1(#512)  ADM-3(#514)  ADM-4(#515)  ADM-5(#516) ──► ADM-2(#513) ──► ADM-6(#517)
                                │
Final Gate:                 Full-stack E2E + Live Prod Smoke Test + Ops Provisioning
```

---

## 5. Manual Production Ops & Launch Checklist (After Code Lands)

1. **Provision `admin.tryoverture.com` (see [admin-portal-plan-2026-11-23.md](admin-portal-plan-2026-11-23.md)):**
   - Add Cloudflare proxied `CNAME admin.tryoverture.com -> overture-web.fly.dev`.
   - Issue Fly cert: `flyctl certs add admin.tryoverture.com -a overture-web`.
   - Create Cloudflare Zero Trust Access application (`admin.tryoverture.com`, allow only owner email).
   - Set Fly secrets: `CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_JWKS_URL`.
2. **Enable Phone Alerting:**
   - Set Fly secret `ALERT_NTFY_URL` (`flyctl secrets set ALERT_NTFY_URL=... -a overture-web`) so `raiseAlert` reaches the owner's phone.
3. **Reclaim 1.6 GB `app.sqlite` Bloat:**
   - During a quiet 1-minute maintenance window after T4 deploys, run `scripts/vacuum-app-db.ts` (checkpoint WAL + `VACUUM` `app.sqlite`) and verify `/api/health` Litestream lag = 0s.
4. **Update Stripe Portal Default URL & Clean Cloudflare Worker Route:**
   - Re-run `bun run scripts/setup-stripe.ts` after T3a merges (updates Stripe Customer Portal `default_return_url` to `/profile/billing`).
   - Delete stale `tryoverture.com/pricing*` Cloudflare Worker route if still attached in Cloudflare dashboard.
   - Verify Cloudflare Email Routing rule for `hello@tryoverture.com` → owner mailbox.
5. **Tune Multi-User Concurrency & Open Public Sign-Up:**
   - Confirm `settings['llm.model']` is unset or `claude-haiku-5-5`.
   - Raise `browser.max_concurrent_sessions` from `1` → `5` (or `10`) in `/admin/settings`.
   - Complete the owner 5-application live smoke test (full pipeline: sign-up/auth → onboarding → match → approve → Browser Use send → inbox reply → billing portal).
   - Flip `PUBLIC_SIGNUP_ENABLED = "true"` in `fly.toml` and deploy.
