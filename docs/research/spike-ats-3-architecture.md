# Spike ATS 3 — build vs adopt, and the schema diff

**Worker 3 of epic #5 (research spike).** Deliverable: this report. Live evidence only — every
number below cites the command that produced it. Shared data in `spike-ats-out/data/` (never in git).

Status: **in progress** (M1 of 5 done).

| Milestone | Content | Status |
|---|---|---|
| M1 | Live env + hosted manifest + source read of the `Job` schema | done |
| M2 | Schema mapping (ats-scrapers `Job` → Overture SPEC tables, → hc.sqlite) | pending |
| M3 | Delta & expiry design + test on real snapshots | pending |
| M4 | Coverage: hc.sqlite top companies vs companies.parquet directory | pending |
| M5 | Fallback (/api/mcp) + build-vs-adopt verdict | pending |

---

## 0. Environment (as found and rebuilt)

- Sandbox venv already present from a prior session, verified working, ats-scrapers 0.4.0:
  ```
  $ .venv/bin/python -c "import ats_scrapers; print(ats_scrapers.__file__)"
  …/spike-ats-out/.venv/lib/python3.14/site-packages/ats_scrapers/__init__.py
  ```
- `pyarrow` 26.0.1 installed (`ls .venv/lib/python3.14/site-packages | grep pyarrow`) → parquet reads work.
- Package version from `ats_scrapers/_version.py` → `0.4.0`.

## 1. The hosted dataset, measured live (M1)

Command (2 HTTP requests total, polite):

```
$ curl -sS -A "ats-scrapers/0.4.0 spike overture" https://storage.stapply.ai/jobs/v1/manifest.json -o data/manifest.json
$ curl -sS -A "ats-scrapers/0.4.0 spike overture" https://storage.stapply.ai/jobs/v1/companies.parquet -o data/companies.parquet
$ python3 -c "import hashlib;print(hashlib.sha256(open('data/companies.parquet','rb').read()).hexdigest())"
dabf803a8849e4f07c9ddf38b027d7bdd7b68875d43121825415da08cedf736c   # == manifest sha256
```

Manifest contents (`data/manifest.json`, fetched 2026-11-20 ~00:40 UTC):

| Field | Value |
|---|---|
| `version` | 2.0 — generated **2026-11-18T23:27:27Z** |
| `stats.total_jobs` | 7,663,818 (raw 8,496,116) |
| `stats.ats_jobs` (employer ATS + company_site) | 5,072,275 (ats 5,025,554; company_site 46,721) |
| `stats` gov_board / job_board | 2,416,347 / 175,196 |
| `stats.total_companies` | 146,406 (companies.parquet rows: 173,344) |
| `by_ats` | 90 slices |
| `by_date` | **empty — no daily delta/snapshot artifact is published today** |
| `all.parquet` | 3,542,323,349 bytes (3.5 GB) — not downloaded; CSV 26 GB |
| `companies` | 7,912,735 bytes parquet (downloaded, sha256-verified above) |

Notes:

- The client always needs the full snapshot or a per-ATS slice; there is **no increment/delta artifact
  in the current public layout**, despite `by_date` existing in the schema. Any "delta" design must
  derive changes itself (see §3).
- `ats_count: 90` vs `ATSType` enum in `models.py` (v0.4.0) has ~100 members — the dataset currently
  includes more sources than the enum-visible `by_ats` list strictly matches the installed types
  (keys are plain strings by design, `manifest.py`).

## 2. The `Job` schema, from source (M2, started)

Read `ats_scrapers/models.py` (740 lines, v0.4.0) in full. Canonical row for every scraper and for
the hosted parquet ("Adding a field here means: the dataset gets a new column…", module docstring).
Fields, by the module's own six groups:

- **Identity**: `global_id` (auto-computed `{ats_type}:{ats_id}`, first-colon split; UUID4 fallback on
  missing/malformed ats_id — a *non-deterministic* fallback), `url`, `title`, `company` (display name string),
  `ats_type`, `ats_id`.
- **Location**: `location`, `country_iso`, `region` (**continent-level**, not sub-national),
  `lat`, `lon`, `is_remote` (title-keyword inference, only ever True), `workplace_type`
  (onsite/hybrid/remote/onsite_or_remote), `locations: [JobLocation{label, city, region(sub-national), country_iso, is_primary}]`.
- **Compensation**: `salary_currency` (ISO-4217-3), `salary_period` HOUR/DAY/WEEK/MONTH/YEAR,
  `salary_summary`, `salary_min/max` (float, derived from summary by regex), `compensation_components[]`
  (base/bonus/commission/equity/allowance/other, per tier).
- **Classification**: `workload_percentages`, `job_category`, `engagement_type`, `education_requirements[]`,
  `skill_requirements[]`, `experience` (int years), `employment_type`
  (FULL_TIME/PART_TIME/CONTRACT/INTERN/TEMPORARY), `department`, `team`, `requisition_id`,
  `apply_url`, `commitment`.
- **Content & timing**: `description` (plain text, ~25k char cap), `posted_at`, `source_created_at`,
  `source_updated_at`, `fetched_at`, `application_deadline`, `language` (ISO 639-1).
- **Overflow**: `raw` (JSON dict, ~5 kB guidance).

Deliberate non-goals of the library (docstrings): anything requiring reading prose (country from text,
classification of remainder) is left to a *downstream LLM enrichment pass*; `salary` comes from
tight regexes; there is **no company/tenant table join in the Job row** — `company` is a display name,
company identity resolves only via the separate companies artifact / resolver URL patterns.

## 3. M2 — Schema mapping

### 3.1 Hosted slice columns, measured (not just the model)

The public slices are dataset-schema v2.0, which is *older* than the model. Measured on the
Ashby slice (65,457 rows; `data/ashby-jobs.parquet`, sha256 = manifest's):

```
$ .venv/bin/python - <<'EOF'
import pandas as pd; df = pd.read_parquet('data/ashby-jobs.parquet'); print(df.shape, list(df.columns))
for c in df.columns: print(f'{c:22s} {100*df[c].isna().mean()}')
EOF
shape (65457, 26)
columns = [url title company ats_type ats_id location country_iso region language lat lon
           is_remote salary_min salary_max salary_currency salary_summary employment_type
           department team description posted_at requisition_id apply_url commitment raw]
nulls: url/title/company/ats_type/ats_id 0% · country_iso 0% * · is_remote 13% · salary_min/max/
currency/summary 60% · description 0.03% · posted_at 0.45% · region/language/lat/lon/
requisition_id/commitment 100% · apply_url 0% (always ≠ url)
```

\* Trap: `country_iso` is `''` (empty string) for 80.4 % of rows (`df['country_iso'].eq('').mean()`),
not null — 52,622/65,457. Only `US` 8,779, `CA` 715, `GB` 692 … are real. Any consumer must treat
`''` as missing.

**Fields the v2.0 hosted schema drops vs the model**: `global_id`, `source_created_at`,
`source_updated_at`, `fetched_at`, `application_deadline`, `experience`, `workplace_type`,
`workload_percentages`, `compensation_components`, `education_requirements`, `skill_requirements`,
`engagement_type`, `locations[]`. Several of the dropped ones survive **inside `raw`** (a JSON
*string* on the slice, not a struct): e.g. Ashby rows carry `workplace_type` ("Remote"),
`address.postalAddress{addressLocality: "San Francisco", addressCountry: "United States"}`,
`compensation_tiers` — so country, city, workplace and pay tiers are recoverable, but only by
parsing per-ATS `raw` payloads (shape differs per ATS).

### 3.2 Job → Overture SPEC tables

| `Job` field | Overture column | Notes / gap |
|---|---|---|
| `global_id` | **new column `postings.global_id TEXT`** | `{ats}:{ats_id}` = our `(ats, ats_job_id)` composite, so redundant; but needed if ingesting the hosted parquet (its `UNIQUE(board_id, ats_job_id)` key relies on a board row we don't have there). UUID4 fallback rows are *non-deterministic* — never diff on them |
| `ats_type`, `ats_id` | `postings.ats`, `postings.ats_job_id` | direct |
| `url` | `postings.url` | direct (HttpUrl → TEXT) |
| `apply_url` | `postings.apply_url`, `apply_url_norm` | our normalisation still needed |
| `title` | `title`, `title_norm` | direct + our norms |
| `company` (name string) | `companies.name` (+`name_norm`) | **no company id in Job**; hosted rows name the employer but our `company_id` must be resolved by our own matching (`companies` + `company_boards` stay ours) |
| — (board) | `company_boards` (ats, board_token) | hosted slices don't publish the board token as a clean column; recoverable from `url` patterns (resolve.py regexes) or from the companies artifact `url` |
| `location` | `location_raw` | direct (multi-site joined with `; `) |
| `country_iso` | `country_code` | empty-string trap (§3.1); hosted is missing 80 % on Ashby → our GeoNames step (§6.3) still required |
| `regions[].city`, `raw.address…` | `city`, `region` | hosted top-level `region` is a *continent*; sub-national city/region only via `locations[]`/`raw`/our GeoNames |
| `is_remote` + `workplace_type` (model) / `raw.workplace_type` (slice) | `workplace` CHECK('remote','hybrid','onsite','unknown') | hosted v2.0 lacks `workplace_type` at top level; map onsite_or_remote→? (SPEC has no such value — needs a rule or an enum extension: `hybrid` is wrong for it) |
| `salary_currency`, `salary_min/max`, `salary_period` | `salary_currency`, `salary_min_minor/max_minor`, `salary_period` | float→minor-units rounding rule; `commitment`/`salary_summary` have no SPEC column (salary_summary is useful as raw string proof) |
| `employment_type` | `employment_type` CHECK | map INTERN→internship, temporary→temporary |
| `department` | `department` | direct |
| `team` | — | no SPEC column; useful for tags |
| `requisition_id` | — | no SPEC column; cross-ATS repost signal for the 60-day repost guard |
| `description` | `description_gz BLOB` | hosted is plain text ~5.3 kB mean / 23 kB max (measured) → gzip fits; SPEC keeps a hash — compute ours |
| `posted_at` | `posted_at` | direct; 0.45 % null on Ashby |
| `source_updated_at` | `source_updated_at` | **missing from hosted v2.0 slices** — change detection falls back to content_hash of the row |
| `fetched_at`, `application_deadline`, `language`, `experience`, `engagement_type`, `education_requirements`, `skill_requirements`, `workload_percentages`, `compensation_components` | — | no SPEC columns; `language` maps to postings.language when present (100 % null on Ashby slice); the rest would need new columns or live in `raw` |
| `raw` | — | store as-is if we keep overflow, else drop (its recovery surface is ATS-specific) |

**Migration list (SPEC, if we ingest hosted slices):**
1. `postings.global_id TEXT` + INDEX — and a rule to keep `UNIQUE(board_id, ats_job_id)` meaningful (global_id ⇒ derived board).
2. `postings.content_hash TEXT` (spec only keeps `description_hash`; changed-detection needs a hash of the canonical fields).
3. `postings.salary_summary TEXT NULL`, `postings.team TEXT NULL`, `postings.requisition_id TEXT NULL` (cheap, useful).
4. Decide enum extensions: `workplace='onsite_or_remote'`; `salary_period` values 'HOUR'… already lowercase in SPEC.
5. `company_boards.board_token` derivation: resolver needed (ats-scrapers' `resolve.py` port, ~600 lines of URL patterns).
6. `companies` unchanged (industry etc. stay ours) but gain ats+slug provenance only via boards.

### 3.3 Job → hc.sqlite (what Hiring Cafe holds that the Job schema doesn't, and vice versa)

| hc.sqlite (jobs/companies) | Job equivalent |
|---|---|
| `object_id` = `source___board___req` composite | `global_id` (same idea, provenance-ful, deterministic) |
| `board_token`, `source` | `ats_id`/`ats_type` |
| `collapse_key`, `strict_dedup_cluster_id`, `liberal_dedup_cluster` | **no equivalent** — hiring.cafe's own dedupe clusters (GPT-produced cross-ATS clusters); our SPEC dedupe_key is title+geo only |
| `company_id` joined `companies` dimension (website, industry, org type, employee_count, funding, HQ country, stock symbol, aliases/subsidiaries) | **no equivalent** — a `Job.company` display name only; the companies parquet has 4 columns (ats, name, slug, url) |
| `attributed_org_name/id` | no equivalent |
| `location_raw`, `latitude/longitude`, `job_locations` (scope/level rows + country_code) | `location`, `lat/lon`, `locations[]` — richer normalization on hc side |
| `salary_min/max/frequency/yearly-normalised`, `is_compensation_transparent` | `salary_min/max/period`; no normalisation, no transparency flag |
| `seniority_level`, `yoe_min`, `management_yoe_min`, `role_type`, `requirements_summary`, `core_job_title`, `visa_sponsorship` | none of these exist in `Job` (except `experience` integer); all are hc's LLM output — our SPEC gets them from OUR tagging (§6.3), which is the right place |
| `first_seen_at`, `last_seen_at`, `is_expired` | `fetched_at` (+dataset-level absence = expiry; no per-job flag in hosted). Note `is_expired`=0 for all 25,269 rows (see §4: hiring.cafe never marked anything expired) |
| `descriptions` (html+text+markdown) | `description` (plain text only) |
| facets (shifts, physical demands, degrees, licenses, languages, tools, activities) | nothing — all would be our LLM tagging's job |

hc.sqlite columns NOT representable in `Job`: 20+; job-side fields NOT in hc.sqlite: `lat/lon`
direct columns but at jobs level hc has them; Item of note: hc has *enrichment*; ats-scrapers has
*provenance fidelity* (`raw`, `source_updated_at`, `application_deadline`).


## 4. M3 — Delta and expiry design

### 4.1 What exists to diff

- **Hosted dataset**: `by_date` is empty (§1). The only atomic units are manifest→full-snapshot /
  per-ATS slices, regenerated by Stapply (manifest `generated_at` 2026-11-18T23:27Z, read on
  2026-11-20 → observed age ≈ 1.5 days at fetch). "Daily snapshot diffs" therefore means, today,
  *we* keep yesterday's slice and diff against today's, per ATS; no served delta exists. The
  manifest schema anticipates `by_date` deltas, so this may arrive later.
- **Ours (SPEC §6.2/§6.3)**: polls are per-board with ETag/content-hash conditional GETs — deltas
  come from the ATS itself, not reconstructed.

### 4.2 Design (hosted-snapshot ingestion, for comparison in §7)

For each tracked `ats`:

```
D_t = today's slice (parquet), D_{t-1} = yesterday's (kept in our SQLite)
global_id(derived)  = '{ats_type}:{ats_id}'   (first-colon rule, same as models._populate_global_id /
                                             client._normalize_dataset())
content_hash(row)   = sha256(title | apply_url_norm | location | salary_min/max/currency/period |
                             employment_type | department | description_hash | posted_at)
new      = global_id ∈ D_t − D_{t-1}                    → INSERT, first_seen_at=now
changed  = global_id ∈ D_t ∩ D_{t-1}, content_hash ≠    → UPDATE posting (+ apply_url change)
missing  = global_id ∈ D_{t-1} − D_t                    → candidate closed
closed   = missing from two consecutive successful reads (SPEC §6.2) → closed_at; queued apps skipped
```

Rules that keep us from ever applying to a closed or duplicate role:

1. **Never trust one absence.** `missing` sets `missing_polls += 1`; two successes without the row
   → `closed_at`. A failed/stale read freezes counts: don't increment on read failure, and don't
   compare against an artifact older than last read (`manifest.generated_at`).
2. **Snapshot lag interplay.** If the hosted snapshot lags real closures by L days, a posting closed
   today still appears for up to L days, so closure takes `2×poll + 2×L`; with L≈2 (the measured
   manifest age above) a closed role stays "open" in the catalog ≈ 3 days. This is acceptable only
   because SPEC §9.3 step 6 re-checks liveness on the ATS API immediately before sending: the lag
   costs one wasted dispatch slot, never a wrong application. Snapshot-based closure is catalog
   hygiene; the pre-send liveness fetch is the hard guarantee. The same logic bounds `new`: postings
   reach us up to L+interval days after publication — much slower than our per-board trickle.
3. **Dedupe.** `dedupe_key` (`company_id + title_norm + country_code + city`, SPEC §6.2) is applied
   at insert; cross-board duplicates keep the earliest posting. Reposts — same dedupe_key returning
   with a *new* global_id — are caught by the 60-day repost guard, not by the snapshot diff,
   because a new global_id is indistinguishable from a new job.
4. **UUID4 global_id fallback** (ats_id missing/malformed; `models.py::_populate_global_id`):
   non-deterministic ids — diff on apply_url_norm hash instead. 0 rows hit it on the Ashby slice,
   but the code path exists and hosted v2 rows derive global_id client-side
   (`client.py::_normalize_dataset`), so our ingester must derive it with the identical rule.
5. **No per-row expiry signal in hosted data**: v2.0 slices drop `application_deadline` and
   `fetched_at`, and there is no is-expired flag. Absence is the only closure signal.

### 4.3 Test on real snapshots

Three crawl snapshots of hc.sqlite exist (`hc.sqlite` final; `hc-snapshot-0003.sqlite` ≈ 00:03;
`hc-snapshot-2332.sqlite` ≈ 23:32 the prior night). Diff on their primary key `object_id`
(the HiringCafe `source___board___req` composite — exactly the global_id pattern):

```
rows: A(23:32) 25,196 | B(00:03) 25,269 | C(final) 25,269
A->B: new 73   gone 0   common 25,196   changed: title 0, published_at 0, apply_url 1
B->C: new 0    gone 0   common 25,269   changed: 0 everywhere
A-present AND absent from both later reads (closed under 2-consecutive rule): 0
new-in-B persisting into C: 73
jobs in A and C with identical last_seen_at: 96.3%
```

Reading: over a 31-minute span, the diff cleanly separates **new** (73) from **changed** (1
apply_url) from **gone** (0), and the two-consecutive rule correctly closes nothing — no false
closures. These are crawl-progress snapshots 30 min apart, so they exercise the new/changed paths,
not expiry. On expiry the evidence is negative: in hc.sqlite `is_expired=1` for **0 of 25,269**
rows (`SELECT is_expired, COUNT(*) FROM jobs GROUP BY 1`), and in the October month-run export
every one of the 16,213 unique URLs reappears in the Nov 13–20 week crawl (overlap 100 %) —
hiring.cafe did not visibly expire anything over a month, so a missing-from-two-reads rule against
a Hiring Cafe catalog would almost never fire. The same caution applies to Stapply: absence
reflects the *generator's* retention, which is unpublished (risk, §8).
