# HiringCafe seed data

Pulls one month of job listings from [hiringcafe.com](https://hiringcafe.com) into a
normalised SQLite database, then exports it as CSV + JSONL for the app to consume.
Personal, read-only use.

## How the data is obtained

HiringCafe is a Next.js app behind Cloudflare; there is no public API. Its own front-end
reads two server-rendered pages, and we read the same two:

| Page | Gives us |
| --- | --- |
| `/classic?searchState=…&page=N` | 40 postings per page. Each posting carries its full structured record in `<script id="__NEXT_DATA__">` — title, company facts, location, pay, department, seniority, requirements, tools, licences… |
| `/job/<requisition_id>` | the posting itself, including `job_information.description` (HTML). |

`searchState` is the site's entire filter object serialised into one query param, so the
corpus is sharded by **fetch-date range** (`dateFetchedPastNDays: {from, to}`), sorted by
date. Pagination is capped at page 250 (10 000 hits), so any window reporting more than
~9 000 hits is bisected. The `ssrIsLastPage` flag the payload exposes is unreliable — the
crawler walks pages until one comes back empty.

Cloudflare is the only access control: no login is needed, but datacentre IPs get
challenged. The crawler reuses the cookies (incl. `cf_clearance`) of a logged-in Orca
browser tab and sends that browser's exact User-Agent, because the cookie is bound to
IP + UA. It crawls at <1 req/s, backs off on 429 and re-pulls cookies automatically.
If the browser shows a "Verify you are human" box, a human has to tick it once.

## Schema

Defined in [`schema.sql`](schema.sql). Normalised, typed, no JSON blobs:

```
companies ──< jobs ──< job_facets                      (1:1 categorisation per posting)
                ├──< job_locations                     (workplace + boundless, by level)
                ├──< job_commitments                   (Full Time, Contract, …)
                ├──< job_tools
                ├──< job_licenses
                ├──< job_languages
                ├──< job_degree_fields                 (level: associates…doctorate)
                ├──< job_role_activities
                └──   descriptions                     (html, text, word_count, status)
```

`companies` is a deduped employer dimension with its own child tables
(`company_industries`, `company_activities`, `company_aliases`, `company_subsidiaries`,
`company_funding_investors`).

Key columns on `jobs`:

| group | columns |
| --- | --- |
| identity | `object_id` (PK, HiringCafe objectID), `requisition_id` (UNIQUE, `/job/<id>`), `collapse_key`, `strict_dedup_cluster_id`, `liberal_dedup_cluster`, `original_source_id` |
| provenance | `source` (ATS slug), `board_token`, `apply_url`, `job_url`, `attributed_org_name` |
| what | `title`, `core_job_title`, `department`, `role_type`, `seniority_level`, `yoe_min`, `management_yoe_min`, `requirements_summary` |
| where | `location_raw`, `workplace_type`, `latitude`, `longitude` + `job_locations` |
| pay | `salary_currency`, `salary_frequency`, `salary_min`, `salary_max` (listed frequency), `salary_yearly_min`, `salary_yearly_max` (normalised), `is_compensation_transparent`, `visa_sponsorship` |
| when | `published_at`, `first_seen_at`, `last_seen_at`, `is_expired` |

`job_facets` holds everything HiringCafe categorises but doesn't put on the card:
physical/cognitive demand, shift requirements, travel, security clearance, degree
requirements per level, licence flag, relocation, perks (`401k_matching`,
`tuition_reimbursement`, …), fair-chance/veteran flags.

A ready-to-use join lives in the view **`v_jobs`**.

## Commands

```bash
python3 scrape/hiringcafe.py init           # create the schema
python3 scrape/hiringcafe.py cookies        # (re)pull cookies from the Orca tab
python3 scrape/hiringcafe.py enumerate --from 2026-10-20 --to 2026-11-19
python3 scrape/hiringcafe.py details        # backfill description html/text
python3 scrape/hiringcafe.py stats
python3 scrape/hiringcafe.py export         # data/export/*.csv + jobs.jsonl.gz
python3 scrape/hiringcafe.py preview        # data/preview.html (browse it in the Orca browser)
```

`enumerate` and `details` are resumable — progress lives in `data/hc.sqlite`
(`shards`, `pages`, `descriptions.status`). Kill and rerun freely.

## Output

`data/export/`:

* `jobs.csv` — one row per posting, from `v_jobs`
* `companies.csv`, `job_facets.csv`, `job_locations.csv`, `job_commitments.csv`,
  `job_tools.csv`, `job_licenses.csv`, `job_languages.csv`, `job_degree_fields.csv`,
  `job_role_activities.csv`, `company_*.csv`
* `jobs.jsonl.gz` — nested record per posting (job + company + facets + lists +
  description) for direct import

## Etiquette

One job board, one machine, <1 req/s, no auth bypass — only a session the user already
owns. Scope is bounded by `--from/--to`. Intended for personal use.
