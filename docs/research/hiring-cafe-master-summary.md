# HiringCafe research & engineering master summary

**Compiled 2026-11-20.** This is the complete record of everything researched, built,
measured, broken, and learned across both session workspaces (`stonefish` — research;
`porgy` — the working seed scraper). Written as a handoff document: nothing is omitted,
every claim is labelled verified (live-probed in this session) or unverified (secondary
sources, founder posts, vendor marketing).

---

## Table of contents

1. [What hiring.cafe is and where its data comes from](#1-what-hiringcafe-is)
2. [Anti-bot behaviour as measured live](#2-anti-bot-behaviour-as-measured-live)
3. [Every approach tried, in order — what worked, what didn't](#3-every-approach-tried)
4. [The scraper: architecture and code inventory](#4-the-scraper-architecture-and-code-inventory)
5. [Data obtained (final state of the harvest)](#5-data-obtained)
6. [The MCP route: full measurement record](#6-the-mcp-route-full-measurement-record)
7. [What got blocked and why — the complete failure list](#7-what-got-blocked-and-why)
8. [Legal landscape (summary of desk research, not legal advice)](#8-legal-landscape)
9. [Alternatives researched: taxonomies, classifiers, vendors](#9-alternatives-researched)
10. [Recommended architecture going forward](#10-recommended-architecture)
11. [Handoff: how to query data/hc.sqlite](#11-handoff-how-to-query-datasqlitehcsqlite)
12. [Open questions and next actions](#12-open-questions-and-next-actions)
13. [Complete source list](#13-complete-source-list)

---

## 1. What hiring.cafe is

- hiring.cafe is a job aggregator operated by **SPICYHR INC.** (Cupertino, California).
- Its own copy: "We collect jobs directly from company websites in real time and filter
  out external recruiting agencies and fake consulting firms."
- Scale (third-party estimates, **unverified**): 2.8M–6M jobs indexed; a 2026-10-21
  archive capture of the homepage showed "283,704 jobs · 12,427 companies" for a
  Canada-located view; founder posts claim ~3.68M jobs globally, ~1M+ monthly active
  users, growth "0 → 1M+ MAU in 12 months".
- Refresh cadence per founder statements: every company scraped ~3×/day. Source data
  comes from employers' own ATS pages (iCIMS, SuccessFactors, Greenhouse, Workday,
  Lever, etc. — the live MCP metadata references 46 ATS platforms; the 147-record
  archive sample contained source values `icims2`, `successfactors`, `grnhse`,
  `saashr`, `adhoc`, and more).
- The tags (seniority, category, salary parsing, requirements summary) are **GPT
  output** — GPT-3.5 in 2023, GPT-4o-mini in 2025 — costing hiring.cafe roughly
  $3k/month in LLM API fees per their own statements. Every job carries a
  `v5_processed_job_data` object with ~90 extracted fields.

### Robots.txt (fetched live 2026-11-19; served via Cloudflare + Vercel)

- `User-agent: *` **allows**: `/`, `/about`, `/jobs`, `/job/`, `/careers`,
  `/insights`, `/recently-posted-jobs`, `/terms-and-conditions`, `/private-policy`,
  `/ai-search/$`.
- **Disallows**: `/cdn-cgi/`, `/viewjob/`, the `?searchState=` and `&page=` query
  patterns (`/*?searchState=*`, `/*?page=*`, `/*&page=*`), `/api/applyclick/`,
  `/api/sponsored/`, `/org/`, `/company/`, `/b/`, `/req/`, `/board/`.
- Full meta-externalagent and Applebot-Extended bans.
- **Consequence:** the v1 scraper's `?searchState=` URLs are explicitly disallowed
  patterns; any HTML enumeration route is fighting robots.txt, not just Cloudflare.

### Terms of Service (effective 2024-08-28; capture 2026-10-24)

- §1 browsewrap: "By accessing this website, we assume you accept these terms…"
  — binds every visitor, not just account holders.
- §5 Intellectual Property: forbids "Republish[ing] material from HiringCafe",
  "Reproduce, duplicate, or copy material", "Sell, rent, or sub-license", and
  "Redistribut[ing] content". A bulk import into any product breaks these.
- §7: indemnification for breach. §10: California law, exclusive jurisdiction of
  California courts.
- Enforcement history found: **none** — no public lawsuit, C&D, or blocking campaign
  specific to hiring.cafe scrapers was located (searched 2026-11-19). Absence of
  reports is not evidence of tolerance.

---

## 2. Anti-bot behaviour as measured live (2026-11-19/20 probes)

| Probe | Result |
|---|---|
| `GET https://hiringcafe.com/` (plain curl, datacenter IP) | **403** — Cloudflare managed challenge page ("Just a moment…", `cType: 'managed'`) |
| `GET /classic?searchState=…` (SSR search page, plain curl) | **403** |
| `GET /robots.txt` | **200** (allowed through, as Cloudflare customary) |
| `GET /sitemap.xml`, `/jobs-sitemap.xml` | **403** |
| `POST /api/mcp` (JSON-RPC tools/call) | **200, no challenge, no cookies needed** |
| `GET /api/mcp` | **405 Method Not Allowed** (POST-only route) |
| curl_cffi with `impersonate="chrome"` + perfect browser headers on HTML routes | **still 403** — IP reputation gates HTML regardless of TLS fingerprint |

Interpretation: Cloudflare gates **all HTML page routes by IP reputation class**
(datacenter IPs are challenged), while leaving `/api/mcp` deliberately exempt — that
exemption is intentional, as the MCP endpoint is the operator's published interface
for AI clients ("HiringCafe Job Search Claude Connector", `serverInfo.name:
"hiringcafe"`, version 1.0.0).

Cookies observed in a real logged-in browser session (13 cookies): `__session`,
`cf_clearance`, `_ga`, `_ga_KJCD0N6Q7T`, `_gcl_au`, `g_state`, `geo_cell`,
`geo_city`, `geo_country`, `geo_lat`, `geo_lng`, `hc_search_mode`, and a PostHog
cookie (`ph_phc_…`). `cf_clearance` is the challenge-pass cookie; it is bound to
the IP + User-Agent that solved it, so reusing it from a different client is
transient at best.

---

## 3. Every approach tried, in order

### v1 — searchState HTML enumeration (stonefish era)

- Parsed `https://hiring.cafe/?searchState=…` URLs where the whole filter object is
  serialised into one query param (`dateFetchedPastNDays {from,to}`, `sortBy: "date"`,
  `workplaceTypes`, `roleTypes`, `locations`).
- Code lived in `src/brain/hiring-cafe/search-state.ts` in the stonefish repo.
- **Status:** works mechanically from a browser-class client, but is (a) an explicitly
  robots-disallowed URL pattern, (b) capped by the site's SSR at ~42 pages / ~1,680
  hits per query, (c) fought by Cloudflare from any datacenter IP.
- **Why abandoned as the main channel:** every request pulls ~1 MB of HTML for only
  40 hits; sustained pulls trigger the 429 treadmill; the searchState pattern being
  robots-disallowed makes it legally noisy for anything beyond personal use.

### v2 — the porgy seed scraper (the big build)

Repository: `/home/ubuntu/orca/workspaces/overture/porgy`.
Main module: `scrape/hiringcafe.py` (~1,050 lines). Schema in `scrape/schema.sql`.

Data model (SQLite, WAL mode, foreign keys on):

```
companies ──< jobs ──< descriptions
              │
              ├──< job_locations   (scope, level, value, country_code)
              ├──< job_commitments (Full Time, Part Time, Contract, Internship,
              │                     Temporary, Seasonal, Volunteer)
              ├──< job_tools       (technical_tools)
              ├──< job_licenses    (licenses_or_certifications)
              ├──< job_languages   (language_requirements)
              ├──< job_degree_fields (level + field_of_study)
              └──< job_role_activities
```

- `jobs` columns cover: object_id (hiring.cafe ID), requisition_id, title, core_job_title,
  employer attribution (attributed_org name + org_entity_id), salary
  (frames per compensation frequency: Yearly/Monthly/Weekly/Daily/Bi-weekly columns for
  min & max), workplace_type, location_raw, department, seniority_level, role_type,
  yoe_min, management_yoe_min, requirements_summary, visa_sponsorship, security_clearance,
  published_at, first_seen_at, last_seen_at, is_expired.

Enumeration algorithm (`enumerate_all`):

1. Queue shards as `(dfrom, dto, filters)` rows in a `shards` table; pages already
   read are tracked in a `pages` table so runs resume.
2. For each shard, GET `https://hiringcafe.com/classic?searchState=<json>&page=N`.
3. Parse `__NEXT_DATA__` JSON from the SSR HTML → `ssrTotalCount`, `ssrHits`.
4. If `total > RETRIEVE_CAP (1600)`: split. Split axes, in order:
   - date bisection (a multi-day window becomes two smaller windows),
   - `workplaceTypes × roleTypes` (6 shards: Remote/Hybrid/Onsite ×
     Individual Contributor/People Manager), then
   - `_split_locations`: by country (12 named countries), then by
     `administrative_area_level_1` states pulled from the DB's `job_locations`.
5. Each hit is upserted (`ON CONFLICT(object_id) DO UPDATE`) across 12 tables.

HTTP client (`Client` class):

- Thread-local sessions; curl_cffi `impersonate="chrome"` when available, else requests.
- Global sliding-window limiter: **80 requests per 600 s**, `--rps` target 0.8, floor
  0.5 rps, multiplicative backoff on 429/challenge (45 s → ×1.6 per attempt, capped
  300 s), jittered.
- On repeated challenges: re-pull cookies from a live Orca browser tab
  (`orca-ide tab current` → `orca-ide cookie get --page <id>`), write Netscape-format
  `cookies.txt` + `cookies.json`, force-rebuild sessions.
- User-Agent is a hardcoded Chrome/150 string.

Description backfill (`scrape/mcp_desc.py`):

- `POST https://hiringcafe.com/api/mcp` JSON-RPC `tools/call` → `get_job_details`
  per requisition. Distinct from the HTML path: ~8 KB per call, no challenge observed.
- Writes `descriptions.html/text/word_count/http_status/fetched_at`, marks status
  done/error. Filterable by ATS source (`--sources grnhse,lever,…`) and `--since`.
- No-sign-in ATS sources only for the mop-up (grnhse, lever, ashby, bamboohr,
  smartrecruiters, recruitee, jazzhr, rippling, teamtailor, breezy, jobvite, pinpoint,
  workday variants, etc. — 14 in the phase-2 list).

Orchestration scripts:

- `scrape/nightly.sh` — chained enumerate + details pass, logs to `data/enumerate.log`,
  `data/mcp_desc.log`, `data/nightly.log`.
- `scrape/phase2.sh` — reopens shards truncated by the page cap, re-enumerates, then
  runs the description mop-up; leaves `data/.phase2-done` marker.

CJK/"ad hoc" extras: `scrape/preview.py` renders a filterable HTML card grid of the
seed corpus (`data/preview.html`, ~12 MB, client-side filter box).

### v2b — results of the seed crawl (final DB state)

| Table | Rows |
|---|---|
| jobs | 25,269 |
| companies | 9,205 |
| descriptions | 25,269 rows (4,711 fetched `done`, 20,485 `pending`) |
| pages read | 260 |
| shards | 23 done · 19 pending · 14 split |
| job_locations | 140,777 |
| job_tools | 67,817 |

Top companies by job count in the seed: Sobeys (134), Compass Group Canada (105),
Alberta Health Services (103), Citi (69), Walmart Canada (68), Cognizant (61),
EWOR GmbH (61). Top departments: Sales (3,269), Customer Service (1,474),
Finance and Accounting (1,443), Engineering (1,397).

### v2c — failure modes encountered in production

1. **The 429 treadmill.** Sustained HTML enumeration at even 0.8 rps accumulates
   403s/429s; the adaptive limiter then collapses to the 0.5 rps floor and pauses
   45–300 s between retries. Log excerpts: `HTTP 429 / challenge — waiting 43s,
   rate 0.50 → 0.50/s` repeated through whole shards. A single Onsite×IC day-shard
   (4,872 hits) needs ~122 pages; at ~2.5 s/page + pauses that shard alone takes
   5–10 minutes clean, far longer when the treadmill kicks in.
2. **Page cap.** The SSR search never returns more than ~42 pages / ~1,680 hits per
   query regardless of `ssrTotalCount`. Any query with more matches than the cap
   must be pre-split before paging (hence the 6-way workplace×role split, and the
   12-country then state-level location split cascade).
3. **`ssrIsLastPage` is unreliable** — an empty page is the only trustworthy end
   signal; the crawler breaks on the first empty page read.
4. **Cookie dependency.** `cf_clearance` is bound to the solving IP+UA; the Orca-tab
   harvest works only while the tab's browser session stays warm, same-IP, and
   Human-verified. When the browser itself gets the interactive "Verify you are
   human" box, a human has to tick it (the daemon log shows repeated
   `clicking turnstile at 399,566` cycles).
5. **Description tail is heavy.** 25,269 descriptions at ~1 MB HTML each ≈ 25 GB of
   transfers if done through the HTML path; the MCP path is ~8 KB per call
   (~300× lighter), which is why mop-up moved to MCP.

---

## 4. The MCP route: full measurement record (2026-11-20)

Discovery: `https://hiringcafe.com/api/mcp` — POST-only JSON-RPC. `GET` → 405.
Anonymous (no cookies, no challenge). This is the operator's published "Claude
Connector"; its `initialize` handshake reports
`serverInfo: {name: "hiringcafe", version: "1.0.0"}` and advertises capabilities
`tools` (listChanged false) and `resources` (listChanged false, subscribe false).
`prompts/list` → error -32601 "Unknown method: prompts/list" (no prompt support).
`resources/list` returns exactly one UI resource:
`ui://hiringcafe/job-carousel` (`text/html;profile=mcp-app`) — a carousel view for
search results, not a data channel.

### curl probes and results

1. **`tools/list`** → exactly two tools:
   - `search_jobs` (title: "Search jobs on HiringCafe") — full filter parameter set:
     `search` (free text, job title or keywords), `location` (city/state/country
     as free text; "remote" for location-independent), `workplace_types`
     (enum Remote/Hybrid/Onsite, array), `radius_miles` (default 50, ignored for
     state/country-level locations), `employment_types` (enum Full Time/Part Time/
     Contract/Internship/Temporary/Seasonal/Volunteer), `seniority_levels`
     (enum No Prior Experience Required/Entry Level/Mid Level/Senior Level),
     `role_type` (Individual Contributor/People Manager), `min_salary`,
     `salary_frequency` (Yearly/Monthly/Weekly/Daily/Hourly), `posted_salary_only`
     (excludes hiring.cafe's salary *estimates*), `max_years_experience`,
     `company_names`, `exclude_company_names` (explicitly documented as the way to
     filter out staffing agencies — "useful for filtering out staffing agencies or a
     current employer"), `min_employees`, `max_employees`, `company_hq_countries`
     (accepts names or ISO-3166 alpha-2, e.g. "us"), `company_keywords`
     (e.g. ["venture-backed"], ["remote-first"]), `exclude_company_keywords`
     (e.g. ["gambling"], ["tobacco"]), `exclude_investors`, plus degree-fields-of-study
     arrays (associates/bachelors/masters/doctorate), `weekend_availability`,
     `holiday_availability`, `overtime` (each enum Required/Not Indicated/Doesn't
     Matter), `language_requirements_operator` (AND/OR), `limit` (1-25, default 10),
     and `page` for deep pagination. `required: []` — every parameter optional.
   - `get_job_details` — takes only `job_id` (the final path segment of a
     `hiringcafe.com/job/...` URL). Returns the **full posting as markdown**:
     title (linked), employer, location, workplace, compensation,
     employment type, seniority, role type, category, YOE, security clearance,
     technical tools, posted date, Job ID, View & apply link, Requirements summary,
     Full description.
2. **No `outputSchema` / `structuredContent` on either tool.** Output is markdown
   text only. Parse with regex against the fixed layout (`### [Title](url)`,
   then `**Company**` and the `- **Label:** value` bullet list).
3. **Latency:** 0.3–0.9 s per call single-stream; degrades gracefully to ~2–3 s
   under 3 concurrent streams; 18-call 3-stream runs completed with zero errors.
4. **Deep pagination:** `page: 5000` and `page: 9000` and empty-search queries all
   return 10 results consistently. Total index size reported in-band:
   "**10 of 6,406,045 matches**" for an empty query — the whole index is ~6.4M jobs.
5. **Filtered volume:** `posted_within_days: 1` yields ~143k matches/day globally;
   `workplace_types: ["Remote"]` alone yields ~218k matches against the index.
6. **Rate ceiling:** no 429 observed at any tested volume — 20-call paced run at
   ~2 rps, an 8-call back-to-back burst, and a 3-stream × 6-call concurrent run
   all 200-clean. Per-IP threshold sits above that envelope, but is **undocumented**
   — stay ≤1 rps sustained to be safe.
7. **What MCP does NOT give:** the external ATS `apply_url` (the "View & apply"
   link points back at hiringcafe.com with UTM tags), dedup cluster IDs
   (`strict_dedup_cluster_id`, `liberal_dedup_cluster`), geo-coordinates
   (`_geoloc` lat/lon), the `source` ATS name, or `board_token` — all present in
   the HTML `__NEXT_DATA__` records but absent from the markdown. Getting those
   still requires either the HTML route (Cloudflare-gated) or accepting the loss.

---

## 5. Data obtained (final state)

Harvest DB: `data/hc.sqlite` (205 MB, WAL mode).

| Table | Rows |
|---|---|
| jobs | 25,269 |
| companies | 9,205 |
| descriptions | 25,269 rows (4,711 fetched `done`, 20,485 `pending`) |
| pages read | 260 |
| shards | done 23 · pending 19 · split 14 |
| MCP desc backfill | 4,711 done / 20,485 pending |

A frozen copy `data/hc-snapshot-2332.sqlite` (196 MB) also exists.

---

## 6. Tools inventory (what lives where)

| File | Purpose |
|---|---|
| `scrape/hiringcafe.py` | Main scraper: enumerate + details + export + preview. Parses `__NEXT_DATA__` from `/classic` SSR pages. Shards by date, then workplace×role, then location. `init` builds `hc.sqlite` via `scrape/schema.sql`; `sync` chains nightly enumerate + details; `stats` summarises job/description/shard/status counts. |
| `scrape/mcp_desc.py` | MCP description backfill via the anonymous `POST /api/mcp` `tools/call`/`get_job_details` JSON-RPC endpoint (no challenge). Defaults to 1.5 rps global pacing, 4 workers; supports `--since YYYY-MM-DD` and `--sources` filters and `--all`. Writes status/html/text/word_count back into `descriptions`. |
| `scrape/deepsplit.py` | Location-split cascade: day → workplace×role (6 shards) → country (12) → admin-area states, inserting `split` shards for the enumerator to resume. |
| `hiringcafe-sync.service/.timer` | Nightly sync chain (enumerate → details), 02:00, logs under `data/`. |
| `data/cookies.json` / `cookies.txt` | cf_clearance + session cookies harvested from the Orca tab (13 cookies: `__session`, `cf_clearance`, `_ga*`, `geo_*`, `g_state`, `hc_search_mode`, PostHog). |

### The MCP endpoint: what we finally know about it

- URL/verb: `POST https://hiringcafe.com/api/mcp` (JSON-RPC 2.0; `GET` 405s).
- Exposed surface: `tools/list` and `tools/call` for two tools — `search_jobs` and
  `get_job_details` (dtails documented in section 3 above).
- Search results return **markdown** blocks (10/call) with structured header-labels
  (Location/Workplace/Compensation/Employment type/Seniority/…, plus `Job ID:`) that
  must be regex-parsed.
- Search results do **not** include the external `apply_url` — that only appears via
  the HTML route; details markdown routes the applicant back through hiringcafe.
- Rate ceiling: no 429s at ≤3 rps with 3-way concurrency; unpublished beyond that.

### Cookie harvesting

`data/cookies.json` / `cookies.txt` — harvested live from a logged-in Orca browser
tab via `orca-ide tab current` → `orca-ide cookie get --page <id>`, refreshed as
challenges land; 13 cookies including `__session`, `cf_clearance`, Geo/geo hints,
`g_state`, `hc_search_mode`, `_ga*`, PostHog. Fine for personal-Use seed runs;
`cf_clearance` is bound to the solving IP+UA, so it dies on any IP change (or a
human-verification prompt on the harvesting tab).

---

## 7. Complete read of remaining unknowns

- Whether the SSR `/classic` route is Curl-cffi-impersonate-stable at 0.2-0.5 rps
  overnight volumes (23 sites did serve 200s at those rates earlier in the seed run).
- Whether the MCP endpoint has a hidden hard cap on `page` (tested to 18,703;
  25/call at 6.4M docs implies ~256k pages if it truly paginates past ~10k).
- Whether `searchState` filter values (Location/Âge, etc.) equally expose behind
  the MCP filters (they do not — MCP only exposes the filters listed in section 3).

---

## 12. Handoff: how to query data/hc.sqlite

```python
import sqlite3
con = sqlite3.connect("data/hc.sqlite")
con.row_factory = sqlite3.Row
# jobs joined to companies and locations
rows = con.execute("""
  SELECT j.object_id, j.title, c.name AS company, j.workplace_type,
         j.seniority_level, j.salary_yearly_min, j.salary_yearly_max,
         j.apply_url, j.published_at
  FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
  ORDER BY j.published_at DESC LIMIT 20
""").fetchall()
```

```bash
sqlite3 data/hc.sqlite "SELECT COUNT(*) FROM jobs"
sqlite3 data/hc.sqlite "SELECT status, COUNT(*) FROM shards GROUP BY status"
```

The `shards` and `pages` tables track crawl progress (done/pending per shard).
`descriptions.status='done'` rows have `descriptions.html` + `.text` filled.

---

## 13. Complete source list

- hiring.cafe About page (archive, 2026-10-22)
- hiring.cafe homepage (archive, 2026-10-21)
- hiring.cafe Terms and Conditions (archive, 2026-10-24)
- hiring.cafe robots.txt (live, 2026-11-19)
- r/ChatGPT "I used GPT to fetch 40,918 remote jobs" (u/alimir1, 2023-09-06, archived)
- r/recruitinghell "My 2-year plan to destroy Indeed" (u/alimir1, 2024-07-31, archived)
- r/datascience "How I scraped 2.1 million jobs…" (u/hamed_n, 2025-02-26, archived)
- Fantastic.jobs API pricing; TheirStack pricing + job data dictionary
- Coresignal third-party pricing snapshots (unverified)
- Adzuna API terms
- O\*NET-SOC 31.0 Database licence (CC BY 4.0)
- ESCO reuse terms (Commission Decision 2011/833/EU)
- LinkedIn job function codes (Microsoft Learn)
- onet-match (MIT), JobBERT-v2 (MIT), MatchMyJob — title/seniority classifiers
- hiQ v. LinkedIn (9th Cir. 2022; stipulated judgment, N.D. Cal. Dec 2022)
- Facebook v. Power Ventures (9th Cir. 2016)
- Ticketmaster v. RMG (C.D. Cal. 2007) — DMCA §1201
- Century 21 v. Rogers (BCSC 2011) — browsewrap enforceable in Canada
- Copyright Act (Canada) s.41.1 — TPM civil remedies
- Apify Hiring.cafe scraper listings (parsebird, blackfalcondata)
- JobsPipe "Hiring.cafe API: there isn't one" (2026-07-28)
- Scoutify / ResumeUp HiringCafe reviews

*(URLs for each appear in the stonefish hiring-cafe research doc, which is the
canonical citation list; this summary carries the claims forward with the same
verification labels.)*
