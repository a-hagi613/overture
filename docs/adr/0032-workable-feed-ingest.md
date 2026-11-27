---
status: accepted
---

# Workable is ingested from a daily off-box pass, not on the serving machine

ADR 0028 confirmed Workable's one XML feed for every customer (about 831 MiB uncompressed, refreshed hourly, keyed by
`<referencenumber>`) and deferred the ingest: a streamed daily pass on the 2 GB machine, or an off-box pass that writes
only target-relevant postings to R2. Issue #233 measured both against a production recording. The measurements and
the harness are in `docs/research/workable-feed-ingest.md`.

## Decision

**A scheduled GitHub Action does the Workable pass; the app never fetches the feed.**

- The Action runs daily at 04:00 UTC, three hours before the preparation run. It requests the feed with
  `Accept-Encoding: gzip` (Workable requires compression) and `If-Modified-Since`; there is no `ETag` and no
  `Content-Length`, only `Last-Modified`.
- It streams the file once (peak RSS was 159 MB in the measurement, against 2 GB), parses it with a streaming XML
  parser, and runs the repository's own `htmlToText` and `tagPosting` so tags match the rest of the catalogue.
- It keeps a posting only when it could match the union of active users' targets: role, location, seniority,
  workplace and employment type, read from a `workable-targets.json` that the app writes to R2 (values only, no user
  identifiers). Exact matches were 0.6 % of the recorded sample as-is and 1.2 % with the experience fallback; a broad tech envelope was 3.2 %.
- It writes one gzipped JSONL snapshot plus a manifest (fetched-at, source `Last-Modified`, row count, content hash)
  to R2. Feed data is never committed.
- The app ingests the latest snapshot: upsert on `<referencenumber>`, keep the company display name and the apply
  shortcode, store the tags the Action computed, and close postings absent from the snapshot. Workable's kill switch
  stays off until #235 enables the ATS on probe evidence.
- Alerts fire when the Action fails, the latest snapshot is older than 26 hours, or the row count drops more than
  20 % run over run. On repeated failure the last snapshot stands; there is no fallback that fetches Workable from
  production (ADR 0016).

**Tagging rules for Workable.** `postings.ats` gains `workable`; the feed's `<experience>` fills the seniority when
the title has none, `<jobtype>` supplies employment type and `<category>` is the department. Without the experience
fallback only 10.5 % of recorded postings had a seniority; with it 23.3 % (77.5 % of tech-role postings) can match a
seniority target. The ingest also collapses the feed's duplicate rows: 5,426 blocks carried 5,072 distinct references
(6.5 % repeated).

## Why not the machine

The measured full pass is **about one CPU-hour a day**, almost all of it tagging 170,200 rows: streaming and parsing
cost 16 s of CPU, but `tagPosting` costs 19.1 ms per posting, with 41 % of postings at 20 ms or more because
`similarRole` rescans the O*NET index for unclassified titles. Filtering to the 3.2 % candidate envelope cuts that to
about 3 minutes a day, so the machine can do it, but the box is 2 vCPUs with no failover and the filter's breadth
depends on which targets the beta users pick. The off-box pass pays the same CPU on a free public-repository runner,
leaves the serving box's CPU and 141 MB/day download alone, and writes only the small filtered result. The discovery
job already uses this shape and Overture's R2 (ADR 0028).

A daily pass is at most 24 hours plus the run and scheduler delay (about 3 minutes plus the 15–60 minutes GitHub can
add). That is acceptable: the feed's own postings are long-lived (median 1,033 days in the recorded prefix), the daily
preparation run already sets the product's cadence, and the full snapshot is also the closure signal. The 26-hour
alert catches a missed run.

## Consequences

- New: a scheduled Action, one R2 prefix (`workable/`), a target-summary object written by the app, and an age/count
  alert. No new app download path, no new secret for the app.
- The app's ingest of the snapshot is small: at most a few thousand postings and a few MB gzipped a day, seconds to a
  couple of minutes of work, not an hour.
- A new user whose targets were not in yesterday's union sees Workable postings from the next run. Acceptable for a
  daily feed; the alternative (ingesting all 170,200) is the CPU-hour the decision avoids.
- The e2e fixture is a recorded trim that keeps the real structure and ends on a `</job>` boundary. The spike's
  streaming parser (`htmlparser2`) is a dev dependency; #234 makes the parser it chooses a runtime dependency.
- Follow-up, not required for this choice: precompute the O*NET trigram sets in `similarRole`. The measured 20–730 ms
  tail becomes a fraction of a millisecond, which would make an on-machine pass cheap if the owner ever wants one.

## Considered Options

- **Unfiltered streamed daily pass on the 2 GB machine.** Rejected: one CPU-hour a day of tagging on the serving box,
  for postings most users cannot match.
- **Filtered streamed pass on the machine.** Measured at about 3 minutes a day for the 3.2 % envelope, so feasible,
  but it still fetches 141 MB a day on the serving box and its cost scales with the beta's target mix; the off-box
  pass gets the same result without either.
- **Parse off-box and tag in the app.** Moves 833 MB a day to the app and keeps the CPU cost there.
- **Fetch the feed from the app with a guard.** Contradicts ADR 0016 and the measured cost.
- **No Workable ingest.** Drops the ATS the owner selected in ADR 0028.

*Amendment of 2026-11-26 (#679, #700): the Workable bulk feed ingest is retired with the old job source. freehire is
the only job source, so the app no longer fetches, stages or ingests a Workable snapshot; the Workable apply adapter
(its form read over plain HTTP) stays. See SPEC §6.*

*Amendment of 2026-11-27 (#706): the retired ingest is deleted, not just stopped. The
`workable-feed.yml` pass, the `workable-ingest`/`workable-job` worker path, the
`workable.feed` alert and the sentinel's manifest-freshness check are removed, so
nothing reads or writes `workable/manifest.json` any more. The Workable **apply**
adapter is untouched and still sends Applications from freehire jobs.*
