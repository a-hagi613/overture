---
status: accepted
---

# The job catalog lives in its own SQLite file

This amends ADR 0002 with a second database file on the same Fly volume:

- `/data/app.sqlite` (`DATABASE_PATH`, `synchronous=FULL`, migrated from `drizzle/`) holds everything a person owns or
  billing depends on: users, sessions, invites, facts, profiles, resumes, applications, application snapshots and
  events, mail, notifications, grants, the ledger, subscriptions, `bg_jobs`, `settings`, `questions` and
  `question_variants`. Litestream replicates this file to R2 continuously, and the weekly restore drill restores it.
- `/data/catalog.sqlite` (`CATALOG_DATABASE_PATH`, defaults to `catalog.sqlite` beside the application file,
  `synchronous=NORMAL`, migrated from `drizzle-catalog/`) holds the public job catalog: `companies`, `company_boards`,
  `postings`, `posting_tags`, `posting_questions`, the retired `supply_facets` rollup and the `postings_fts`
  index with its triggers. It is **excluded from `litestream.yml`**.

## Why

The catalog sweep writes hundreds of thousands of public rows while the application serves approvals, webhooks and
`/api/health`. In one file those writes take the single write lock, so user work waits behind `synchronous=FULL`
fsyncs of data nobody owns. The catalog is also the wrong thing to replicate: at 340k+ postings the 1 s Litestream
interval streams far more to R2 than the user data that actually needs a backup, and every feed sweep can rebuild it.

## Rules this creates

- **No foreign key crosses the files.** A catalog table never references `app.sqlite`, and no application table
  references the catalog. `applications`, `matches`, `posting_user_state` and `skip_companies` keep `posting_id` and
  `company_id` as plain logical ids; an Application carries its own immutable display copy of the Posting and Company
  (ADR 0035). `posting_questions.question_id` names a `questions` row without a foreign key, and the join happens in
  code.
- **No transaction spans both files.** When the sweep closes Postings it returns their ids with the run summary, and
  the application process skips the unsent Applications in `app.sqlite` afterwards (see `catalog/closed-postings.ts`).
  Approval, dispatch and post-close paths close the catalog row and the Application row in two separate transactions.
- **The catalog is disposable.** A missing or deleted `catalog.sqlite` is normal startup work: boot creates and
  migrates the file, the seed and board feeds repopulate it, and no user row, Application, Board, Ready or Inbox item
  moves. The restore drill never restores it.
- **Writes stay in the sweep worker.** The `no-main-thread-catalog-writes` lint rule still confines catalog table
  writes to `sweep-worker.ts` and its documented non-sweep paths.
- **Old closed rows are pruned in bounded chunks.** The hourly `maintenance.retention` job owns catalog growth: a
  Posting closed more than 30 days loses its compressed description, and one closed more than 90 days is deleted with
  its tags, questions and `postings_fts` entry (the foreign keys cascade and the table's trigger removes the index
  row). Each phase writes at most 20 chunks of 500 rows per run so no single write lock is held long, and the next
  run continues. A Posting any unsent Application still points at is left for the next sweep to reconcile, and nothing
  in `app.sqlite` is written: an Application keeps its own snapshot.
- **The `/api/supply` rollup was derived, never authoritative (retired).** `supply_facets` used to be rebuilt from
  the open apply-supported Postings at the end of an ETL/snapshot pass before the file was sealed, and the active
  snapshot is read-only. A snapshot that predates the rollup fell back to the live indexed count. The landing preview
  and the endpoint were removed, so nothing rebuilds or reads the rollup; the table stays in an older file only so it
  still opens.

`scripts/verify-db.ts` verifies both files in one run: `app.sqlite` is WAL, `synchronous=FULL`, STRICT, still contains
no catalog table and no catalog foreign key; `catalog.sqlite` is WAL, `synchronous=NORMAL`, STRICT, has every catalog
table and the `postings_fts` index; both migration journals are strictly increasing.

## Rollout

This is a single-machine cutover, so no dual-write window is needed: the deploy stops the old process, `0057` drops the
catalog tables from `app.sqlite`, the new process creates `catalog.sqlite` empty, and Litestream keeps replicating
`app.sqlite` alone. Existing catalog rows are not migrated — they are feed data. The operator re-runs the documented
seed import once (`scripts/load-discovered-boards.ts --db /data/app.sqlite`, which now writes the catalog file beside
it) and the normal sweep resumes; the daily Workable ingest also rebuilds its own boards. Until then the boot log says
the catalog is empty.

Migrations here, like `0056`, are forward-only. A rollback to the previous image would need the pre-split `app.sqlite`,
which Litestream holds, because `0057` dropped the catalog tables it expects; the catalog itself is always rebuilt.
Each sweep also reconciles any closed Posting an earlier crashed run left with an unsent Application, so the id handoff
between the files is a fast path rather than the only path.

## Considered Options

- **Keep one file and shrink writes.** The sweep would still own the lock during its largest transactions, and the
  Litestream cost stays.
- **Move the catalog to another service (Postgres/Meilisearch).** Another network hop and bill for data no person
  owns, against ADR 0002's scale argument.
- **Restore `catalog.sqlite` from backup.** It is public, rebuildable feed data; a restore would only replay a stale
  catalog over a fresh one.

## Amendment (2026-11-26, issue #700)

The Stapply feed catalog this ADR describes is retired. When freehire became the only job source (#700), the shared,
deduplicated `jobs` and `job_places` tables moved to `app.sqlite`, next to the pull state and the counters that write
them. They are written at runtime by the production job worker, are small (a paged pull, not a 340k-row sweep), and
every user reads the same rows, so putting them in the replicated user database keeps one writer and one migration
chain instead of adding a second file to keep in step.

`catalog.sqlite` and its `postings`-shaped tables stay untouched and read-only until #706 removes them; no new code
writes that file. The retirement of the separate catalog database and its snapshot/hot-swap is #706's change, not
this one.

## Amendment (2026-11-27, issue #706)

The Stapply publication path is gone: the off-box DuckDB ETL, the signed
`/internal/catalog/{refresh,snapshot,classification-cache}` relay, the R2 snapshot
hot-swap, its manifest reader and the classification cache were removed with their
tests, workflows and scripts. `catalog.sqlite` is now opened locally on every boot
with no alternative source.

The **file itself stays, as a read-only legacy read model**, because live readers
still answer from it for rows that predate freehire: the Matcher's stored-match
fallback (`matching/matches-page.ts`, `matching/new-matches.ts`), preparation and
review for Applications created against a catalog Posting, dispatch liveness, the
demo seed, and the admin
storage/system reports. Every new Application is created from a freehire `jobs` row
and carries its own display snapshot, so no new user data depends on
`catalog.sqlite`. Removing those readers, and then the file, is a separate change
once no catalog-backed Application remains.

## Amendment (2026-11-27, issues #742 and the live-jobs removal)

`/api/supply` counted the open, apply-supported freehire `jobs` and `job_places`
rows in `app.sqlite` (ADR 0047), with the reader's non-job exclusion, freehire
category, canonical place ids and `remote` flag, grouped by ATS `system`. The
`catalog.sqlite` count and its `supply_facets` rollup were retired first: the count
helper and rollup builder were removed, nothing rebuilds or reads the rollup, and
the `supply_facets` table stays in the legacy file only so an older `catalog.sqlite`
still opens and passes `bun run db:verify` unchanged. The landing preview and the
public `/api/supply` endpoint were then removed, because jobs are pulled per user
on demand and a global "open jobs" count is misleading; `src/server/jobs/supply.ts`,
`src/shared/supply.ts`, `src/server/routes/supply.ts` and `src/web/lib/supply-api.ts`
are gone. The legacy file still answers the stored-match fallback,
preparation/review/dispatch for catalog-backed Applications, the demo seed and the
admin reports.

## Amendment (2026-11-27, issue #710)

The onboarding matches, picks and the preparation/Review question list now read freehire `jobs` in `app.sqlite`, so a
new Application really is created from a freehire row rather than from a catalog Posting:

- Onboarding's match list (`onboarding/freehire-matches.ts`) reads the stored freehire scores and displays the job
  row; `onboarding_picks` snapshots those fields, and a pick saves only a freehire job id.
- `pipeline/prepare.ts` reads the posting through one `postingFor` lookup: the catalog first, then `jobs`. For a
  freehire job the board token and ATS job id come from `external_id`, and the description, places, URL and apply URL
  come from the job row itself.
- A freehire job's form questions are stored in the new `job_questions` table in `app.sqlite`, keyed by the freehire
  posting id with no foreign key into the catalog. `catalog.sqlite`'s `posting_questions` stays the store for a
  catalog-backed Application during the transition.
- `openAttemptReviews` reads the Application's own snapshot (`ats`, `companyName`) instead of the catalog, so a form
  field found during a send still opens a Review after the catalog is gone.

No catalog mirror and no second job source are introduced.
