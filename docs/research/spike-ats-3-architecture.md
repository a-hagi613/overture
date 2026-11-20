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

---

*(M2–M5 sections are appended as they are completed.)*
