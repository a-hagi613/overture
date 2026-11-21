# Scalability and performance review (issue #183), 2026-11-21

Reviewed `main` at 43df456. **Static analysis only.** Nothing was run against production (ADR 0016) and nothing heavy ran locally, so there are no latency, RSS or throughput numbers. Capacity figures below are estimates from the code, marked as such. Finding 8 proposes the measurement pass that should replace them before the beta wave.

Target: one `shared-cpu-2x` / 2 GB Fly machine, SQLite WAL, `synchronous=FULL`, Litestream at 1 s (`fly.toml`, `litestream.yml`, ADR 0002). M2 is about 10 users; M3 is hundreds.

## Verdict

M2 (10 users) fits with large headroom. Nothing breaks at 10 users except slow disk growth. The things that hit first on the way to hundreds are, in order: unbounded tables (events, bg_jobs), per-request full-catalog scans on the Home route, and per-connection SSE polling on the single JS thread. Browser Use slots (3 by default) cap throughput long before the database does, by design (10 sends a day per user, ADR 0010).

## Ranked findings

### 1. High: `events` is never purged, and every job writes global events
- Evidence: `purgeOldEvents` is defined at `src/server/platform/sse/stream.ts:31` and has no caller outside tests (`rg purgeOldEvents` finds only the definition). Retention constant `RETENTION_MS` (24 h) is dead.
- Every job run publishes `job.started` and `job.done` with `userId` null (`src/server/platform/jobs/queue.ts:28-47`), and there are 73 `publishEvent` call sites. Null-user events are delivered to every connected client (`stream.ts:82-84`).
- Impact: the table, the WAL and the Litestream replica grow forever; each SSE client also receives every job event on the box (fan-out multiplies with users). The dispatch tick and sweep jobs run every few seconds to minutes, so this is steady growth even with no users.
- Fix: call `purgeOldEvents` from a singleton hourly job (delete in chunks of `WRITE_BATCH_ROWS`); stop publishing `job.started`/`job.done` globally (or scope them to admin); add `created_at` index for the purge.

### 2. High: Home and score-on-open run the full candidate pool per request
- Evidence: `routes/home.ts:703` calls `matching.upNext`, which calls `candidates.ranked` (`matching/score.ts:591`, same at `:426`). `ranked` runs `pool()` (all open postings joined to companies, filtered by tag `EXISTS` subqueries, `matching/candidates.ts:372-420`) and then `evaluatePosting` in JS over every row (`:758-768`). Rows carry location, salary and tags for the whole pool; only the top 6 are used.
- `filterContext` also loads **every application of every user** (`crowdRows`, `candidates.ts:~466-472`, no `where`) just to compute per-posting and per-company crowd counts.
- Impact: cost is O(open postings in the user's targets) + O(all applications) per Home load, synchronous on the single event loop (bun:sqlite is sync). With a catalog of tens of thousands of postings and hundreds of users, a Home load becomes tens to hundreds of ms of blocked event loop, and parallel loads queue behind each other and behind SSE, health and sends.
- Fix: (a) replace `crowdRows` with two grouped SQL aggregates restricted to the pool's posting ids or cached for 60 s; (b) cache `upNext` per user for a short TTL and invalidate on targets change or catalog sweep; (c) longer term, precompute candidates per user in a job (`codebase-design`: one deep `CandidateIndex` module behind the current `ranked`/`check` interface).

### 3. Medium: `bg_jobs` rows are never deleted and the claim query has no usable index
- Evidence: no `delete(bgJobs)` anywhere in `src`. The only index is the partial unique `bg_jobs_dedupe_key_queued` (`platform/db/schema.ts:114-118`). `claimDueJobs` filters on `status`, `run_at`, `locked_until` and orders by `priority DESC, run_at` (`queue.ts:~137-148`) every poll (15 s, `scheduler.ts:9`) and on every enqueue notification.
- Impact: each poll is a full table scan that gets slower with every done job; scan time is proportional to lifetime job count, not queue depth. Also each `enqueueJob` wakes the loop (`registerEnqueueNotify`), so bursts trigger many scans.
- Fix: index `(status, run_at)` (partial `WHERE status IN ('queued','running')`); purge `done` rows older than 7 days and `dead` older than 30 days in the same hourly maintenance job as finding 1.

### 4. Medium: SSE polls the database once per second per connection
- Evidence: `createSseStream` sets `setInterval(poll, 1000)` per client (`stream.ts:132`), each poll a `select ... where seq > ? and (user_id is null or user_id = ?) order by seq limit 100` on the main thread.
- Impact (estimate): 1 query/s per open tab. 10 users is negligible; 300 users with 1.5 tabs is about 450 queries/s, a few percent of one core, but it also adds latency to every other request because all of it is on the loop. Combined with finding 1 each query also returns more rows than needed. Event latency is up to 1 s.
- Fix: one shared poller (one query per tick, or notify in-process from `publishEvent`), dispatching to per-user subscriber sets. In-process notify removes the 1 s latency too. Also add `user_id` to a composite index if the table stays large.

### 5. Medium: sweep worker and main thread write the same SQLite file
- Evidence: `catalog/sweep-worker.ts:17` opens its own `openDatabase`; board polls write in transactions of `POSTINGS_PER_CHUNK` rows (`catalog/poll-board.ts:399`) and close-missing in one transaction (`:244`). SQLite allows one writer; `busy_timeout` is 5 s (`platform/db/client.ts:20`) with `retryWhenBusy` 12 attempts (`platform/db/busy.ts:6-8`).
- Impact: with `synchronous=FULL` each commit fsyncs; a large board poll holds the write lock for its chunk. User-facing writes (approve, profile save, job bookkeeping) wait up to 5 s plus retries when the sweep is busy. Today sweep batches are capped at 20 boards per ATS per run (`sweep-config.ts:14`), so contention is bounded but grows with catalog size and the Workable ingest.
- Fix: chunks are already small (`POSTINGS_PER_CHUNK = 50`, `poll-board.ts:28`); the gap is that `closeMissingPostings` should chunk by id; consider `synchronous=NORMAL` for the catalog connection only (WAL is still durable across process crashes, loses at most the last commits on power loss, and the catalog is re-derivable from feeds). Log write-lock wait time as a metric so admin can see contention.

### 6. Medium: missing indexes on `applications`
- Evidence: indexes are `(user_id, posting_id)` unique, `(user_id, company_id)`, `(user_id, sent_at)` plus a partial unique on `user_id where status='sending'` (`schema.ts:~785-795`). There is no index on `posting_id` or `status`.
- Queries that miss them: dispatch free-slot count `where status = 'sending'` (`dispatch/dispatch.ts:~357`), crowd counts per posting (finding 2), and the cascade delete when a posting is removed (`posting_id` foreign key without an index scans `applications` per deleted posting).
- Fix: `index("applications_posting").on(postingId)` and a partial `index on (status) where status in ('sending','confirming','approved','ready')`.

### 7. Low: browser capacity is a fixed small number and concurrency settings disagree
- Evidence: `dispatch/browser/session-slots.ts:6` defaults to 3 concurrent sessions per process; `dispatch/dispatch.ts:51` defaults `browser.concurrency` to 10. Sessions time out at 15 min (`executor.ts:57`).
- Impact: with 10 pending sends the dispatcher marks up to 10 as in flight while only 3 hold a browser; the rest wait on `acquireBrowserSession` (`executor.ts:563`) with their application already `sending`, which pins the per-user "one sending" unique index and delays pacing. Throughput ceiling is about 3 sessions x 4 sends/hour/slot, roughly 12 to 20 sends an hour, or about 150 to 250 a day, i.e. enough for 15 to 25 users at 10 a day each if they sent uniformly. Real demand is bursty (08:00 to 20:00 window, ADR 0010), so M3 needs more slots or Browser Use plan changes long before the DB limits.
- Fix: make `browser.concurrency` and `browser.max_concurrent_sessions` one setting; do not mark an application `sending` until the slot is acquired; show slot occupancy in admin; confirm the Browser Use plan's concurrent-session cap.

### 8. Low: no measurements or load harness exist
- Evidence: `/api/health` does `select 1` and reads the backup monitor (`routes/health.ts:11-15`), which is cheap and fine; but there is no latency histogram, no event-loop-lag metric, no RSS or WAL-size gauge, no job-lag metric (`now - run_at` of the oldest queued job), and no SSE connection count.
- Fix: add those five gauges to the existing telemetry module and the admin health card; add a local, non-network benchmark script (synthetic catalog of 50k postings, 300 users) behind `heavy`, so findings 2, 4 and 5 can be measured before M3.

### 9. Low: Fly sizing
- Evidence: `fly.toml` `shared-cpu-2x`, 2 GB. One Bun process plus a worker thread plus Litestream plus Playwright CDP clients (remote browsers, so light).
- Impact (estimate): RSS is dominated by SQLite page cache, the sweep worker and the feed payloads held during board polls. 2 GB is fine for M2. `shared-cpu` throttles after burst credit, which will show up as sweep and Home latency spikes at M3; moving to `performance-1x` is the cheap vertical step. Deploys cost 10 to 30 s downtime (ADR 0002), unchanged.

## What is already fine

- WAL with `busy_timeout` and bounded retry with jitterless backoff (`busy.ts`) is correct for one machine.
- Catalog polling is rate-limited per ATS (`GREENHOUSE_LIMITS` 4 concurrent, 500 ms) and board batches are capped (`sweep-config.ts`).
- Singleton job kinds prevent overlapping sweeps (`scheduler.ts`, `queue.ts` `claimJobsToRun`).
- Browser sessions have a hard cap, a 15 min timeout and a release in `finally` (`session-slots.ts`, `executor.ts:891`).

## Proposed tickets (in order)

1. **Wire event and job retention**: hourly maintenance job calling `purgeOldEvents`, deleting old `done`/`dead` `bg_jobs`, in chunks; stop global `job.*` events. (Finding 1, 3.) Do first; small.
2. **Index pass migration**: `bg_jobs(status, run_at)` partial, `applications(posting_id)`, `applications(status)` partial, `events(created_at)`. One migration. (Findings 3, 6.)
3. **Home up-next performance**: drop the all-users `crowdRows` scan, TTL-cache `upNext`, add a regression test on query count. (Finding 2.)
4. **Shared SSE dispatcher**: one poller or in-process notify instead of one interval per connection. (Finding 4.)
5. **Browser slots**: unify the two concurrency settings, claim `sending` only after a slot is held, admin occupancy. (Finding 7.)
6. **Runtime metrics**: event-loop lag, p95 route latency, job lag, WAL size, SSE clients, RSS in admin health. (Finding 8.)
7. **Local load harness** behind `heavy` with a synthetic catalog, plus a recorded baseline in `docs/research/`. Needs the metrics from 6. (Finding 8.)
8. **Catalog write contention**: chunk `closeMissingPostings`, evaluate `synchronous=NORMAL` for the sweep connection (needs an ADR touching ADR 0002). (Finding 5.)
9. **Fly sizing review before M3** after the baseline from 7. (Finding 9.)
