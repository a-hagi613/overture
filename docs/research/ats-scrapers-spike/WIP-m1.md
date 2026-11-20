# ATS-scrapers spike 1 — data quality, freshness, apply_url audit (WIP milestone 1)

Mirror of /home/ubuntu/orca/workspaces/overture/spike-ats-out/1-data-quality.md (canonical report).
Measurement scripts under docs/research/ats-scrapers-spike/scripts/.

## Environment
- venv: /home/ubuntu/orca/workspaces/overture/spike-ats-out/.venv (`uv venv` + `uv pip install 'ats-scrapers[parquet]'`), ats-scrapers 0.4.0.
- Per-ATS parquets downloaded to spike-ats-out/data (greenhouse 148 MB, lever 42 MB, ashby 69 MB, workable 109 MB, smartrecruiters 183 MB, workday 589 MB).

## M1 freshness (measured 2026-11-20 05:40 UTC)
- Manifest https://storage.stapply.ai/jobs/v1/manifest.json: `generated_at = 2026-11-18T23:27:27Z`, version 2.0,
  90 ATS slices, 7,663,818 total rows, 146,406 companies. HTTP Last-Modified of manifest.json: 2026-11-19 20:39 UTC.
- all.parquet Last-Modified: 2026-11-19 00:10:51 UTC; per-ATS slices uploaded 2026-11-18 23:32-23:42 UTC.
- by_date: empty. Wayback CDX: no captures. Cadence evidence pending manifest re-poll deltas.

## M2 volume by ATS (scripts/m2_one.py)
| ATS | rows | distinct companies | CA | US |
|---|---|---|---|---|
| greenhouse | 208,967 | 6,600 | 3,252 | 54,863 |
| lever | 70,747 | 1,827 | 3,136 | 39,683 |
| ashby | 65,457 | 3,728 | 715 | 8,779 |
| workable | 109,310 | 5,330 | 4,839 | 48,034 |
| smartrecruiters | 401,170 | 10,485 | 9,711 | 177,785 |
| workday | 1,074,386 | 4,628 | 9,481 | 81,904 |
All `url` values unique per ATS (dist_url == rows). Manifest-other slices: eures 1.91M, bundesagentur 0.99M, etc.

## M3 null rates (scripts/m3_nulls.py) — non-null % (url / apply_url / description / location / country_iso non-empty / is_remote / salary_min..salary_summary)
- greenhouse: apply_url 0.00%, is_remote 0.00%, salary* 0.00%, country_iso non-empty 36.06%
- lever: apply_url 100%, is_remote 77.68% non-null, salary_min/ 33.01%, country_iso non-empty 93.04%
- ashby: apply_url 100%, is_remote 86.92%, salary 39.66-40.00%, country_iso non-empty 19.61%
- workable: apply_url 0.00%, is_remote 100%, salary* 0.00%, country_iso non-empty 96.19%
- smartrecruiters: apply_url 99.80%, is_remote 100%, salary* 0.00%, country_iso non-empty 72.03%
- workday: apply_url 0.00%, is_remote 3.09%, salary* 0.00%, country_iso non-empty 11.16%

## M4 sample for agent 2 (done)
- /home/ubuntu/orca/workspaces/overture/spike-ats-out/data/sample-600.parquet
- 600 rows, 27 columns, US(581)+CA(19) only, GH 200 / LEV 100 / ASH 100 / WBLE 100 / SR 100,
  425 distinct titles, sha256 610b76d07a02f0647e8470fbd02456d805f9a4c7625da5a8e87534272f5712b1.
