# M1-09b — Seed comparison: the v1 board seed vs the ats-scrapers directory

**Date of measurement:** 2026-11-20, 01:12–01:32 UTC-05:00 (06:12–06:32 UTC). **Deliverable for
epic #5 (issue #56):** decide, on measured numbers, whether #16 should seed `company_boards`
from the v1 export, from ats-scrapers' hosted `companies.parquet`, or from the union of both.

Rules followed: every number below comes from `scripts/seed-comparison.ts` and cites the command
that produced it; scratch data (the v1 CSV, the manifest and the parquet) stays in
`/home/ubuntu/orca/workspaces/overture/spike-ats-out/` and is never committed; live checks ran at
one request every 550 ms (1.8 req/s overall, single-flight, so ≤ SPEC §6.1's per-ATS limits of 4
concurrent / 2 req/s for greenhouse, lever and ashby) with `nice -n 10` on the runner.

## Verdict

**Recommendation for #16: seed from ats-scrapers.** Its boards are 87.5 % live (est. 12,183 of
13,911) against the v1 seed's 51.4 % (est. 8,158 of 15,863), and it already contains ~98 % of the
v1 seed's live boards, because the v1-only stratum is dead almost everywhere (1.3–3.3 % live across
the three ATSes). The union only adds an estimated **+186 live boards (+1.5 %)** and **+514 active
Postings (+0.2 %)** over ats-scrapers alone, for 7,115 extra v1-only rows that are 97–99 % gone.
If even that residue matters later, a one-time live-check of v1-only boards can add the survivors
as `source='discovered'`; it does not justify seeding the union wholesale.

| Headline (greenhouse + lever + ashby) | v1 seed | ats-scrapers | union |
|---|---|---|---|
| Boards (deduplicated tokens) | 15,863 | 13,911 | 21,026 |
| Est. live boards | 8,158 | 12,183 | 12,367 |
| Est. live share | 51.4 % | 87.5 % | 58.8 % |
| Est. active Postings | 242,890 | 327,187 | 327,701 |

## 1. Inputs and pins

Manifest `https://storage.stapply.ai/jobs/v1/manifest.json` and its `companies.parquet`, both
sha256-pinned in the script; a mismatch or a schema change fails loudly:

- manifest sha256 `cc6bc21396e64f6e93be77ffcdc37dba9b3a70892fcc53f8277559482f502b9b`
  (dataset schema "2.0", generated_at 2026-11-18T23:27:27Z, updated_at 2026-11-19T20:39:08Z)
- companies.parquet sha256 `dabf803a8849e4f07c9ddf38b027d7bdd7b68875d43121825415da08cedf736c`
  (7,912,735 bytes, 173,344 rows)

Schema-validation gates (all fail loudly, exit non-zero):

- manifest parsed against a Zod schema (version, timestamps, `stats`, `companies`, `by_ats_companies`);
- `manifest.companies.parquet_sha256` must equal the script's pin;
- parquet columns must be exactly `[ats, name, slug, url]`;
- parquet row count must equal `manifest.companies.rows`;
- per-ATS row counts must equal `manifest.by_ats_companies[ats].rows` for greenhouse, lever, ashby;
- v1 CSV header must be exactly `ats,board_id,company,source,consecutive_not_found`.

The v1 seed is `/home/ubuntu/orca/workspaces/overture/spike-ats-out/v1-boards/v1-company-boards.csv`
(private, 22,796 rows, never committed).

## 2. Token normalisation

Both sets are reduced to `(ats, board_token)`:

- v1: `board_id` used as-is; rows deduplicated per ATS keeping the first company. Workday rows
  (`board_id` = `tenant/wd-site/site`, e.g. `23andme/wd5/23`) are split out because the token
  formats do not join.
- ats-scrapers: the board token is the last path segment of the row's `url`, falling back to the
  `slug`; (greenhouse `https://boards.greenhouse.io/{token}/…`, lever
  `https://jobs.lever.co/{token}/…`, ashby `https://jobs.ashbyhq.com/{token}/…`)
  — matches the memo's §2 mapping from the companies artifact `url`.

Rows dropped because their URL has no usable board token, all outside M1 (information only):
avature 2, hiringthing 4,569, icims 1,000, teamtailor 56. Uses outside the URL fallback never
triggered.

## 3. Set sizes (dry run, no network)

Per ATS, after deduplication:

| ATS | v1 | ats-scrapers | overlap | v1 only | scrapers only | union |
|---|---|---|---|---|---|---|
| greenhouse | 8,333 | 7,363 | 4,718 | 3,615 | 2,645 | 10,978 |
| lever | 4,368 | 2,377 | 1,721 | 2,647 | 656 | 5,024 |
| ashby | 3,162 | 4,171 | 2,309 | 853 | 1,862 | 5,024 |
| **M1 total** | **15,863** | **13,911** | **8,748** | **7,115** | **4,163** | **21,026** |

- Case-insensitivity never changed an overlap count (`overlapWithCaseMismatch = 0` per ATS).
- Workday, outside M1's ATS list and unjoinable token formats: v1 has 6,857 rows, ats-scrapers
  has 5,359. Reported for information; no live check.

## 4. Live checks (estimate basis)

The script draws a stratified random sample — 150 boards per ATS per **stratum**
(`v1_only`, `overlap`, `scrapers_only`), i.e. 450 distinct boards per ATS, so each *set* gets ≥150
probed boards (v1 = v1_only + overlap = 300; ats-scrapers = scrapers_only + overlap = 300;
union = all three) and the overlap is probed once, not twice. It then probes the SPEC §6.1 public
board APIs — greenhouse `boards-api.greenhouse.io/v1/boards/{token}/jobs`, lever
`api.lever.co/v0/postings/{token}?mode=json`, ashby
`api.ashbyhq.com/posting-api/job-board/{token}` — one request every 550 ms, glued to
`createClock()`, at most 1.8 req/s overall (SPEC's bar is 2 req/s per ATS, 4 concurrent).

Classification per response: HTTP 200 with a parseable body and >0 postings → **live**; 200 with
0 postings → **empty**; 404 or 410 → **gone**; anything else non-2xx → other status; fetch or body
failures → fetch error / unparsed body. Postings counted from the listing: greenhouse `jobs`,
ashby `jobs`, lever its bare JSON array (the array-shaped body is why #56's first live pass
miscounted every lever 200 as unparsed; the schema now takes either shape — verified against
`api.lever.co/v0/postings/kraken?mode=json`).

Per-stratum results, 150 checked each (detail: `report-live.json`, §Commands):

| Stratum (population) | live | empty | gone | other |
|---|---|---|---|---|
| greenhouse v1_only (3,615) | 5 (3.3 %) | 13 | 132 | 0 |
| greenhouse overlap (4,718) | 139 (92.7 %) | 8 | 3 | 0 |
| greenhouse scrapers_only (2,645) | 124 (82.7 %) | 26 | 0 | 0 |
| lever v1_only (2,647) | 3 (2.0 %) | 7 | 140 | 0 |
| lever overlap (1,721) | 126 (84.0 %) | 22 | 1 | 1 |
| lever scrapers_only (656) | 105 (70.0 %) | 26 | 19 | 0 |
| ashby v1_only (853) | 2 (1.3 %) | 13 | 135 | 0 |
| ashby overlap (2,309) | 140 (93.3 %) | 9 | 1 | 0 |
| ashby scrapers_only (1,862) | 126 (84.0 %) | 23 | 1 | 0 |

The only "other" is one non-404 lever overlap board; there were no fetch or parse failures. A 95 %
binomial confidence interval on each live rate spans at most ±7.5 points (widest: 84 % ± 5.8,
70 % ± 7.3, 92.7 % ± 4.3), far narrower than the v1-vs-scrapers gap ≥30 points on every stratum.

Active Postings per live board (sample means): greenhouse 25.8 (v1 strata) / 26.5 (scrapers),
lever 67.6 / 57.0, ashby 11.9 / 12.0 — close to the memo's §2 volume split (~345k SPEC-slice
postings over ~12k companies ≈ 28 per board).

## 5. Extrapolations

Straightforward stratified extrapolation: for each stratum, live share `live/checked` times the
population, Postings as population × live share × postings-per-live-board; the sets compose as
v1 = v1_only + overlap, ats-scrapers = scrapers_only + overlap, union = all three (all code in
`estimateFor` and `report.estimates`):

| Estimate | population | live rate | est. live boards | postings/live board | est. Postings |
|---|---|---|---|---|---|
| v1 greenhouse | 8,333 | 53.9 % | 4,493 | 25.8 | 115,865 |
| v1 lever | 4,368 | 34.3 % | 1,499 | 67.6 | 101,239 |
| v1 ashby | 3,162 | 68.5 % | 2,166 | 11.9 | 25,786 |
| **v1 total** | **15,863** | **51.4 %** | **8,158** | — | **242,890** |
| scrapers greenhouse | 7,363 | 89.1 % | 6,559 | 26.5 | 174,000 |
| scrapers lever | 2,377 | 80.1 % | 1,905 | 57.0 | 108,563 |
| scrapers ashby | 4,171 | 89.2 % | 3,719 | 12.0 | 44,624 |
| **scrapers total** | **13,911** | **87.5 %** | **12,183** | — | **327,187** |
| union greenhouse | 10,978 | 60.8 % | 6,679 | 26.1 | 174,338 |
| union lever | 5,024 | 39.0 % | 1,958 | 55.5 | 108,722 |
| union ashby | 5,024 | 74.3 % | 3,731 | 12.0 | 44,641 |
| **union total** | **21,026** | **58.8 %** | **12,367** | — | **327,701** |

By construction, ~98 % of the v1 seed's estimated live boards (7,974 of 8,158: the overlap
strata) are already inside ats-scrapers. The union's edge over ats-scrapers is the v1-only
residue: greenhouse 3,615 × 3.3 % ≈ 121, lever 2,647 × 2.0 % ≈ 53, ashby 853 × 1.3 % ≈ 11 —
about 186 boards and ~514 Postings in total, and it drags the union's headline live
share down to 58.8 %.

## 6. Why ats-scrapers wins (and when the union still makes sense)

1. **Freshness**: the v1 seed's unique stratum is 97–99 % 404; its live mass sits in the overlap,
   so the export mostly proves what happened years before the export's `consecutive_not_found`
   column was last touched. The fresh ~29.5 h-old parquet scores 70–84 % live even on boards v1
   never had.
2. **Recall**: ats-scrapers ⊇ ~98 % of v1's live boards (§5). The union adds
   ≈ +186 live boards (+1.5 %) and ≈ +514 Postings (+0.2 %).
3. **Cost**: seeding the union means loading 7,115 extra dead rows that the first backfill pass
   would have to 404 (twice, per SPEC §6.2) before marking them `gone` — ~14,000 wasted requests
   inside per-ATS budgets (greenhouse's 3,615 alone cost ~2 h of its 2 req/s) and inflated early
   `discovery` metrics, for a rounding-error posting gain.

**For #16: seed from `companies.parquet` with `source='discovered'`** (the memo's Phase-1 item 1).
If we later want the last ~186 live boards, a one-off live-check of the 7,115 v1-only tokens
(≈ 1 h at 2 req/s) can insert the survivors discovered-style; that is strictly cheaper than
seeding the union, and #16's census will not notice the difference.

Workday is not seeded in M1 either way; its 6,857 v1 rows and 5,359 scraper tenants stay out of
scope until an M2 decision (token formats do not join, and M1's ATS list excludes it).

## 7. Commands (every number is reproducible)

```sh
# inputs (scratch dir, never committed)
curl -fsSL https://storage.stapply.ai/jobs/v1/manifest.json \
  -o /home/ubuntu/orca/workspaces/overture/spike-ats-out/m1-09b/manifest.json
curl -fsSL "$(python3 -c 'print(__import__("json").load(open("/home/ubuntu/orca/workspaces/overture/spike-ats-out/m1-09b/manifest.json"))["companies"]["parquet"])')" \
  -o /home/ubuntu/orca/workspaces/overture/spike-ats-out/m1-09b/companies.parquet
# parquet URL resolves to https://storage.stapply.ai/jobs/v1/companies.parquet

# set sizes only (no network probes)
bun run scripts/seed-comparison.ts \
  --v1 /home/ubuntu/orca/workspaces/overture/spike-ats-out/v1-boards/v1-company-boards.csv \
  --manifest .../m1-09b/manifest.json --companies .../m1-09b/companies.parquet \
  --out .../m1-09b/report-dry.json

# full comparison with live checks (150/ATS/stratum, 550 ms apart)
bun run scripts/seed-comparison.ts --live --sample-size 150 \
  --v1 .../v1-company-boards.csv --manifest .../m1-09b/manifest.json \
  --companies .../m1-09b/companies.parquet --out .../m1-09b/report-live.json
```

`--sample-size` is per (ATS, stratum); strata are `v1_only`, `overlap`, `scrapers_only`, so each
set gets ≥150 probes and the overlap is not double-counted. Reproduced:
`report-live.json` (2026-11-20 06:12–06:32 UTC) carried every live number in §4–§5; the summary
interval per stratum is in the run log alongside the report.

## 8. Caveats

- Fresh samples each run: the probe draws are random (`crypto.getRandomValues`), so per-stratum
  counts will move by ±1–2 boards between runs; the pin and set-size tables are deterministic.
- 1.8 req/s overall was the pacing for the single-flight probe runner; the production backfill
  follows SPEC's 4-concurrent / 2 req/s per-ATS budgets (§6.1).
- Postings are from the light listing only (no questions, no per-job content), and a board that
  is hiring but blocks our probe would be misheard as non-live — the log shows no such failure
  (0 fetch errors, 0 parse errors after the lever fix).
