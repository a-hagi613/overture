# Tests and bugs sweep, 2026-11-21 (issue #302, lane: tests)

Audit only in this file. Measured on `origin/main` 7f62ff5, the CI history of that day, and targeted
Playwright runs. Scope: every main user flow mapped to an e2e that walks it as a fresh user through
the real UI, plus the tests that failed in CI.

## Method

- Read the flow routes (`src/web/main.tsx`), the flow tests, ADR 0013 and ADR 0023.
- Pulled every failed CI run of the day (`gh run view --log-failed`) and grouped the failures by test.
- Reproduced the planner race with a local 60-run probe of the same sequence (3 failures, 0 after the
  fix), then ran the affected e2e files through `heavy`.
- Did not touch files owned by open PRs (#298 #300 #301 #303 #304 #306 #307 #311).

## Flow coverage

A flow counts as covered only when the test drives the real UI from a fresh user; seeding through the
test-only routes is fine.

| Flow | e2e | Walks the real UI? |
|---|---|---|
| Sign-up | `signup-flow.test.ts` (form, mail, verification in the browser, sign-in), `password-auth.test.ts:99` (form, verify screen, resend) | Yes |
| Sign-in (magic link, Google, LinkedIn, password) | `signin.test.ts:13-114`, `password-auth.test.ts:123` | Yes |
| Password reset | `password-auth.test.ts:123` | Yes |
| Onboarding (resume, Facts, What you want) | `onboarding-flow.test.ts`, `onboarding-facts.test.ts`, `onboarding-targets.test.ts`; full flow in #311 | Yes; step 5 does not exist yet (#217) |
| Ready / approve / undo / skip / send all / edit | `ready-page.test.ts:38`, `approval.test.ts`, `first-send.test.ts`, `send-outcomes.test.ts` | Yes |
| Board (drag, keys, phone swipe, archive) | `board-interactions.test.ts` | Yes |
| Inbox | none on main; `inbox.test.ts` in #301 (`/inbox` is a placeholder on main) | Blocked on #301 |
| Profile (resume, facts, targets, skip list, address) | `profile-resume.test.ts`, `profile-strengthen.test.ts`, `profile-targets-ui.test.ts`, `board-match-profile.test.ts` | Yes |
| Settings (limits, time/language, account, sign out everywhere) | `signin.test.ts:221`, `profile-targets-ui.test.ts:201`, `settings-and-kill-switches.test.ts` | Yes |
| Notifications (list, mark one/all, PWA, push) | `notifications.test.ts:126` | Yes |
| Search | `catalog-search.test.ts:75` | Yes |
| Admin (invites, grants, suspension, settings, catalog, audit, passkey) | `admin-users.test.ts`, `admin-grants.test.ts`, `admin-actions.test.ts`, `admin-catalog.test.ts`, `admin-gates.test.ts`, `admin-passkey.test.ts`, `admin-visual.test.ts` | Yes |

No main flow is left without a browser walk after this sweep. Inbox stays blocked on #301; until it merges
`/inbox` is a placeholder and the sidebar links to it.

## Ranked findings

Severity: P1 breaks CI or a user flow; P2 flakes; P3 coverage only.

### F1, P1: the kill timeout does not stop the process, so a server teardown can hang forever

- `src/server/main.ts:616-634`. The `KILL_TIMEOUT_MS` timer calls `server.stop(true)` and
  `sdk.shutdown()` but never exits. If the telemetry flush or a worker does not settle, the process
  outlives the timeout indefinitely.
- Evidence: main went red on 2026-11-21 13:27 (run 44908909814). `onboarding-facts.test.ts:229` passed
  every assertion and failed with `Tearing down "onboardingServer" exceeded the test timeout of
  30000ms`. The test then kills the process from outside.
- Fix: the last-resort timer must end the process. Keep the graceful path (abort, stop, drain, flush)
  and exit explicitly after it; add one second of grace after `KILL_TIMEOUT_MS` so `worker.drain`
  can still requeue an in-flight job.
- Test: `test/e2e/shutdown-hard-stop.test.ts`, a server pointed at a collector that accepts and never
  answers must exit within the grace window.

### F2, P2: `ready-page` asserts a string that is in both the answer and its open textarea

- `test/e2e/ready-page.test.ts:96`. `getByText(edited)` also matches the `<textarea>` that still holds
  the draft when the refetch wins the race, so Playwright's strict mode fails.
- Evidence: run 44910425782, shard 1, `strict mode violation ... resolved to 2 elements`, the answer
  `<p>` and the edit `<textarea>`.
- Fix: wait for the edit form to close, then assert the paragraph with `exact: true`.

### F3, P2: `admin-users` asserts a grant line that now exists twice

- `test/e2e/admin-users.test.ts:117`. The invited email already has a grant row without an expiry;
  the new 5-application grant adds a second row, and `getByText("email · granted")` matches both.
- Evidence: run 44909799839, shard 4, `strict mode violation ... resolved to 2 elements` (one row
  with, one without `· expires`).
- Fix: assert that the number of matching grant rows grew by one, which is the actual behaviour under
  test, instead of matching a prefix shared by both rows.

### F4, P1: the planner strands an approved Application when a slot lands at the end of the window

- `test/e2e/pacing-and-gates.test.ts:520` (the assertion at 564, `firstSlot > 0`),
  `src/server/dispatch/planner.ts`. Two approved Applications are seeded and a `planner.day` job runs;
  one comes back with `scheduledFor === null`.
- Evidence: failed in two shards within four minutes on 2026-11-21 (runs 44911022850, 44910562326),
  always line 564 with `Received: 0`; every other pacing test around it passed.
- Root cause, reproduced with a local 60-run probe (3 failures): approving the first Application wakes
  a planner, which picks one random time in the remaining window. When that time falls inside the last
  twenty minutes before 20:00, the second Application has nowhere to go; the planner's one-window
  `planSlots` call returns zero slots and the Application stays `scheduledFor = null` until the next
  midnight planner. The logs from the failing runs show `approved 2, needsSlot 1, remaining 9,
  slots 0`.
- Fix: after today's window, keep planning the leftover approvals into the following windows (up to a
  year) at `limits.daily_cap` per day, in approval order. That is SPEC §9.2's "leftovers roll to
  tomorrow's planning", done when the approval happens instead of silently at midnight.
- Test: the existing spacing e2e now cannot flake, and
  `pacing-and-gates.test.ts` adds a deterministic case: `limits.daily_cap = 1`, two approvals, and both
  get a slot, one today and one in tomorrow's window.

### F5, P3: sign-up is not walked through verification into the app

- `password-auth.test.ts:99` covers the form, the verify screen and the resend, then opens the
  verification link with an API request. A user who verifies in the browser and lands on the app is not
  exercised.
- Fix: `signup-flow.test.ts`: fresh server, the sign-in screen, "Create an account", email and
  password, the sent mail, the link in the browser (which verifies and signs the user in), Home, then a
  clean browser context signs in with the new password. It checks the user is verified, the credential
  account is linked and each context holds one session.

### F6, P3: `bg_jobs` dedupe races produce an unhandled rejection

- `src/server/platform/jobs/queue.ts:276-327` inserts with `onConflictDoNothing`; when the conflict
  is with a row that is already `running`, the partial index no longer covers it, the insert succeeds,
  and the fallback lookup still only finds `queued` rows, so it returns an id that does not exist.
- Evidence: `unhandledRejection: SQLiteError: UNIQUE constraint failed: bg_jobs.dedupe_key` on main,
  run 44908909814. It did not reproduce in isolation; the connection is synchronous and the partial
  index behaves in a probe.
- Fix: give the enqueue path one explicit conflict target and a deterministic existing-row lookup, and
  add a test that enqueues the same key while the first job is running.

## Handed to other sweeps (not this lane)

- #311 changes `onboarding-step.ts` so a new user's currencies come from the busiest open Posting
  countries. On that branch `onboarding-targets.test.ts:117` now gets GBP instead of CAD. The test
  belongs to #311's diff context; it must assert the new, intended currency.
- #303's `export.test.ts:238` shells out to `unzip`, which the Playwright CI image does not have.
  Either install it in the image or read the zip in Bun. Not this lane.
