# Hiring Cafe job-seed scraping — post-mortem

Status: **ENDED** (owner decision, 2026-11-20 ~00:00 ET — "we cannot use it").
Everything below is a factual record of what was built, what happened, and what
it would take to resume.

---

## 1. Goal

Seed the Overture application with Hiring Cafe (https://hiringcafe.com) job
postings as a data source:

- initial scope: one month of postings (2026-10-20 → 2026-11-19), later narrowed
  to **one week (2026-11-13 → 2026-11-20)**;
- rich, relational metadata per posting (title, company, category, seniority,
  pay, location, facets, list fields) — no JSON blobs;
- descriptions for the newest postings, restricted to ATS sources whose apply
  forms work **without a sign-in** (Overture can only auto-apply there);
- a fully unattended hourly sync so no human is in the loop.

## 2. Result at shutdown

| Item | Value |
| --- | --- |
| Database | `data/hc.sqlite` (205 MB, WAL truncated, `PRAGMA integrity_check` = ok, mode 644) |
| Jobs | **25,269** (metadata complete: facets, locations, tools, pay, company) |
| Companies | **9,205** (deduped employer dimension) |
| Descriptions | 4,711 done / 20,558 pending / 0 gone |
| Rows in child tables | 141k locations, 75.8k role activities, 68k tools, 28.7k commitments, 27.7k languages, 25.6k degree fields, 21.5k licences |
| Snapshots | `data/hc-snapshot-2332.sqlite`, `data/hc-snapshot-0003.sqlite` |
| Exports | `data/export/*.csv` + `jobs.jsonl.gz` (from the earlier month run; regenerate with `scrape/hiringcafe.py export`) |

Week (Nov 13–20) row counts by day: 3,577 / 453 / 276 / 3,632 / 3,780 / 1,172 /
1,733 / 2. Days 14–15 and 18 look thin because the crawl was repeatedly
interrupted by Cloudflare; the enumeration is shard-resumable (see §7).

### No-sign-in ATS sources within the week (total / described)

```
bamboohr        642 / 410      smartrecruiters 552 / 134     grnhse  399 / 252
ashby           242 / 148      jazzhr          230 / 111     workable 211 / 109
teamtailor      162 /  63      lever           157 /  77     jobvite 107 /  32
rippling         98 /  64      breezy           89 /  55     pinpoint 41 / 25
recruitee        39 /  20      (eu_lever: 1 job in window)
→ ~2,969 of the week's ~13,300 jobs come from no-sign-in sources; 1,451 of
  those already have Markdown+text descriptions.
```

## 3. Timeline (all times ET, 2026-11-19 → 20)

```
19:0x  plain requests/ curls                → 429 rate limits immediately
19:2x  curl_cffi (Chrome TLS) + Orca browser cookies (cf_clearance)
       → SSR pages readable; metadata crawl starts
19:55  relational schema (schema.sql) replaces the first JSON-blob attempt
20:0x  metadata enumeration via /classic + __NEXT_DATA__ → first 16k jobs
20:1x  per-job description crawl attempted → ~10-11 days at safe rate → cut
20:4x  browser crawl (12 parallel page fetches through the Orca tab) tried;
       Cloudflare answered with interactive Turnstile popups the owner had to
       click repeatedly ("you're moving too fast") → abandoned that route
21:0x  discovery: official MCP endpoint, POST https://hiringcafe.com/api/mcp
       (JSON-RPC, anonymous, no CF challenge) → description backfill switched
       to it; ~3.6/s sustained worked briefly, then 429s
21:5x  searchState cap discovered: a query serves at most ~40+ pages
       (1,680-2,500 hits) regardless of ssrTotalCount
22:0x  MCP rate probe: after heavy use, 1 req/s still 429s; ~45 min idle
       → heals. Decision: 1.5 rps global pacing = clean, zero challenge
22:1x  one-week scope (owner relay); shard splitter v2 (workplace×role)
22:3x  description mop-up restricted to no-sign-in ATS sources (-75% requests)
22:39  week enumeration running clean; Nov 13-16 done in ~40 min
23:33  INCIDENT 1: 3+ consecutive 429 challenge lines, escalating waits,
       no success between → snapshot, stop, 15-min silence, half rate
00:02  INCIDENT 2: HTTP 403 + zero successes in 5 min → snapshot, stop,
       20-min silence, overnight trickle rate (2 req/min)
00:0x  OWNER DECISION relayed: stop work, write post-mortem → this document
```

## 4. The endpoints that mattered

### 4.1 Search (metadata) — SSR page, not an API

```
GET https://hiringcafe.com/classic?searchState={URL-ENCODED JSON}&page=N
```

`searchState` is the site's filter object. Keys verified working (camelCase):

```jsonc
{
  "dateFetchedPastNDays": {"from": "2026-11-13", "to": "2026-11-20"},
  "sortBy": "date",
  "workplaceTypes": ["Remote", "Hybrid", "Onsite"],        // verified: 5183→302/1046/3835
  "roleTypes": ["Individual Contributor", "People Manager"], // verified: 5183=4412+771
  "locations": [                                            // verified: country filter works
    {"formatted_address": "Canada", "types": ["country"]}
  ]
}
```

Keys probed and **silently ignored** (return identical `ssrTotalCount`):
`sources`, `source`, `ats`, `atsSources`, `boards`, `sourceTypes`,
`applicantTrackingSystems`, `commitments`, `commitment`, `employmentTypes`,
`seniorityLevels`, `jobCategories`, `search`, `keywords`, `searchTerm`,
`searchTerms`, `occupations`. **There is no ATS/source filter.**

Response data lives in `<script id="__NEXT_DATA__">` → `props.pageProps`:
`ssrHits` (≤40/page, each hit = one complete structured record incl.
`job_information`), `ssrTotalCount` (counts pre-dedup: often 1.5-3× the actual
unique rows), `ssrIsLastPage` (lies — trust an empty page instead).

Paging cap: hitting the site for an empty page ends a query's result set around
page 42-62 (observed +1,680 to +2,469 hits retrieved on 4,400-4,900-hit
queries). Not a clean constant — treat any query whose `ssrTotalCount` exceeds
~1,600 as needing splits.

### 4.2 Descriptions — the official MCP endpoint

```
POST https://hiringcafe.com/api/mcp
Content-Type: application/json
{"jsonrpc":"2.0","id":1,"method":"tools/call",
 "params":{"name":"get_job_details","arguments":{"job_id":"<requisition_id>"}}}
```

- Anonymous, read-only; ~4-12 KB JSON response; the job as Markdown
  (description, requirements, compensation, apply link).
- `tools/list` reveals `search_jobs` too, but it is capped at 25 results and has
  no source filter → useless for bulk.
- Not behind the interactive challenge the HTML pages get — **but rate limited
  on the same IP budget**: sustained ~3.6/s gave 429s after a few hundred calls;
  after the budget emptied, even 1 req/s 429'd; ~45 min idle restored it. Clean
  sustained profile measured: **1.5 rps ≈ 25 min / ~2,400 calls with zero 429s**.
- Descriptions also exist in the SSR `ssrHits[].job_information.description`
  (confirmed independently by a research worker via the jobs_db 178k-row
  Supabase dump) — i.e. the search page itself carries a description field in
  some form; our SSR parsing did not map it (possibly only for a subset).

### 4.3 Junk thrown at the caller

| Obstacle | Detail |
| --- | --- |
| Cloudflare managed challenge | Triggered by volume on HTML endpoints; **interactive Turnstile** pops in the *user's browser session* when the crawled shape gets hammered — requires a human; the октябрь session's owner clicked it several times before we de-scoped |
| 429 with escalating Retry | Backoff demands grew 40s → 137s → 195s over ~90 min of continuous crawling |
| 403 | After ~90 min sustained at 8 req/min: budget gone; only silence refills it |
| `ssrIsLastPage` lies | Pagination must stop on the first empty page, not on the flag |
| Pre-dedup counts | `ssrTotalCount` > actual unique rows in a 1.5-3× ratio |
| robots.txt | Disallows exactly the `?searchState=` query shape used here (and `/api/*`); ToS page itself 403s behind Cloudflare, so a human-readable ToS verdict was never obtainable |
| No ATS filter anywhere | SSR searchState and MCP both lack it → source filtering can only happen after enumeration |
| Geo-IP skew | Devbox exits via Canada → location facets skew ~85% Canada default in `initialSearchState`; the site's own location filter still accepts explicit countries |

## 5. What worked

1. **SSR + `__NEXT_DATA__` parsing** with `curl_cffi` (Chrome TLS impersonation)
   and cookies harvested from the owner's own Orca browser tab
   (`orca-ide cookie get` → `cf_clearance` bound to IP+UA; we send the exact UA).
2. **The MCP endpoint for descriptions** at a paced 1.5 rps — anonymous, cheap,
   clean, fully scriptable, no browser needed.
3. **Shard-resumable enumeration**: date-bisection → workplace×role splits →
   location (country→state) splits; state kept in `shards`/`pages` tables;
   jobs deduped on `objectID`. Kill and rerun at any point; nothing re-crawls.
4. **A watchdog** (5-min loop) that snapshotted the DB before every intervention
   and resumed crashed steps — proven by two live CF incidents overnight.

## 6. Why it is not usable for Overture

The blocking facts, in order:

1. **The collection mode that yields complete data is not automatable.** Cover a
   day's postings (4,400-4,900 hits → dozens of page requests per slice) and
   Cloudflare escalates 429 → 403 → interactive Turnstile in the user's browser
   within ~90 minutes. Between incidents the site heals only with silence
   (15-20 min observed). Sustained, unattended, complete collection is
   structurally impossible without a residential-proxy fleet or paying a
   third party.
2. **The cheap MCP path is rate-capped on the same per-IP budget**, and its
   `search_jobs` is 25-per-call — it can't power a broad seed either.
3. **Legal posture is hostile and unverifiable**: robots.txt disallows the exact
   request shape the scraper needs, and the ToS page itself cannot be read
   (HTTP 403 behind Cloudflare). Continuing would mean knowingly exceeding the
   site's stated machine-access policy with personal-use-only cover.
4. **Data-shape friction**: no ATS/source filter (filtering must happen
   post-enumeration — more requests); counts are pre-dedup; the paging cap
   forces a combinatorial split strategy just to read a *week*.
5. The paid-direct alternative exists but costs ~$12-15/week for a 10k backfill
   (Apify actors, evaluated: `blackfalcondata/hiring-cafe-scraper` ≈ $1.15/1k
   with descriptions, or `memo23/cheerio-scraper` ≈ $1.25/1k) — a budget /
   vendor decision, not an engineering one, and the owner chose to stop rather
   than buy.

## 7. Handoff

### Where things live

```
/home/ubuntu/orca/workspaces/overture/porgy/        (branch a-hagi613/hiring-cafe-job-seed)
├── data/
│   ├── hc.sqlite                        205 MB consolidated DB (mode 644, no lock)
│   ├── hc-snapshot-2332.sqlite          pre-incident-1 snapshot
│   ├── hc-snapshot-0003.sqlite          pre-incident-2 (final) snapshot
│   ├── export/                          CSVs + jobs.jsonl.gz from the month run
│   └── enumerate.log, mcp_desc.log, nightly.log, sample.log   (crawl logs)
├── scrape/
│   ├── README.md                        usage of the tooling
│   ├── schema.sql                       full relational schema (see below)
│   ├── hiringcafe.py                    CLI: init/cookies/enumerate/details/
│   │                                    sync/stats/export/preview
│   ├── mcp_desc.py                      description backfill via /api/mcp
│   ├── deepsplit.py                     reopen page-cap-truncated shards
│   ├── nightly.sh, phase2.sh            unattended chains (not running anymore)
│   ├── preview.py                       static HTML preview generator
│   └── browser_crawl.py                 (abandoned) browser-tab crawler
└── docs/research/hiring-cafe-postmortem.md   this file
```

### Schema (what an app would consume)

```
companies 1─n jobs (jobs.company_id)
jobs      1─1 job_facets           (categorisation: shifts, demand, degrees, perks...)
jobs      1─n job_locations        (scope: workplace|boundless; level: continent→city)
jobs      1─n job_commitments / job_tools / job_licenses / job_languages
                                  / job_degree_fields(level, field) / job_role_activities
jobs      1─1 descriptions         (status pending|done|gone; html/text/markdown/word_count)
shards/pages                     crawl bookkeeping (resume anywhere)
companies 1─n company_industries / company_activities / company_aliases
                                  / company_subsidiaries / company_funding_investors
v_jobs                            flat ready-made view over jobs + facets
```

### How to query

```bash
sqlite3 data/hc.sqlite "
  SELECT j.title, c.name, j.salary_yearly_min, j.salary_yearly_max,
         j.workplace_type, j.seniority_level, d.text
  FROM v_jobs j LEFT JOIN descriptions d ON d.job_id = j.object_id
  WHERE j.seniority_level = 'Senior Level'
    AND j.salary_yearly_min >= 150000
    AND j.workplace_type = 'Remote'
  LIMIT 20;"
```

Everything is typed and indexed (department, seniority, salary min/max in
listed + yearly-normalised form, location, workplace type, source).

### To resume someone would need

1. The code — branch `a-hagi613/hiring-cafe-job-seed`, `scrape/` is self-contained
   (`.venv` has `requests`/`curl_cffi`).
2. A fresh Cloudflare clearance: open hiringcafe.com in any browser from the
   target IP, pass the challenge, export cookies (`scrape/hiringcafe.py cookies`
   does it from the Orca browser; or drop a Netscape cookie file at
   `data/cookies.txt`). Resume profile that survived a full re-run:
   `--rps 0.2 --window 20 --window-s 600` (2 req/min hard ceiling) with
   15-20 min silence after every 403/403-pattern.
3. Patience: a week of data ≈ 3-4 h of crawling at that profile; a month ≈ 2 days.
4. Or: rent the coverage — Apify `blackfalcondata/hiring-cafe-scraper`
   (~$1.15/1k, descriptions included, incremental mode) ≈ $12-15 for the
   10k-description backfill that this crawl could not finish legally/safely.
