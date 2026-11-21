# Workable bulk feed: the measured ingest decision (issue #233)

Workable publishes one XML feed for every customer on Jobs by Workable (`docs/research/m2-ats-verification.md` §3).
ADR 0028 deferred the ingest design: a streamed daily pass on the 2 GB machine, or an off-box pass that writes only
target-relevant postings to R2. This note records what was measured on a real recording and recommends the second.

## What was measured

The orchestrator recorded the feed from production in one streamed pass on 2026-11-21 at about 07:05 UTC. No
development machine contacted Workable (ADR 0016).

| Item | Measured |
|---|---|
| Status / encoding | `200`, `content-encoding: gzip`, `content-type: application/xml; charset=utf-8` |
| Response headers | no `Content-Length`, no `ETag`, `Last-Modified: Sat, 21 Nov 2026 06:14:41 GMT` |
| Transfer | **147,633,211 B** gzip (140.8 MiB) |
| Uncompressed | **873,439,320 B** (833.0 MiB) |
| `<job>` elements | **170,200** |
| Prod pass (download + gunzip + count) | **50 s** wall, peak RSS **92 MB**, `/api/health` every 2 s (n=15) p50 **1 ms**, max **125 ms** |

The trimmed recording kept the first **5,426** job blocks at a real `</job>` boundary (20,986,322 B uncompressed,
real structure, closed with `</source>`). It is kept outside the repository. The measurement harness is
`scripts/measure-workable-feed.ts`; it streams the gzip through `htmlparser2` in XML mode and runs the real
`htmlToText`, `tagPosting`, `roleTargetMatches` and `resolveLocation` from `src/`.

The harness ran at `nice 15` on the dev box (Intel Haswell, 6 vCPU) while the 15-minute load average was 14–21, so
wall-clock time and the event-loop histogram are not representative and are not used below. **CPU time is the stable
number**; it is if anything inflated by cache contention. The sample is the feed's first 5,426 blocks, so the country,
role and date mixes are not representative of all 170,200 postings. Numbers that depend on the mix are marked.

## The feed itself

- **Duplicates are real.** 5,426 rows carry only **5,072 distinct `<referencenumber>`s**: 180 references repeat, 354
  extra rows (6.5 %), some six times with the same title and company. The ingest must upsert on the reference; the
  published 170,200 count is an upper bound on distinct postings (about 159,000 at the sample's rate).
- **No conditional validator worth using.** There is no `ETag` and no `Content-Length`; the only validator is
  `Last-Modified`, which changes hourly anyway, so a daily pass always transfers the file.
- **Fields** (`<job>` coverage in the sample): title, date, referencenumber, url, company, country 100 %; state 93.4 %;
  city 92.5 %; jobtype 89.7 %; education 72.0 %; category 63.5 %; experience 57.8 %; postalcode 7.7 %. The
  description is HTML inside CDATA.
- **The structured fields matter.** `<experience>` (Entry level, Associate, Mid-Senior level, Director, Executive,
  Internship) is the only reliable seniority signal: only **10.5 %** of the sample's titles name a seniority, but
  **23.3 %** do once `<experience>` fills the gap, and **77.5 %** of tech-role postings. Without it most postings can
  never match a user's seniority target.
- **The feed is long-lived, not instant.** In the sample the median posting date is **1,033 days** old and the 90th
  percentile **1,838 days** (every posting is over a year old). The first-block sample over-weights old companies, so
  treat this as a warning rather than a full-feed fact; it does say a one-day lag is not the thing that loses postings.

## What one pass costs

Measured on the 5,072 distinct postings, then scaled by bytes or postings:

| Work | Measured | For all 170,200 |
|---|---|---|
| Download + gunzip + count on prod | 50 s | 50 s |
| Stream-parse + field extraction | 382 ms CPU per 21.0 MB (64.8 MB/s) | **16 s CPU** |
| HTML to text + full `tagPosting` | **19.1 ms** CPU per posting (94.4 s user + 2.5 s sys) | **54 CPU-min** (≈51 min for ~159k distinct) |
| Peak RSS, parse + tag | **159.1 MB** (`VmHWM`) | constant, streaming |
| Health during the prod count pass | p50 1 ms, max 125 ms | — |

Tagging is not uniformly cheap. In a 2,004-posting probe the median was **0.4 ms**, but **41 %** of postings took
≥20 ms and **233** took ≥100 ms (the worst 730 ms). The cause is `similarRole`: for every title the keyword rules do
not classify (29.8 % of the sample), it rebuilds a trigram set for each entry in the O*NET index on every call. That
is the difference between a **1-hour** unfiltered pass and a pass that filters first.

**An unfiltered on-machine pass is one full CPU-hour a day**, almost all of it tagging. Filtering to the candidate
envelope below (3.2 % of postings) costs **105 s of tagging + 16 s of parsing + 50 s of download ≈ 3 min a day**, at
the same 159 MB peak.

## The share that can match any user's targets

Four target sets were pinned in the harness: three plausible users, and a broad "beta envelope" that is an upper
bound rather than one person.

| Target set | Roles | Seniorities | Workplaces | Locations | Exact matches |
|---|---|---|---|---|---|
| senior-platform-canada | Platform/Backend/DevOps/Infrastructure/SRE | senior, staff | remote, hybrid | Toronto, Vancouver, Austin | **0** (0 %) |
| frontend-us | Frontend/Full-stack/Software | mid, senior | remote, hybrid | New York, San Francisco, Seattle, US | **0** (0 %) |
| data-ml-europe | Data Scientist/Engineer, ML Engineer | mid, senior, staff | remote | UK, Germany, Netherlands, Ireland | **0** (0 %) |
| beta-envelope (upper bound) | all tech groups | mid, senior, staff, principal | any | US, CA, UK, DE, NL, IE | **32** (0.63 %) |

With `<experience>` filling a missing seniority (the ingest rule below) the four sets find **0, 1, 0 and 60** postings
(**1.18 %** on the envelope). The three narrow user sets stay near zero because they exclude onsite work and name
cities or countries where this slice has few postings.
The funnels explain the zeros: of 5,072 postings, **835** pass a tech-role test, **535** have a seniority in the
title (1,182 with experience), **919** are remote or hybrid, **2,048** are in one of the six countries and **3,533**
are full-time; the intersection is almost empty. The owner-like set passes location for only **22** postings and role
for **91**.

The coarse envelope used for off-box sizing is **tech roles in the six countries, full-time, any workplace**: **164
postings (3.2 %)** before the seniority test, **107 (2.1 %)** of which carry any seniority signal. That is the
number of postings a daily filtered pass could carry; the exact per-user set is smaller.

The measured output is correspondingly small: the 32 as-is envelope matches are **114,693 B of JSONL and 27,964 B
gzipped**; with the experience fallback the 60 matches are 226,386 B and 52,054 B gzipped. At the feed's own gzip
ratio (147.6 MB / 873.4 MB = 16.9 %), a 3.2 % slice would be about **28 MB raw and 4.7 MB gzipped a day**.

The small share is a product finding, not only a cost one. For these target sets the global Workable feed adds about
2,000 postings a day at the sample's rate (up to 5,400 on the coarse tech envelope); it is coverage, not volume. The
ingest should still keep every candidate so a change of targets finds it next day.

## How stale a daily pass is

The feed is refreshed hourly. A daily pass means a posting can wait **24 hours plus the pass and scheduler delay**:
about 3 minutes for a filtered off-box pass, plus the 15–60 minutes GitHub can add to a scheduled run. Run at
**04:00 UTC**, three hours before the daily preparation run, and alert if the latest snapshot is older than 26
hours. This is acceptable because the feed's own postings are long-lived (above) and because a full snapshot still
closes postings when they leave the feed; the snapshot, not a per-job timestamp, is the closure signal. Nothing in
M2 promises sub-day Workable freshness; the other feeds keep their 30-minute to 12-hour trickle.

## Recommendation: a daily off-box pass, writing target-relevant postings to R2

**Choose the off-box pass.** The measurements give five reasons:

1. **The tag pass is about one CPU-hour a day unfiltered, and the beta's target union is unknown until users exist.**
   A filtered pass is ~3 minutes at the measured 3.2 % envelope, but if beta users target more role groups the
   filtered set and its tag cost grow; the serving box should not carry a workload whose size depends on the beta's
   demographic.
2. **The 2 GB machine's scarce resource is CPU, not RAM.** Streaming fits easily (159 MB), but a full core for an
   hour a day on a 2-vCPU box with no failover is exactly the load ADR 0028's sweep-worker change (#175) moved out of
   the request path. The prod count pass already touched 125 ms on `/api/health`; a tag pass multiplies the work.
3. **The output is tiny.** 0.6–3.2 % of postings is 1,000–5,446 postings and 0.9–4.7 MB gzipped per day: R2 storage
   and transfer are rounding errors, and the prod ingest is seconds to a couple of minutes, not an hour.
4. **The pattern already exists.** ADR 0028's discovery job is a GitHub Action writing one file to Overture's R2.
   The Workable pass reuses that shape, its secrets and its watchdog instead of adding a second scheduled system in
   the app.
5. **A global bulk feed has nothing to do with serving.** No user waits on a Workable download, so keeping the fetch
   and its CPU off the serving machine is free isolation.

### Design the build should follow

- **The Action** runs daily at 04:00 UTC. It requests the feed with `Accept-Encoding: gzip` (required) and
  `If-Modified-Since` from the previous manifest, streams it once, and tags with the repository's own
  `htmlToText`/`tagPosting` code so prod and CI agree on tags. It keeps a posting when it could match the union of
  active users' targets: the union of target roles, locations, seniorities, workplaces and employment types, read
  from a `workable-targets.json` that prod writes to R2 (values only, no user identifiers). It writes
  `workable/YYYY-MM-DD.jsonl.gz` and a small manifest (fetched-at, source `Last-Modified`, row count, content hash)
  to R2. It never commits feed data to the repository.
- **Prod** ingests the latest object: upsert on `<referencenumber>`, keep the company display name and the apply
  shortcode (`https://apply.workable.com/j/<ref>`), store the tags the Action computed, and close postings that are
  absent from the snapshot. The Workable kill switch stays off until #235 enables the ATS on probe evidence.
- **Alerts**: the Action fails, the latest object is older than 26 hours, or the row count drops more than 20 % from
  the previous run (a truncated feed must not close the catalogue). If the Action fails repeatedly, the last
  snapshot stands; the app never falls back to fetching the feed (ADR 0016).
- **Use `<experience>` when the title has no seniority, `<jobtype>` for employment and `<category>` as the
  department.** Without the first, most Workable postings are invisible to matching (10.5 % vs 23.3 % tagged).
- **#234's budget**: peak RSS at most 200 MB above the process baseline, ingest at most 5 minutes a day, `/api/health`
  p99 under 300 ms (the existing sweep budget). The e2e fixture is a later 300-job production recording (the 5,426-job
trim was deleted with the spike worktree); it keeps the real structure and ends on a `</source>` boundary.

### Considered and rejected

- **Unfiltered streamed pass on the machine.** Rejected: ~1 CPU-hour a day of tagging plus the download on the
  serving box, for postings most users cannot match.
- **Filtered streamed pass on the machine.** Measured at ~3 min a day for the 3.2 % envelope, so it is feasible, but
  it still fetches a global 141 MB file on the serving box and its cost scales with whatever targets the beta picks;
  the off-box pass gets the same result without either.
- **Parse off-box, tag on the machine.** Moves 833 MB and the tag cost to prod without the isolation benefit.
- **Keep the current state (no Workable ingest).** Loses the M2 ATS and the owner's decision in ADR 0028.

## What this changes

- **ADR 0032** records the decision and the measured budget; ADR 0028's open choice is resolved, not contradicted.
- **SPEC §6.1 and §19** now state the off-box pass, the R2 snapshot and the 26-hour alert instead of "M2 measures,
  then decides".
- **#234** builds the Action and the prod ingest; **#235** keeps the 20-form probe and the enable decision.
- A follow-up, not required for the off-box choice: precompute the O*NET trigram sets in `similarRole`. It turns the
  41 %-of-postings, 20–730 ms tail into a fraction of a millisecond and makes an on-machine pass cheap if the owner
  ever wants one.

## Reproducing the numbers

```sh
# The recording is kept outside the repository (the orchestrator supplies it).
bun run scripts/measure-workable-feed.ts \
  --feed <workable.xml.gz> --out <report.json> \
  --as-of 2026-11-21T06:14:41Z \
  --payload <matched.jsonl> --tags <tagged.jsonl> --experience
```

`--as-of` fixes the age reference so the report is reproducible; `--experience` adds the `<experience>` seniority
fallback (without it, the harness reports the as-is 0.63 % envelope and smaller payload). The harness only reads a
local file, so it can never contact Workable, and it prints the measured numbers as JSON. The recording, report and
payloads stay in `.measure/`, which is gitignored.

## Limits of this note

The sample is the first 5,426 of 170,200 blocks: country, role and date shares are indicative. The harness ran under a
load average of 14–21, so its wall time and event-loop delays are excluded; CPU time per posting and the memory high
water mark are the measurements that carry over. The 5,072 distinct count is exact for the sample but the full feed's
duplicate rate is assumed equal. No production pass with tagging was run, so the `/api/health` numbers are for the
download-and-count pass, not for a tag pass; that is why the recommendation keeps tagging off the serving box.
