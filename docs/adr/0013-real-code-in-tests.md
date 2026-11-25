---
status: accepted
---

# Tests run real code; only the network edge is intercepted

Every external dependency sits behind a port, and domain code imports ports only. Tests do not replace any of them
with hand-written stand-ins: they run the production adapters. Where a real local equivalent exists, tests use it
(SQLite, a local Chrome filling saved ATS forms served by the fixture server, a disk object store, the real signed
inbound-mail endpoint). Third-party HTTP APIs (Anthropic, Cloudflare Email Sending, Browser Use's control API, the ATS feeds, push
services, the FX feed, Stripe) are intercepted at the network edge inside the app process by a Bun-native
interceptor (`src/server/platform/outbound-interception.ts`). It wraps `globalThis.fetch` and the `node:http` and
`node:https` `request`/`get` transports, answers from handlers whose responses are recorded from the real service, and
fails closed: a request to any host no handler mocks and that is not a loopback fixture rejects with
`UnhandledRequestError` before it reaches the network. There is no opt-out option such as MSW's
`onUnhandledRequest`; failing closed is the only mode. The interceptor's canary
(`src/server/platform/outbound-interception.test.ts`) fails if a fetch or a node `https` request to an unmocked host
does not reject with that error, so a leaked request cannot hide behind a DNS failure. MSW was removed because 3.x
intercepted nothing under Bun and its 2.x pin held the whole suite to an old mechanism. Stripe is the exception: its
calls go to `stripe-mock`, Stripe's own local API server, and the webhooks it answers are signed with the test webhook
secret, so the adapter, the signature check and the response shapes are Stripe's own code rather than our idea of it.
Time comes from the real clock adapter,
whose offset tests can move through a test-only route that is not mounted in production. Moving the clock does not
fire timers, so a second test-only route runs every job that is due, and code waiting for mail is woken when mail
arrives rather than by polling alone.

What this cannot catch (an employer changes a form, Browser Use is blocked, Haiku's output drifts, mail stops
arriving) is caught by **daily live checks** on `overture-web`: real forms filled and stopped before Submit, a small set
of real Haiku calls, a real mail loop through Cloudflare Email Sending to an Overture-owned check address, and a real R2
round trip. Each check alerts on failure and refreshes the saved forms and recordings the tests replay. None submits
an application or touches a user.

End-to-end Playwright tests are the standard, driving only what a user, an admin or a webhook touches. Unit tests
exist only for the eighty-one files SPEC §16.2 lists: the sent Dossier (`src/shared/dossier.ts`: the file is sent
as-is only when the sent hash equals the stored resume hash, a Fact is named only when the snapshot recorded its key,
and a "did not happen" line appears only when the stored data proves it), ledger, crypto, planner, the
restored-database check (a restored file is read
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
`bg_jobs_claim_due` index rather than scanning the lifetime history, #425), the catalog retention prune
(`retention.test.ts`: a Posting closed more than 30 days loses its description and one closed more than 90 days is
deleted with its tags, questions and FTS entry in bounded chunks, while a Posting an Application still waiting to send
points at is held and no Application row or snapshot changes, #424), the browser session alignment
(`session-slots.test.ts`: the dispatcher's free-send count comes from the same process-wide semaphore every browser
user holds a slot from, so a capture holding the last session offers a send no slot and no Application waits in
`sending`, and an unset, zero or negative `browser.max_concurrent_sessions` caps nothing while a positive value still
queues, #425, #515), the browser provider's Kernel mode and cleanup and its image trim (`kernel.test.ts`,
`proxy-trim.test.ts`: a session is headless unless a bot block escalates it to stealth, every close deletes the
session even when the usage read fails, a generic image is aborted while a CAPTCHA host's image still loads, and the
font, media and tracker blocks stay), the daily preparation stagger (`daily-prep.test.ts`: each user's slot is
deterministic inside 05:00-07:30 local time and a stored `prep.run_local_time` overrides it), the event-loop lag monitor (a late timer tick reports how long the loop was blocked, once
per cooldown, so a paused main thread becomes a log line), the copy guard (no canvas annotation — `fig. N`, `folio`, `§`, a section ordinal — is
a copy string or key), the trusted client IP (only the header Fly's proxy stamps is believed; a forged
`x-forwarded-for` never sets Turnstile's `remoteip` or the auth limiter's key), the signed-in event stream
(`hub.test.ts`: a subscriber receives only rows addressed to that user and never an unscoped row, and a reconnect
from zero or a very old cursor replays at most the newest 200 rows, #502), the owner alert fan-out (`alerts.test.ts`:
`alert.raised` is written once per owner and delivered to no regular user, #502), the admin alerts feed and launch readiness snapshot (`admin-alerts.test.ts`: owner alert notifications stay owner-scoped, active kill-switch/dead-job/mail-cap/backup-lag problems surface accurately, acknowledgements are idempotent, and daily-cap/browser-concurrency setting bounds are enforced, #517), the searchable admin audit log (`audit/index.test.ts`: action/actor/targetUserId/text filters avoid wildcard injection and composite timestamp-id cursors paginate deterministically across tied timestamps, #517), the per-user search limit
(`rate-limit.test.ts`: one fixed window allows the maximum then refuses with `rate_limited`, and each key counts
alone, #502), the host match
(`host-match.test.ts`: a host matches only its own domain or a real subdomain of it, after trimming, lower-casing and
dropping a trailing root dot, so `evilgreenhouse.io` never matches `greenhouse.io`), the onboarding location plan (the
open-Posting group-by is planned through the covering `postings_open_location` index, never a table scan or a
temporary b-tree, #337), the SQLite handle guard (a file
in `src/` or `test/` that opens a `new DatabaseSync` also configures `PRAGMA busy_timeout`, or is a documented opt-out
in `scripts/database-sync-guard.ts`, so an unconfigured handle cannot stall `main` with `SQLITE_BUSY` again), the
monthly mail budget (`budget.test.ts`: one row per UTC month counts every send by kind and fails closed, notices stop
at the sign-in reserve while sign-in mail and the live check may spend it, each stop is stamped once in its own column
so the reserve alert never hides the cap alert, and the count survives reopening the database, #282), the billing
pause (a plan end or a failed payment pauses once with its own reason, a successful payment resumes only a billing
pause, and an in-flight send keeps its reservation across the period end so only a sent Application is charged), the
running-state transitions (Resume and Pause never replace a billing, setup, suspension or dispatcher hold, and only
the same no-resume or no-mailbox hold clears when its prerequisite returns), the Ready change list (a corrupt value
degrades to an empty list rather than a 500), the PDF header check (only `%PDF-` in the first kilobyte passes, so a
spoofed MIME type cannot pass HTML as a resume), the
billing webhook's transaction (a pause notice and the planner/prep jobs a resume queues commit with the Stripe event
and roll back with it, a stale out-of-order failure cannot pause a paid user, a price Overture does not sell
grants nothing, an older subscription event cannot regress a newer one, and `invoice.paid` promotes a failed status
and wakes Home), the per-Application variable cost (`application-cost.test.ts`: the sending try's browser spend is the
base, every other attempted try lands in retry cost so a retry never double counts a send, a second refresh writes
nothing, the person's Application-purpose model spend is split across their completed Applications without losing a
micro, and only measured Applications inside the window are averaged, #570), the active paying-subscriber count
(`budgets.test.ts`: overlapping paid periods count one person once, trial and admin grants never count, and the count
is planned through the covering `grants_paying_subscribers` index rather than the grants table, #570), the Stripe adapter's line choice (a basil invoice reads its subscription from
`parent.subscription_details` and a Week to Month proration reads the new plan's line), the checkout coordinator
(concurrent double clicks share one Checkout Session and one Stripe idempotency key), the admin billing list (the
owner's filter and page run in SQL and the stat counts agree with the page), the preparation status guard (a result
written after the user approved the Application matches no row instead of overwriting a newer status), the Anthropic model and its batch prices (`models.test.ts`: `ANTHROPIC_MODEL` defaults to the model SPEC §8.6 names,
a dated 5.5 model id is priced from the exact 5.5 row rather than the 4.5 haiku prefix, and a model with no price row
is refused, #387), the Personio form reader (a server-rendered form's fields, required star, documents and
unsupported controls are read without a browser), the Wave 1A form readers (`wave1a-forms.test.ts`: Breezy's
`#portal-data` questionnaire and the Softgarden, ClearCompany, JOIN and Pinpoint HTML forms are read with their
labels, options, file slots, board-namespaced signatures and apply URLs, #569), the provider and cost report (completion and cost divide
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
#423), the Stapply classifier (`classification-key.test.ts`, `stapply-fields.test.ts`,
`esco-taxonomy.test.ts`, `classifier.test.ts`, `haiku-classifier.test.ts` and `classification-cache.test.ts`: the
classification key preserves seniority and level while dropping gender markers and a trailing location, the Pass-2
dedupe never collapses two same-board openings, the baked ESCO v1.2.1 dataset carries the Administrative roles, the
three tiers and the Haiku strict-JSON contract behave, and a corrupt, missing or version-mismatched cache is an empty
cache, #628), the role taxonomy bridge (`legacy-roles.test.ts`: every retired category, Level-2 role and subrole maps
to a real role or category id, an ambiguous old category is never guessed onto a tag, a vague old role only reaches a
broad role, and level words such as `Senior` or `II` do not hide a role's name), the role taxonomy rewrite and
matching (`taxonomy-tags.test.ts`, `role-targets.test.ts` and `judge-input.test.ts` over a real migrated catalog and
the committed label seed: a label writes ids, `JUNK` clears the role, a title naming one exact role overrides a label
outside its subcategory, a second pass changes nothing, a role target never reaches a neighbour role, and the scorer
reads the description and the targets, #660), the admin gate's
fail-closed parsing (a malformed Access cookie or a missing team domain answers 401, never a 500 or an invented
issuer), the capped request-body reader (an unauthenticated webhook body stops at its byte cap and is never buffered
whole, so a sender cannot choose how much memory it costs), the unhandled-rejection alert (a public alert carries the
error type and count only, never the arbitrary message that can hold personal data or a token), the hot read paths
(#430: the user key is read once per request however many values it opens and a forget is not undone by a read already
in flight, the Inbox Thread list and an Application's linked mail read their messages in one query rather than one per
Thread, and a page walks every Thread once even when timestamps tie while the counts stay over every Thread, the open Review list and a Board's email notes read their rows in one query rather than one per Review or per
Application, the Ready cards open every approved plan in one query rather than one per card, an empty timezone change
takes no write, and Home's billing strip is one grants read plus one ledger read; each test counts the statements
through the real drizzle query logger and grows the row count to prove the count stays flat), the live match count
(`src/server/profile/targets.test.ts`: a cached count equals a fresh handle across filters that differ only in order,
case or duplicates, a same-connection write and a sweep-worker connection's WAL write both invalidate it, the store
stays bounded, the count query probes `posting_tags` by its primary key rather than scanning it, and 25 interleaved
filter changes stay under 500ms p95 while catalog writes run, #426), the unit-test
allowlist (`lint-config-guard.test.ts`: every path the allowlist names exists, and every unit test file in `src/` or
`scripts/` is named, so a deleted test cannot leave a stale entry), the apply-alias generator (`src/shared/apply-alias.test.ts`: a handle is the first and last name in
lowercase ASCII, never a reserved system local part or its first dot-label, and a new plan uses the alias or the
sign-in email rather than the editable email Fact, #566), the failure-recovery link and the plain-English sweep
(`src/shared/http-url.test.ts` and `src/shared/plain-english.test.ts`: a link is kept only for an absolute
`http:`/`https:` URL, so a stored `javascript:` or `data:` value never becomes a Couldn't apply button, and no
user-facing copy outside the legal pages and the admin portal says Facts, Personal Details, Invite grant,
Sent via … or Waiting on a Review, #592), the personal-email preference
(`src/server/profile/apply-email.test.ts`: it defaults to the assigned alias, saves with a `profile.updated`
announcement, and a read-only check provisions no mailbox, #566), the sending-domain zone lookup
(`src/server/platform/mail/sending-domain.test.ts`: a notify subdomain resolves the zone that owns its parent, an
explicit zone id answers without a request, and a domain with no owning zone fails clearly, #566), the design-token lint pattern
(`design-scale-guard.test.ts`: every arbitrary `text-[…px]`/`text-[…rem]`, `text-lg`…`text-9xl` and off-scale
spacing utility is rejected, while the nine typography tokens, the 4px scale and layout widths pass), the theme boot
CSP hash (`src/shared/security-headers.test.ts`: the inline boot script in `index.html` hashes to the SHA-256 admitted
by the app's `script-src` and the marketing `_headers`, so the landing is themed without an origin request and a policy
edit cannot drift from the file), the live topic
map and the billing poll cap (`src/web/lib/live-events.test.ts` and `src/web/lib/billing-poll.test.ts`: every
dedicated topic — billing, mailbox and profile — refreshes its own queries while its older alias keeps working, and
the Checkout-return poll stops when the plan arrives, when the page was not a Checkout return, or at its cap), and
the workflow Bun pin
(`workflow-config-guard.test.ts`: every `oven-sh/setup-bun` step pins the version `package.json` requires), the
hot-path indexes (`hot-path-indexes.test.ts`: the SSE catch-up, event retention, message-by-person,
application-by-status and grant-ledger queries are planned through `events_user_seq`, `events_created_at`,
`messages_user_created`, `applications_user_status` and `grants_user_starts`, #506), the application-database
vacuum (`vacuum-app-db.test.ts`: a fragmented file is compacted to a zero freelist with `integrity_check` ok, a dry
run changes nothing, and the script refuses without `--confirm` or while another writer holds the lock, #506), the
compaction driver (`vacuum-fly.test.ts`: the dry run's printed sizes parse into file, WAL, freelist and page numbers,
and a file whose freelist is below the 50 MB threshold is skipped unless the operator forces the run, so the weekly
job cannot stop the app for nothing), the compaction workflows (`workflow-config-guard.test.ts`: the ops action and
the Sunday job dry-run before they compact, the manual job honours its `dry_run` input, and the maintenance
entrypoint runs the script with `--confirm`), the support request schema (`support.test.ts`: a subject carrying a
carriage return or line feed is refused before any mail is built, and the subject and message are trimmed), the mail
subject sanitiser (`cloudflare.test.ts`: a support subject with line breaks is flattened to one line with its
`Reply-To` kept, driven through a loopback Email Sending endpoint so the real sender runs), the system report's Stripe
mode (`report.test.ts`: a restricted `rk_live_`/`rk_test_` key names the same live/test mode as an `sk_` key, and any
other key is unconfigured), and
the interception canary (`outbound-interception.test.ts`: a fetch or node `https` request to an unmocked host rejects with
the interceptor's own error while a mocked host still answers, so a request that leaks fails instead of reaching DNS),
and the OTel bounds and redaction (`telemetry/otel.test.ts`: an `http.url` loses its query string and fragment, metrics
export every 60 s, the span and log queues carry fixed bounds, and no metric instrument names a high-cardinality
identifier, #580). They
import `bun:test`, run with `bun test src scripts`, and keep the Vitest lint plugin, whose test-shape rules do not
depend on the runner. The mail count runs the real SQLite file and the real migrations, so the invariant is exercised
against the shipped schema rather than a stand-in. CI stays under two minutes on pull requests: one to twelve shards
sized by the plan's measured load (a full run takes twelve), and a pull request runs only the e2e files its committed
reach map says its diff can reach, with everything unclassified running the full suite. Main always runs all of them,
and the nightly run records the timings and the reach map from the full suite. No sleeps and no lowered timeouts; CI
retries a failed Playwright test once with its trace recorded on the first retry and stops a shard after ten failures,
while a local run never retries and keeps the trace of a failure.

## Considered Options

- Hand-written fakes for every port: fast, but they test our idea of the service rather than the service, and drift silently. Banned by Landmines `no-test-doubles`.
- Real third-party services in every test run: slow, costly, flaky, and would touch employers.
- A unit-heavy suite (v1: about 118 files): tested implementation rather than behaviour.
