---
status: accepted
---

# Jobs come from freehire, in freehire's own shape

Implements issue #700 under the owner's 2026-11-26 direction (issue #678). It supersedes the Stapply-shaped catalog
ingest (ADR 0032, ADR 0036) as the source of every job Overture matches and applies to.

## Decision

1. **One source, one port.** `src/server/jobs/source.ts` defines the `JobSource` port: a filtered search, an optional
   change feed, and an optional single-job lookup. `freehire-source.ts` is the only production implementation and owns
   the freehire wire format; `testing/fake-source.ts` is the fixture-backed double every contract test uses. No test,
   CI job or scheduled job calls `freehire.me`.
2. **freehire's fields are stored, not translated.** `jobs` in `app.sqlite` carries freehire's `category`,
   `seniority`, `work_mode`, `countries`, `regions`, `metros`, `cities`, `skills`, salary and the `reality` block
   (`fake_freshness`, `repost_count`, `age_days`) directly. A blank or unknown `work_mode` is stored as `NULL`; it is
   never inferred. `job_places` holds the geography facets lower-cased so a place filter is an indexed lookup.
3. **The source is the 28 sendable systems.** `FREEHIRE_SOURCE_TO_ATS` maps freehire's source names to the ATS names
   the senders use (`zohorecruit` → `zoho_recruit`, `join` → `join_com`, `isolvedhire` → `isolved_hire`). A posting
   from a source outside the map is dropped, because no sender could fill it. The adapter sends that list as one
   `source` facet on every search.
4. **Search rules.** `/api/v1/jobs/search`, comma-separated multi-values, `sort=created_at&order=desc`, `limit=100`
   with offset paging under freehire's `offset + limit ≤ 10,000` ceiling, at most two requests a second, and
   exponential backoff on `429` (honouring `Retry-After`) and `5xx`. Geography facets widen each other; `category`
   ANDs with them. Work mode is never a hard filter.
5. **One shared table, deduplicated across users.** The freehire `public_slug` is the primary key, so the same posting
   pulled for two people is one row. A new slug whose employer, normalized title and places match a stored job is a
   duplicate and is not inserted. Rows close, they never delete, so an Application's stored link keeps resolving.
6. **The apply link is resolved once and saved.** Lever, Greenhouse and Ashby are formatted from the board token in
   `external_id` (`<board>:<id>`). Every other sender follows freehire's `/api/v1/go/<slug>` (or its `apply_url` when
   present) once with `redirect: "manual"`, strips `utm_*`, and saves the target. A blank `apply_url` falls back to the
   go link. `board_token` and the employer's `ats_job_id` are stored on the row.
7. **Pulls are grouped and scheduled.** Every user gets one full search when onboarding ends and again when roles or
   places change. Paid Weekly/Monthly users, detected by an active `period` grant, also get a fresh pull every three
   hours (a setting, so the freehire API plan can take it to one hour). Trial users get no repeating pull. Users whose
   roles and places produce the same search share one group, so one request serves many people. `job_pull_state`
   remembers each user's last full and fresh pull and the query their preferences made.
8. **The change feed drops closed jobs.** With `FREEHIRE_API_KEY` set, `/api/v1/jobs/changes` is walked from a stored
   cursor and `closed` changes mark rows closed. Without a key, a job is re-read by slug just before preparing it.
9. **A failure keeps the last good matches.** A pull that errors records its counters, increments a failure counter,
   writes `jobs.pull.failed` to the event log, and raises the `jobs.pull` alert only after three consecutive failures.
   No job is deleted or marked closed because a pull failed. Every successful group writes `fetched`, `kept` and the
   drops by reason to `job_pull_runs` and the `jobs.pull` event.
10. **Cut-over is read-only on the old catalog.** Existing Applications keep their employer, title and link snapshot
    and stay readable in the Tracker. `postings`, `posting_tags`, `company_boards` and `catalog.sqlite` remain for
    their readers until issue #706 removes them; this PR does not write to them.

## Consequences

- The old catalog keeps serving the current Home/Matches/onboarding readers until #706, while the freehire tables are
  the source every new matching and preparation path reads. Two reads coexist for one wave, by design.
- Jobs now live in `app.sqlite` because they are written at runtime by the production job worker; they are public data
  in the replicated file, which is acceptable at the pull volumes (~5 pages per group) and will be revisited if the
  table grows beyond what Litestream should carry.
- freehire's public reads withhold the employer's own `url` and link through `apply_url` only; the direct Lever,
  Greenhouse and Ashby formatting and the one-hop go redirect are how Overture reaches the real form without a paid
  key. The API plan later adds the change feed and a higher rate limit, not a different shape.
- A freehire search can report `ignored_params`; the pull writes them to `jobs.pull.ignored` instead of trusting a
  silently broad answer.
