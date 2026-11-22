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
  `postings`, `posting_tags`, `posting_questions` and the `postings_fts` index with its triggers. It is **excluded from
  `litestream.yml`**.

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
