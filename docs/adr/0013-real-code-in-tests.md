---
status: accepted
---

# Tests run real code; only the network edge is intercepted

Every external dependency sits behind a port, and domain code imports ports only. Tests do not replace any of them
with hand-written stand-ins: they run the production adapters. Where a real local equivalent exists, tests use it
(SQLite, a local Chrome filling saved ATS forms served by the fixture server, a disk object store, the real signed
inbound-mail endpoint). Third-party HTTP APIs (Anthropic, Cloudflare Email Sending, Browser Use's control API, the ATS feeds, push
services, the FX feed, Stripe) are intercepted at the network by MSW, inside the app process, with
`onUnhandledRequest: "error"` and responses recorded from the real service. Stripe is the exception: its calls go to
`stripe-mock`, Stripe's own local API server, and the webhooks it answers are signed with the test webhook secret, so
the adapter, the signature check and the response shapes are Stripe's own code rather than our idea of it. MSW is
pinned to 2.x: 3.x intercepts nothing under Bun, and a CI check fails if a request to an unmocked host gets through. Time comes from the real clock adapter,
whose offset tests can move through a test-only route that is not mounted in production. Moving the clock does not
fire timers, so a second test-only route runs every job that is due, and code waiting for mail is woken when mail
arrives rather than by polling alone.

What this cannot catch (an employer changes a form, Browser Use is blocked, Haiku's output drifts, mail stops
arriving) is caught by **daily live checks** on `overture-web`: real forms filled and stopped before Submit, a small set
of real Haiku calls, a real mail loop through Cloudflare Email Sending to an Overture-owned check address, and a real R2
round trip. Each check alerts on failure and refreshes the saved forms and recordings the tests replay. None submits
an application or touches a user.

End-to-end Playwright tests are the standard, driving only what a user, an admin or a webhook touches. Unit tests
exist only for the forty-eight files SPEC §16.2 lists: ledger, crypto, planner, the restored-database check (a restored file is read
only, refuses outbound calls and leaves `bg_jobs` untouched, #412), tag rules, question normalisation, answer
derivations, the answer planner (a salary Fact kept per currency is chosen only for the currency a question names),
the facts model (a Fact's scope is validated against its key), the onboarding step's salary and EEO reading, the
fixture sanitiser (recorded pages must carry no script, event handler, personal data or token), the v1
answer-bank mapping, the live-traffic guard (in test and development, an outbound request to an ATS or
paid-service host is refused), the replica listing (the newest transaction is read from the first non-empty
Litestream level, so a healthy replica costs one R2 list per read, #281), the job worker's wait (a completed wait
retains no abort listener), the job worker's class limits (`queue.test.ts`, `scheduler.test.ts`: a browser or LLM
lane already at its limit is left out of the claim, so a fast control or notification job behind older stalled rows
still runs, the total in-flight cap bounds one claim, and the `bg_jobs` claim is planned through the partial
`bg_jobs_claim_due` index rather than scanning the lifetime history, #425), the browser session alignment
(`session-slots.test.ts`: the dispatcher's free-send count comes from the same process-wide semaphore every browser
user holds a slot from, so a capture holding the last session offers a send no slot and no Application waits in
`sending`, #425), the event-loop lag monitor (a late timer tick reports how long the loop was blocked, once
per cooldown, so a paused main thread becomes a log line), the copy guard (no canvas annotation — `fig. N`, `folio`, `§`, a section ordinal — is
a copy string or key), the trusted client IP (only the header Fly's proxy stamps is believed; a forged
`x-forwarded-for` never sets Turnstile's `remoteip` or the auth limiter's key), the onboarding location plan (the
open-Posting group-by is planned through the covering `postings_open_location` index, never a table scan or a
temporary b-tree, #337), the SQLite handle guard (a file
in `src/` or `test/` that opens a `new DatabaseSync` also configures `PRAGMA busy_timeout`, or is a documented opt-out
in `scripts/database-sync-guard.ts`, so an unconfigured handle cannot stall `main` with `SQLITE_BUSY` again), the
monthly mail budget (`budget.test.ts`: one row per UTC month counts every send by kind and fails closed, notices stop
at the sign-in reserve while sign-in mail and the live check may spend it, each stop is stamped once in its own column
so the reserve alert never hides the cap alert, and the count survives reopening the database, #282), the billing
pause (a plan end or a failed payment pauses once with its own reason, a successful payment resumes only a billing
pause, and an in-flight send keeps its reservation across the period end so only a sent Application is charged), the
billing webhook's transaction (a pause notice and the planner/prep jobs a resume queues commit with the Stripe event
and roll back with it, a stale out-of-order failure cannot pause a paid user, and a price Overture does not sell
grants nothing), the Anthropic model and its batch prices (`models.test.ts`: `ANTHROPIC_MODEL` defaults to the model SPEC §8.6 names,
a dated 5.5 model id is priced from the exact 5.5 row rather than the 4.5 haiku prefix, and a model with no price row
is refused, #387), the Personio form reader (a server-rendered form's fields, required star, documents and
unsupported controls are read without a browser), the provider and cost report (completion and cost divide
distinct attempted Applications, so a failure-then-success retry counts once and an email-confirmed send counts as
completed, while attempt counts and page-confirmed sends stay diagnostics, #417), the email receipt match
(`outcomes.test.ts`: a Confirming Application is charged only by the one message that names its employer and role
unambiguously, one message confirms at most one Application, and a replayed message never commits a second credit,
#413), the account erasure plan (`erase.test.ts`: the vendor profile ids, R2 prefixes and confirmation target are
written before the user row goes, the confirmation is queued only after both external deletes confirm clean, a
failure retries without consuming a job attempt, and a restart resumes the cleanup from the plan, #415), the Anthropic
batch record (`batch-store.test.ts`: one request set is recorded once, its results are claimed by one conditional
update so every later caller reads them back, and a failed record reopens for one resubmission, #418), the batch
results fetch (`anthropic-batches.test.ts`: the api key is sent only to the configured api origin, never to another
origin named by a provider response, #418), the catalog snapshot (`applications.test.ts`: an Application copies the
Posting's and Company's display fields onto its own row when it is created, keeps them after the catalog rows are
deleted, and is not created for a Posting that has already left the catalog, #422), the catalog split migration
(`migration-snapshot.test.ts`: migration `0056_snapshot_decouple` backfills that copy onto every existing Application,
including readable placeholders when the catalog row is already gone, and leaves `applications`, `matches`,
`posting_user_state` and `skip_companies` with no foreign key into `postings` or `companies`, #422), the catalog
split (`catalog-split.test.ts`: `litestream.yml` replicates only `/data/app.sqlite`, a catalog write transaction never
holds `app.sqlite`'s write lock, deleting and recreating `catalog.sqlite` leaves every user and Application row intact,
and a closed Posting a crashed sweep never reported is still reconciled; the browser half is
`test/e2e/catalog-split.test.ts`, where an approval and `/api/health` answer while a real catalog write lock is held,
#423), the admin gate's
fail-closed parsing (a malformed Access cookie or a missing team domain answers 401, never a 500 or an invented
issuer), the capped request-body reader (an unauthenticated webhook body stops at its byte cap and is never buffered
whole, so a sender cannot choose how much memory it costs), the unhandled-rejection alert (a public alert carries the
error type and count only, never the arbitrary message that can hold personal data or a token), the hot read paths
(#430: the user key is read once per request however many values it opens and a forget is not undone by a read already
in flight, the Inbox Thread list and an Application's linked mail read their messages in one query rather than one per
Thread, the open Review list and a Board's email notes read their rows in one query rather than one per Review or per
Application, the Ready cards open every approved plan in one query rather than one per card, an empty timezone change
takes no write, and Home's billing strip is one grants read plus one ledger read; each test counts the statements
through the real drizzle query logger and grows the row count to prove the count stays flat), the unit-test
allowlist (`lint-config-guard.test.ts`: every path the allowlist names exists, and every unit test file in `src/` or
`scripts/` is named, so a deleted test cannot leave a stale entry), and the workflow Bun pin
(`workflow-config-guard.test.ts`: every `oven-sh/setup-bun` step pins the version `package.json` requires). They
import `bun:test`, run with `bun test src scripts`, and keep the Vitest lint plugin, whose test-shape rules do not
depend on the runner. The mail count runs the real SQLite file and the real migrations, so the invariant is exercised
against the shipped schema rather than a stand-in. CI stays under two minutes on pull requests: six shards balanced by
per-file time, and a pull request runs only the e2e files its committed reach map says its diff can reach, with
everything unclassified running the full suite. Main always runs all of them. No sleeps, no retries, no lowered
timeouts.

## Considered Options

- Hand-written fakes for every port: fast, but they test our idea of the service rather than the service, and drift silently. Banned by Landmines `no-test-doubles`.
- Real third-party services in every test run: slow, costly, flaky, and would touch employers.
- A unit-heavy suite (v1: about 118 files): tested implementation rather than behaviour.
