# Backend and contract audit against the new front end (2026-11-23)

The owner asked for a production-readiness audit of the back end with the new front end as the base: are the right
numbers shown to the right user, do the API responses have the shape the SPA expects, and do job search, applying,
the browser, billing, security, the database, performance and scalability work.

## What was audited

- **Base:** the uncommitted front-end rebuild in the `bonefish` worktree (branch
  `a-hagi613/canvas-design-implementation-agents`, on `6a0601e4`, 235 changed files, no commits, no upstream, no pull
  request). It was copied, unchanged, onto `a-hagi613/backend-audit-on-bonefish`. The 10 commits `main` has gained
  since `6a0601e4` (pricing $9.99 / $29.99, the MSW replacement, ops scripts) were checked for conflicts: only
  `bun.lock` conflicts.
- **Live contract check:** the snapshot's server was booted in test mode on an isolated database. A fresh owner
  (empty state) and the seeded demo account (fictional data) were signed in, and every GET the SPA makes was parsed
  with the SPA's own Zod schemas, plus 37 Application details and 6 Inbox threads.
- **Production probes:** read-only, signed-out requests to `https://tryoverture.com`, and the names-only output of
  the `Ops live` workflow.
- **Checks:** one `bun run verify` on the snapshot (through `heavy`).

## Verdict

The back end is in good shape. The API contracts hold, user scoping holds, and the billing ledger, webhooks,
encryption and backups are solid. Do not ship the new front end yet: it has four launch blockers and several bugs
that make the UI say something different from what the server did. Three security gaps are live in production
today, independent of the new UI.

| Area | State |
|---|---|
| API contracts (Zod ↔ server) | **Pass.** 29 GET endpoints, 37 Application details and 6 threads parse with the SPA's schemas, for both the fresh owner and the demo account |
| Per-user scoping | **Pass.** Every user-data query filters on the session user; 0 of 10 cross-user Application reads returned anything but 404 |
| Job search (catalog) | **Working.** Production has 20,345 company boards and 2,788 open Postings; the sweep runs every 60 s over 20 boards (a full cycle in about 17 h); Workable ingests from the R2 snapshot |
| Applying (prepare, approve, dispatch) | **Server correct, UI wrong.** Dispatch gates on running, demo, suspension, resume, mailbox, Applications left and the daily cap. The new Board and Ready screens misreport what happened (B2, B3) |
| Browser | **Working, throttled.** `browser.provider = browser_use`, one concurrent session; the Personio and Workable sends are behind engaged kill switches while their probes wait |
| Billing | **Mostly solid.** Signed webhooks, an idempotent ledger, reconciliation and the trial fingerprint are good. Duplicate subscriptions are possible (H1), and `limits.daily_cap = 2` cannot deliver the plans being sold (H2) |
| Security | **Three live gaps:** settings and kill switches are readable signed out, the event stream replays broadcast events to anyone (H3), and every per-IP limit sees Cloudflare's IP (H4) |
| Database | **Solid.** Two SQLite files (ADR 0036), Litestream replication healthy (lag 0 s at the probe), migrations at boot, `db:verify` green |
| Performance and scale | Fine for the current users; three hot spots listed under M1 to M3 |
| Checks | `verify`: 6 of 7 pass; **lint fails with 242 errors, all in the new landing components**. About 39 e2e files still drive the removed routes or Home at `/` (H8) |

## Launch blockers

### B1. The landing page shows invented numbers and real brands as customers

- `src/web/components/landing/landing-live-counter.tsx:4` starts at `42_819` and adds one every 3.4 s under
  "jobs applied through Overture". Production has 21 Applications.
- `company-brands.tsx` and `landing-hero-stack.tsx` show Stripe, Nike, Airbnb, Shopify, Air Canada, Spotify, HSBC,
  Tata, Emirates and others with their logos, and hero cards that read like real applications to them ("Stripe ·
  Financial Planning Analyst · 8:35 am · Greenhouse").

This is a false claim and an implied endorsement. **Fix:** delete the counter, or feed it a real, server-side count.
Replace the brand logos with fictional employers, or label the cards plainly as examples.

### B2. Archive and drag on the Board can lie, and an "archived" approved Application still sends

`src/web/routes/board.tsx:96` (`moveCardToLane`) moves the card locally and shows "Moved X to Closed" for any status.
It calls the server only when `canMoveApplicationToStage` allows it (status `sent`, or `preparing` / `needs_review`
to Applied or Queued). `handleArchive` (`board.tsx:178`) uses the same path. Archiving an **Approved** Application
therefore changes nothing on the server, and it is sent at its slot. There is also no `onError`: a 409 leaves the card
in the wrong lane after a success toast.

**Fix:** never move a card the server did not move. For Ready and Approved cards, Archive must call
`POST /api/applications/:id/withdraw` (Skip). Disable the drop for any status the server refuses, and roll back with
`copy.board.moveFailed` on error.

### B3. The Ready page hides Approved Applications and reports sends that did not happen

`src/web/routes/ready.tsx`:

- `:59` keeps only `status === "ready"`. Approved cards vanish, and nothing in the new UI calls
  `POST /api/applications/:id/unapprove` (`useUnapprove` has no caller). The Glossary and ADR 0029 promise "it can be
  undone until sending starts". After B2, a user has **no working way to stop an Approved send**.
- `:104` approves with no `onError`. On `plan_changed` (409) the card is already removed and the toast said
  "Application sent to X" (`copy.ts:1833`). Approve-all ignores `refused[]` the same way. An Approval is not a send:
  the copy should say it is scheduled.
- `:133` Skip's Undo only puts the card back on screen. The withdraw has already gone to the server, so the card
  comes back as Ready but is Withdrawn.
- `:72` shows `sentToday + removedIds.length`, so skipping three cards reads "3 of 2 sent today".

**Fix:** list Approved cards with their send time and an Undo (unapprove). Roll back on error, and show refused
items. Use honest copy ("Scheduled for 10:40"). Make Skip's Undo either wait before calling the server or call a real
restore. Show the server's `sentToday`.

### B4. Any pause can be "resumed" from Home, which clears billing and onboarding pauses

`src/web/components/home-control-band.tsx:54` offers Resume for every paused state, and posts `{running: true}`.
`POST /api/running` (`src/server/routes/home.ts:677`) accepts it for any `pauseReason`. It sets
`pauseReason = null`, `running = true`, and queues the planner and the Daily run. A user paused for `plan_ended`,
`payment_failed` or `onboarding` sees "Auto-apply is active" while dispatch blocks every send
(`applications_left`). The toast's Undo then writes `pauseReason = "user"`, which erases the billing reason.

**Fix (server first):** `POST /api/running {running:true}` returns 409 with the reason unless the current reason is
`null` or `user`. **UI:** show Resume only for `user`; for other reasons show the banner's fix link.

## High

### H1. A subscribed user can buy a second plan (double billing)

`POST /api/billing/checkout` (`src/server/routes/billing.ts:118`) never checks for an existing subscription.
Profile → Billing (`profile-billing.tsx:254`) shows **Choose** on the other plan to a subscribed user, which opens a
second Checkout and creates a second Stripe subscription. **Fix:** refuse with 409 `plan_active` when
`currentSubscriptionOf` is not ended, and send switches to the portal (already "Manage in Stripe" on the current
card).

### H2. The production daily cap cannot deliver the plans being sold

Production has `limits.daily_cap = 2` (testing phase). Week sells 50 over 7 days (more than 7 a day) and Month sells
250 over 30 days (more than 8 a day). At 2 a day, a Week buyer can use at most 14 and the rest expire. **Fix before
taking money:** raise the cap to at least 10 (the code default) or sell what the cap allows. Home's "x of 2 sent
today" is correct, but it is also the number that will make paying users ask.

### H3. Settings, kill switches and the event stream are readable signed out (live in production)

`src/server/routes/api.ts`:

- `GET /api/settings` (`:97`) and `/api/settings/:key` return every operational setting. The probe got 34 keys,
  including the LLM spend caps, the ATS hourly limits, the crowd limits, the send window and the browser provider.
- `GET /api/kill-switches` (`:114`) returns every switch with its reason.
- `GET /api/events` (`:71`) accepts no session. The hub (`src/server/platform/sse/hub.ts:60`) delivers every
  `userId = null` row to every subscriber, and replays from `Last-Event-ID`. A signed-out client sending
  `Last-Event-ID: 0` received about 4,000 `job.started` / `job.done` events in 4 s. `raiseAlert` publishes
  `alert.raised` with `userId = null`, so owner alerts (`billing.mismatch`, `llm.spend`, `process.unhandled`, kill
  switches) would reach every visitor and every user.
- `GET /api/search` (`:35`) is signed out and unthrottled. It is also unused now that `/search` is gone.

**Fix:** require a session on `/api/events`. Deliver only rows for that user, publish alerts per owner, and bound the
replay (for example the last 200 rows or 10 minutes). Delete `/api/settings`, `/api/settings/:key` and
`/api/kill-switches` (the web never calls them; the admin has its own). Gate `/api/search` behind a session and a
limit, or remove it with the Search page.

### H4. Every per-IP limit sees Cloudflare's IP, not the visitor's

`tryoverture.com` is proxied by Cloudflare in front of Fly (`server: cloudflare`, `via: 1.1 fly.io`).
`src/server/auth/client-ip.ts:24` trusts only `Fly-Client-IP`, which is the Cloudflare edge address. The magic-link
limit (3 per 15 minutes), demo sign-in (3 per 15 minutes), social (10 per 15 minutes), the global auth limit and the
public sign-up limits are therefore shared by everyone who reaches the same Cloudflare edge. At launch the fourth
person in a city to ask for a sign-in link within 15 minutes is refused. **Fix:** when `Fly-Client-IP` is in
Cloudflare's published ranges, use `CF-Connecting-IP`. Otherwise keep `Fly-Client-IP`. Test both paths.

### H5. Removed routes break links that are already out

The rebuild removes `/`-as-Home (Home is `/home`), every `/settings/*` path, `/pricing`, `/search` and
`/inbox/address`, with no redirects (the old route table had three). Links that will 404 or land on the marketing
page:

- Mail already sent: export-ready (`/settings/export`), billing notices (`/settings/billing`, `/settings/billing/plans`),
  the delete re-auth link (`/settings/delete`), and Stripe sessions created before deploy (`/settings/billing/plans?billing=…`).
- Still generated now: push and in-app notifications with `url: "/"` (`src/server/platform/alerts.ts:52`,
  `src/server/notify/billing-notice.ts:82`), and the PWA `start_url: "/"` (`public/manifest.webmanifest:5`). Both
  open the marketing page instead of Home.
- In-app: `/profile#profile-address` (`code-paste-sheet.tsx`) and `/profile#profile-strengthen`
  (`home-strengthen.tsx`). `/profile` redirects to `/profile/resume`, the hash is lost, and both sections live on
  `/profile/details`.

- Stripe: the portal configuration's default return URL is `/settings/billing` (`scripts/setup-stripe.ts:434` on
  `main`). The app's own portal sessions pass `/profile/billing`, so this only bites a portal opened from a Stripe
  email, but the script also verifies the old URL on every run (`:462`).

**Fix:** add `Navigate` redirects for every removed path, and point notifications and the manifest at `/home`. Fix
the two anchors. Change the portal default in `setup-stripe.ts` and re-run it.

### H6. Custom Calendar events live only in one browser

`src/web/lib/calendar-custom-events.ts:3` stores interviews, follow-ups and reminders the user adds in `localStorage`
under one fixed key, not per account. Another person signing in on the same browser (the owner and the demo, for
example) sees them. They are absent from other devices, the `.ics` feed, Export and Erasing, and Home's "Schedule"
card (which reads `/api/calendar`) never shows them. **Fix:** store them server-side per user, with the feed, Export
and Erasing, or remove the "add event" feature until it can be stored.

### H7. The Support access log is gone from the UI

ADR 0015 promises that a Reveal is "shown to the user under 'Support access'". The rebuild deletes
`settings-support-access.tsx` and `support-access-api.ts`; `GET /api/support-access` still exists but nothing calls
it. **Fix:** restore it on Profile → Account, or change ADR 0015 and the Privacy page first.

### H8. The e2e suite still drives the removed routes, so CI will be red

The rebuild changed five e2e files (`demo-account`, `layout-guards-sweep`, `route-sweep`, and the new `support` and
`workspace-search`). The rest of the 191 still assume the old shell:

- 16 files open `/settings/*`, `/pricing`, `/search` or `/inbox/address`, for example `settings-billing`,
  `settings-submenu`, `settings-support-notifications`, `settings-time-language-board`, `board-match-settings-delete`,
  `export`, `delete-account`, `signout`, `legal-consent`, `calendar-ics`, `landing-pricing`, `catalog-search` and
  `catalog-search-filters`.
- 23 files open `/` after signing in and expect Home; a signed-in visitor at `/` now gets the landing.
- `test/e2e/marketing-worker.test.ts:78` asserts `/pricing?utm_source=test` matches a Worker route. With the
  snapshot's `src/shared/marketing-paths.ts` the only pattern is `tryoverture.com/`, and `matchesMarketingRoute`
  returns `false` (checked by running it).

These were not run locally (browser suites run in CI); the counts come from the files. Under the merge rules, a red
e2e shard blocks the merge. **Fix:** move each test to the new path (or to the redirect once H5 lands), drop the
`/pricing` assertion, and delete the tests of removed pages (`landing-pricing`, `catalog-search*`) with them.

## Medium

- **M1. `/api/home` computes data nobody reads.** `upNext` (`home.ts:673`) runs the full candidate ranking: it
  decrypts Facts and evaluates every Posting in the pool. It runs on every Home load, and on every SSE event, because
  each topic invalidates `["home"]`. `readyToSend` duplicates `ready.ready`, and `remainingToday` is unused (and wrong
  when Applications left is below the cap). Remove all three, or render them.
- **M2. Workspace search decrypts on every keystroke.** `useWorkspaceSearch` (`workspace-search-dialog.tsx:56`) has
  no debounce. Each character is a request that opens up to 500 messages × 3 fields. Debounce 250 ms on the client;
  on the server, a smaller scan bound or a per-user limit.
- **M3. Live updates miss pages.** `useLiveUpdates` never invalidates `["ready"]`, `["threads"]` or `["thread", id]`,
  so new Ready Applications and new mail appear only on refocus. `useMarkRead` does not invalidate `["nav"]`, so the
  Inbox badge stays stale after reading. The two "unread" counts also differ in unit: the nav counts unread
  **messages** (`nav.ts:40`), the Inbox counts unread **threads** (`threads.ts:180`).
- **M4. The `no_resume` and `no_mailbox` pauses are never written.** Dispatch blocks on them
  (`dispatch.ts:238`, `:248`), but no code sets `profiles.pause_reason` to either. A user whose resume or mailbox is
  gone sees "Auto-apply is active" and nothing sends. Write the reason when dispatch first blocks on it, and clear it
  when the fix lands.
- **M5. The Support route breaks the shared API conventions.** `src/server/routes/support.ts:57` uses `zValidator`,
  not `validJson`, so a bad body does not return the `{error: "invalid_request", issues}` contract (#470). It also
  re-implements `readSession`. `SUPPORT_EMAIL` defaults to `hello@tryoverture.com` (`env.ts:118`), but the address
  documented for the owner's tester is `admin@tryoverture.com`. SPEC §3.3 says `hello@` is forwarded to the owner by
  Email Routing; confirm that rule exists in Cloudflare before Support goes live. Add the user's address as `Reply-To`.
- **M6. Words the Glossary forbids are in the new copy.** The Board lane "On hold" (`copy.ts:1859`; "Hold" is
  banned, ADR 0020). "Auto-apply is active" / "Pause auto-apply" contradict ADR 0029: nothing applies until the user
  approves. "Application sent to X" on Approval (B3).
- **M7. Copy and legal text still point at Settings.** The Terms say "cancel at any time from Settings"
  (`copy.ts:853`), and the export mail says "Open Settings in Overture" (`copy.ts:524`). Changing the Terms text may
  need a new consent or terms version.
- **M8. The demo account cannot open Billing.** `GET /api/billing` returns 403 `demo_locked` for `role = demo`, so
  the new Profile → Billing shows its error state in the showcase account. Let GET through (it reads only), or render
  the demo with sample plan data.
- **M9. The Board drops Interviewing and Offer as columns.** Five lanes (On hold, Ready, Applied, Waiting, Closed)
  replace the seven Stages. Dropping a card on "Waiting" always writes `screening`, so an Interviewing or Offer card
  that is dragged out of Waiting and back comes back as Screening. Interviewing and Offer are still settable from the card's Move menu. The
  Stage model is unchanged; the docs now say the Board groups it (Glossary, SPEC).

## Low

- `GET /api/threads` returns every thread with decrypted subjects and has no paging. It is fine now; page it before
  heavy users.
- `changesOf` in `src/server/routes/ready.ts` calls `JSON.parse` without a guard. A corrupt row would fail the
  whole Ready page with a 500.
- Home's greeting and date use the browser's clock and zone, not `home.timeZone`.
- About 29 web files have no importer after the rebuild (for example `home-kpis.tsx`, `home-billing-notice.tsx`,
  `running-switch.tsx`, `board-column.tsx`, `calendar-month-grid.tsx`, `board-sheet-match.tsx` and
  `turnstile-config.ts`). Delete them with the rebuild, together with their `test/e2e/reach-map.json` entries.
- The out-of-applications and invite-grant-ending notices no longer render on Home (`home-billing-notice.tsx` is
  orphaned). The data is still in `/api/home` (`applicationsLeft`, `endingGrant`, `planApplications`).
- The admin screens load data with `useEffect` (`src/web/lib/admin-resource.ts`), not React Query. They work, but
  get no caching, retry or refetch.

## Lint: what blocks the push

`bun run verify` on the snapshot: format, typecheck, unit tests, build, lint config and `db:verify` pass. Lint fails
with 242 errors, all under `src/web/components/landing/` and `src/web/routes/landing.tsx`:

| Rule | Count |
|---|---:|
| `react(jsx-no-literals)` (copy must live in `src/shared/copy.ts` / `marketing-copy.ts`) | 131 |
| `react(jsx-max-depth)` | 83 |
| `react(no-multi-comp)` | 17 |
| `jsx-a11y(prefer-tag-over-role)` | 7 |
| `typescript(consistent-return)` | 2 |
| `react(only-export-components)`, `react(exhaustive-effect-dependencies)` | 1 each |

The pre-push hook runs `verify`, so the branch cannot be pushed as it is. That is also why it has no pull request.

## What is good

- **Contracts.** Every GET the SPA makes matches its Zod schema for both empty and seeded data. New shared schemas
  (`src/shared/workspace-search.ts`, `support.ts`, `dossier.ts`, `consent.ts`) are the right direction.
- **Scoping.** User data is read through the session user; personal fields go through `personal.openFor(userId, …)`;
  cross-user detail reads return 404.
- **Send gates.** The planner requires running and a Verified email. Dispatch adds demo, suspension, resume, mailbox,
  Applications left, the daily cap, ATS hourly limits, crowd limits and kill switches. Approval seals a plan hash and
  re-checks it, so a changed plan is refused.
- **Billing.** Webhooks are signature-checked, size-capped and idempotent by event id. Ledger reserve, commit and
  release are paired. Reconciliation runs daily. The trial card is an HMAC fingerprint.
- **Ops.** Production health, Litestream lag, the sending-domain DNS, and the presence of every required secret are
  checked by `Ops live`. CI and Deploy are green on `main`.

## Architecture: where to deepen (codebase-design vocabulary)

1. **One contract module per endpoint.** Today the server builds JSON against local interfaces and the web
   re-declares a Zod schema by hand. The live check passed, but only CI e2e and this audit would catch drift. Move each
   response schema to `src/shared/api/<area>.ts`, have the route `satisfies z.input<typeof schema>`, and have the web
   parse with the same schema. The interface (one schema) is small, and both sides get locality. The Dossier, consent
   and workspace-search schemas already follow this pattern.
2. **A running-state module.** `POST /running`, `billing/pause.ts`, `onboarding-start.ts`, `admin.ts` and
   `account/erase.ts` all write `running` and `pause_reason` directly, and two reasons are never written (M4). One
   module (`pause(userId, reason)`, `resume(userId)` that refuses non-user reasons, `blockedBy(userId)`) would own the
   transitions, and B4 and M4 could not recur.
3. **One mutation helper on the web.** Ready, Board and the Home control band each hand-roll optimistic updates,
   toasts and Undo, and each has the same bug: success shown before the server answered, no rollback. A
   `useOptimisticAction({apply, call, undo})` with rollback on error and refusal-aware toasts would fix B2, B3 and B4
   in one place.
4. **The SSE topic map in one place.** Which topics invalidate which query keys is spread between `live-events.ts`
   and each `*-api.ts`. One table (topic → query keys), owned by the event module, would close M3 and make the
   per-user delivery rule (H3) testable.

## Docs updated in this branch

- `docs/SPEC.md`: the navigation and screen list after the rebuild (Home at `/home`, Profile sub-pages, Support,
  sign-up, workspace search, Board lanes), the removed Pricing and Search pages, the Settings references, and the
  marketing Worker serving only `/`.
- `DESIGN.md`: the component stack, the navigation, the Board lanes, the page-title italic rule, the layout table,
  and §13 rows for the screens the rebuild built ahead of the canvas. The three places the build uses orange against
  §2 are written down as undecided, not accepted.
- `GLOSSARY.md`: the duplicate **Free trial** and **Plan** entries merged, **Board lane** added, "Auto-apply" and
  "On hold" added to the words to avoid.
- `README.md`: the stale "walking skeleton" line.
- `docs/DEPLOY.md` and `workers/marketing/README.md`: the marketing Worker route list (only `/`), the leftover
  `/pricing*` route to delete in Cloudflare, and the Stripe portal default return URL.
- `docs/adr/0037-front-end-rebuild-component-stack-and-navigation.md` (proposed): the dependency, route,
  navigation and Board-lane decisions the rebuild made without an ADR, with the open items that must close first.
- The doc changes `main` gained since `6a0601e4` (the $9.99 / 50 and $29.99 / 250 prices, DEPLOY's new sections) are
  merged into `SPEC.md`, `GLOSSARY.md` and `DEPLOY.md` here, so these files rebase onto `main` cleanly.
