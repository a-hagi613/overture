# Spike agent 1 — data quality: the Stapply hosted parquet snapshot

**Date of measurement:** 2026-11-20, 00:39–06:55 UTC. **Deliverable for epic #5:** decide whether
`kalil0321/ats-scrapers`' hosted Stapply dataset (plus selective LLM tagging) can replace the SPEC
v2 direct-ATS feeds as Overture's posting source.

Rules followed: everything below was measured in this session and every number cites the command
that produced it; `nice -n 10` on everything that hits a network; ≤2 rps; scratch data stays in
`/home/ubuntu/orca/workspaces/overture/spike-ats-out/` (never in git), only the report goes in the repo.

## Verdict lines

- **Freshness — PASS:** hosted manifest `https://storage.stapply.ai/jobs/v1/manifest.json`
  (`notes/m1_manifest.py`) is version "2.0", `generated_at = 2026-11-18T23:27:27.78Z`,
  90 ATS slices, `by_date` empty; the `all.parquet` object's `Last-Modified` (m1_headers.py) is
  2026-11-19 00:10:51 UTC. Snapshot age at pull: **29.5 h < 48 h**. Caveat: one observation cannot
  prove a daily cadence — this is consistent with 24 h and with 36 h.
- **Form-fillable URL rate — FAIL (static), FAIL (headless):** of the 20 random apply-URLs sampled
  from the three supported ATSes (7 greenhouse / 7 lever / 6 ashby; `notes/m5_sample.json` + m5_final.py),
  17/20 still resolve and are open (85 %) — three are API-closed — so even a perfect client tops out
  **< 90 %**. Statically (httpx only), just 11 of the 20 land on a server-rendered application form
  (55 %): Greenhouse serves its real form inline (15–44 fields, 5/5 of its live sampled rows), Lever
  serves it at `…/{co}/{id}/apply` (17–57 fields, 6/6 live), **Ashby renders zero fields server-side**
  (0/6; `jobs.ashbyhq.com/{org}/{id}/application` is a 36 kB JS shell — the form exists only after
  their client-side bundle boots). **With a headless browser for Ashby: 17/20 = 85 %, still FAIL.**

## 1. Manifest freshness (m1_manifest.py / m1_headers.py)

- `generated_at` 2026-11-18T23:27:27Z ↔ object `Last-Modified` 2026-11-19 00:10:51Z (43-min skew).
- HTTP HEAD: manifest itself re-uploaded 2026-11-19 20:39 UTC. Cadence unproven; `by_date` empty,
  no archive — nothing to compare against. A single 29.5 h gap is PASS-compatible evidence only.
- 90 ATS slices; each ships csv+parquet; per-slice sizes in `notes/manifest.json` (57 KB file).

## 2. Volume by ATS and country (m2_one.py, streaming row-groups)

| ATS | rows | distinct companies | CA | US | `url` non-null | `apply_url` non-null |
|---|---|---|---|---|---|---|
| greenhouse | 208,967 | 6,600 | 3,252 | 54,863 | 100 % | **0.00 %** |
| lever | 70,747 | 1,827 | 3,136 | 39,683 | 100 % | 100 % |
| ashby | 65,457 | 3,728 | 715 | 8,779 | 100 % | 100 % |
| workable | 109,310 | 5,330 | 4,839 | 48,034 | 100 % | **0.00 %** |
| smartrecruiters | 401,170 | 10,485 | 9,711 | 177,785 | 100 % | 99.80 % |
| workday | 1,074,386 | 4,628 | 9,481 | 81,904 | 100 % | **0.00 %** |

Six slices = 1,930,037 rows, 32,598 distinct (ATS, company) pairs (some companies run >1 ATS,
hence 29,588 distinct company names — left for the census). The SPEC slice (greenhouse+lever+ashby)
= 345,171 rows / 12,155 distinct companies. CA+US in the SPEC slice: 7,103 + 103,325 = 110,428
(**32.0 %** of SPEC-slice rows name a CA/US country). Workday is the largest single source at
1.07 M rows (55.7 % of the material) but is not in Overture's supported feed list — of the
*supported* six-slice set, greenhouse is 11 %, lever 3.7 %, ashby 3.4 %, workable 5.7 %,
smartrecruiters 20.8 % by volume.

## 3. Null rates (m2_one.py; full per-ATS table `notes/m3_results.txt`)

`non-null` = pyarrow null count; `non-empty` = strip() non-empty share.

| ATS | description | location | country_iso | is_remote | salary_min | salary_max | salary_currency | salary_period | salary_summary |
|---|---|---|---|---|---|---|---|---|---|
| greenhouse | 100 % | 100 % | 36.06 % | 0 % | 0 % | 0 % | 0 % | 0 % | 0 % |
| lever | 99.57 % | 99.88 % | 93.04 % | 77.68 % | 33.01 % | 33.01 % | 33.01 % | 31.45 % | 0 % |
| ashby | 99.97 % | 100 % | 19.61 % | 86.92 % | 39.66 % | 39.66 % | 39.66 % | 39.66 % | 40.00 % |
| workable | 100 % | 100 % | 96.19 % | 100 % | 0 % | 0 % | 0 % | 0 % | 0 % |
| smartrecruiters | 99.83 % | 100 % | 72.03 % | 100 % | 0 % | 0 % | 0 % | 0 % | 0 % |
| workday | 99.64 % | 94.01 % | 11.16 % | 3.09 % | 0 % | 0 % | 0 % | 0 % | 0 % |

- **No salary anywhere**: `salary_min/max` max non-null is 39.7 % (ashby, and only those postings
  that publish compensation); `salary_summary` is 100 % null across all 1.93 M rows. Overture's
  salary-floor filter sees money on ≤ 40 % of rows at best.
- **`is_remote` deranged**: greenhouse 0 % but lever 77.7 % – the two ATSes bucket remote
  differently; workday 3.1 %. Workplace tagging must be derived from title/location text (SPEC §6.3),
  the column alone is unusable.
- **`country_iso` is thin in the SPEC slice** (36 % greenhouse / 20 % ashby) → the GeoNames
  location fallback is doing the geo work for ≥ 68 % of the slice.
- `location` and `description` are healthy (> 99.5 % everywhere); `lat/lon` exist for ~every row
  with a location; `language` is mostly null (not in table — Trigram detector on title text only).

## 4. The 600-row sample for agent 2 (m4_sample.py → data/sample-600.parquet)

- 600 rows, all 27 columns, all `large_string`-cast for pyarrow compat; stratified
  200 greenhouse / 100 lever / 100 ashby / 100 workable / 100 smartrecruiters, US(581)+CA(19) only,
  unique on `url`; `description` truncated to 500 chars, `raw` (the source HTML blob) dropped
  — 1.10 MB file, sha256 `610b76d07a02…972f2b1` in `notes/sample600.sha256`.
- 300/600 rows carry a parsed `apply_url`-equivalent; the rest need the §1 rebuild.

## 5. The live 20-URL sample (`notes/m5_final.py` → `notes/m5_final.json`)

Seeded random (seed 42) from the three supported slices, fetched 2026-11-20 06:40–06:55 UTC,
one shared httpx client at ≤ 2 rps, Cloudflare-clean throughout.

- **Resolve: 20/20 final-page 200** after redirects (0–2 hops); final hosts are the expected
  `job-boards.greenhouse.io`, `jobs.lever.co` (+`jobs.eu.lever.co`), `jobs.ashbyhq.com`, plus one
  brand-domain Greenhouse page (`www.airlockdigital.com/openings?gh_jid=…`) and one `-1` →
  `job-boards…?error=true` bounce for the API-closed row.
- **Open vs closed, cross-checked against each public read API:**
  - Greenhouse `boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}`: **5/7 open** (exact-id +
    title match), **2/7 API-closed** (`benchmarkpt` 404, `airlockdigital` 404) while their job-boards
    pages still return renderable pages/`?error=true` shells.
  - Lever `api.lever.co/v0/postings/{co}/{id}`: **6/7 open**; the closed one (`IVC`, posted 2026-10-23)
    404s at both the page and the API while still in the snapshot.
  - Ashby `api.ashbyhq.com/posting-api/job-board/{org}`: 6/6 found + `isListed` (30–498 jobs asked
    per board) — but listing liveness ≠ availability; Ashby rows linger in the snapshot after
    unlisting (`m6_fallback.py` board-diff: live 52 vs snapshot 59 = **−7 rows in ~30 h (board-diff 2026-11-19 00:10 build vs 2026-11-20 06:40 re-fetch)**, −11.9 %).
- **Closed-row staleness measured:** the 3 API-closed rows were posted 131 d (airlock),
  49 d (benchmark), 28 d (IVC) before sampling and **all 3 are still listed** — evicted postings
  hang around ≥ 4 weeks; meanwhile **open rows can be 9.4 years old** (two BoxLunch Lever postings
  from 2017-06-13 and 2021-08-16, both API-200, still in the snapshot). The snapshot does not age
  or evict; `closed_at`/`is_open` does not exist to reason from.
- **Statically form-fillable: 11 of 20 (55 %)** — greenhouse 5/5 server-rendered forms,
  lever 6/7 (the closed one is a 404), **ashby 0/6 JS-only**. With headless rendering for Ashby:
  **17/17 of live rows** have a form; of the original 20, 17/20 = **85 %, short of the 90 % bar
  wherever headless coverage is limited to Ashby** (the two GH-closed and one LV-closed rows are
  unfillable regardless of rendering).

## 6. Live fallback (`m6_fallback.py`): `get_scraper_for_url()` + `afetch()`, one company per ATS

- greenhouse `comparaja`: GreenhouseScraper, **65 live** (snapshot 65, Δ 0) — but `afetch()` pulls
  the board list only (no description/`;location` payload), so it is a liveness oracle, not a feed.
- lever `boxlunch`: LeverScraper, **4,663 live** (snapshot 4,662, **+1 posted overnight**) — the
  board-list covers the full feed, 4,663 of 70,747 rows from one board ≈ 6.6 %.
- ashby `pragmatike`: AshbyScraper, **52 live** (snapshot 59, **−7***, — unlisted rows) — the API
  list is the live board.
- Verdict: `afetch()` sees the same truth the ATS APIs see, ~0.6 s per call for Ashby's list,
  ~1.2 rps sustained for GH/Lever. As a fallback *feed* it is only as complete as the board-list
  approximation; as a liveness gate for §9.3 it worked on 3/3 in this run.

## Risks for the v2 seed (each tied to a measured number)

1. **Salary is a non-starter from the snapshot.** 0 % salary_summary / ~0-40 % salary_min/max
   (1.93 M rows) — the SPEC's salary-floor filter and the "posted_with_salary" tag would run on
   ≤ 40 % of postings, patient-negative for engineering roles. The tagging plan's salary parse must
   run on the description text (live per-job fetch) or the feature is out.
2. **Snapshot is not an apply-target store.** greenhouse `apply_url` 100 % null; api-form store keys on `url` — the
   api-form store keys on `url` (100 % present) + per-ATS rewrite rules (`job-boards…/{token}/…`).
   Any §6.2 design keyed on apply_url sees 0 % of greenhouse/workday workday rows.
3. **Closed rows linger ≥ 4 weeks; open rows linger 9.4 y.** No closed_at, no eviction, no
   age filter → Overture cannot trust the snapshot alone: every dispatch needs the §9.3 liveness
   re-check, and the sample shows why (3/20 unfillable at the URL, 7 row-drift in hours).
4. **Ashby = client-render only** (0/6 static): form shipping needs the managed-browser flow for
   ~3.4 % of the supported catalog; the tagging probe cannot verify Ashby questions server-side.
5. **`country_iso` 32 % in the SPEC slice; `is_remote` incomparable** — GeoNames city/reverse
   lookup + text inference (already SPECCED §6.3) is doing 68 % of the geo work here.

## Handoffs left for other agents

- `data/sample-600.parquet` (sha256 `610b76d0…972f2b1`) is ready for agent 2's tagging probe.
- Board-diff evidence: `notes/m6_results.json`; live-sample detail: `notes/m5_final.json`.
