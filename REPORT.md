# Reverse-engineering existing hiring.cafe scrapers

Research date 2026-11-20. Sources are the 9 named repos plus leads found via `gh search code` and repo docs. Local clones: `/tmp/opencode/hc-repos/*`. **No bulk-hydrate endpoint exists in any code found**; the wins are (a) descriptions already inside SSR search hits, (b) a public 178k-row dataset, (c) a lighter Next.js data route. One polite live GET from devbox to `/classic?...` returned 403 Cloudflare, as expected (ADR 0003); all current-behaviour claims below are from source/docs dated 2026-08..11, marked where historical.

## Repo table

| Repo | Endpoint(s) / method | Auth | CF / 429 strategy | Descriptions? | >1 job/req, >page 250? | License | Last commit |
|---|---|---|---|---|---|---|---|
| [umur957/hiring-cafe-job-scraper](https://github.com/umur957/hiring-cafe-job-scraper) | `POST /api/search-jobs/get-total-count` `{searchState}`; `POST /api/search-jobs` `{size:1000,page,searchState}` (`job_scraper.py:18-20,148-154`) | none (browser-like headers) | none; now dead (405/404 per CLI roadmap) | no | 1000/page intended, 50-page cap | MIT | 2025-09-12 (34★) |
| [sylaskye/hiring-cafe-job-scraper](https://github.com/sylaskye/hiring-cafe-job-scraper) | `GET /?searchState=<json>` → `__NEXT_DATA__.props.pageProps.ssrHits` (`job_scraper.py:1-19,84-99`) | none | `Retry(total=4, backoff_factor=2, status_forcelist 429/5xx)`, 1.5 s between slices | no | one SSR page per slice; "deep" = 11 filter slices | none | 2026-09-03 (0★) |
| [a-palamarchuk/hiringcafe-toolkit](https://github.com/a-palamarchuk/hiringcafe-toolkit) | `GET /?searchState=<json>`; `GET /_next/data/<buildId>/<route>.json?searchState=<json>&page=N` + `x-nextjs-data: 1` (`api/client.py:1-20,240-310`) | none | detect `403 cf-mitigated: challenge` → `BlockedError`; **no bypass**, human browser capture extension instead; 1 s/page, 3×5 s retry on 5xx | no | `classic.json` pages; default `max_pages=500`, stop on empty/zero-new page | MIT | 2026-10-02 (0★) |
| [chongha96/Hiring-Cafe-ELT](https://github.com/chongha96/Hiring-Cafe-ELT) | `GET /?searchState=<json>` → `__NEXT_DATA__` (`crawler/src/utils/scraper.py:10-60`) | none | SeleniumBase `uc=True, xvfb=True`, `uc_gui_handle_captcha()`, 5 s sleep, 6 s reconnect | no (`v5_processed_job_data` only) | single SSR page; Parquet→GCS→dbt | none | 2026-10-04 (0★) |
| [jawaidaakif01/HiringCafe_JobFinder_MCP](https://github.com/jawaidaakif01/HiringCafe_JobFinder_MCP) | `POST https://hiringcafe.com/api/mcp`, JSON-RPC `tools/call`: `search_jobs`, `get_job_details({job_id})` (`job_search.py:5`, `job_details.py:4`) | none (public read-only MCP) | upstream IP rate limit; none client-side | yes, **one job per `get_job_details` call** (Markdown text) | `search_jobs` limit 1–25, **one job per company**, no pagination | none | 2026-10-17 (0★) |
| [AnshumanAtrey/hiringcafe-jobs-search](https://github.com/AnshumanAtrey/hiringcafe-jobs-search) | Hosted **Apify actor** `anshumanatrey/hiringcafe-jobs-search` via `POST https://api.apify.com/v2/acts/anshumanatrey~hiringcafe-jobs-search/run-sync-get-dataset-items`; source private (`README.md:232-262`) | Apify token; **no HiringCafe login/key** | `curl_cffi` browser TLS; Apify residential proxy from first call, fresh IP/session per challenge, retry; stop after 12 consecutive challenged IPs. Local: 2 s apart, 10 s after block | yes, `includeDetails` = **one extra call per job** | ~130 jobs / 40 employers per search page; reads each employer's other matches | MIT (docs only) | 2026-11-16 (0★) |
| [AnshumanAtrey/global-job-search-api](https://github.com/AnshumanAtrey/global-job-search-api) | Hosted Apify actor `anshumanatrey~global-job-search-api` (18 boards); same Apify REST + `https://mcp.apify.com?tools=anshumanatrey/global-job-search-api`; source private | Apify token / Apify MCP login | delegated to per-board actors | yes with full details, one extra call/job | HiringCafe slice capped at newest 10,000 employers (~33k jobs) | MIT (docs only) | 2026-11-16 (0★) |
| [lightenedself7-cell/hiringcafe-jobs-search](https://github.com/lightenedself7-cell/hiringcafe-jobs-search) | Copy/mirror of the same actor docs; points to `anshumanatrey/hiringcafe-jobs-search` store (`llms.txt:9-10`) | Apify token | same as AnshumanAtrey | yes, per-job extra call | same | MIT | 2026-11-11 (0★) |
| [zovo-one/cafe-tracker](https://github.com/zovo-one/cafe-tracker) | **Not a scraper**: Chrome extension; reads `__NEXT_DATA__` already in page (`content.js:491`), stores statuses locally | n/a (browser session) | n/a | no | n/a | MIT | 2026-11-05 (0★) |

### Follow-ups found via code search / references

| Repo | Key contribution | Auth / CF | Descriptions / bulk | License | Last commit |
|---|---|---|---|---|---|
| [chen-gdp/hiringcafe-cli](https://github.com/chen-gdp/hiringcafe-cli) | **Definitive current endpoint inventory** in `roadmap.md:120-165`; official MCP transport spec `specs/pr-9.1-official-mcp-read-transport/spec.md` | none for MCP; per-IP 429 + `Retry-After`; explicitly refuses CF-cookie/UA spoofing | `get_job_details` = 1 job/call | MIT | 2026-10-18 (0★) |
| [DevelopIQ-ai/jobs_db](https://github.com/DevelopIQ-ai/jobs_db) | **Public dataset** + SSR scraper `data_in_progress/jobs/hiring_cafe/scraper.ts`; Playwright fresh context per industry, 2.5 s delay, ~20% challenged first pass | none; headful xvfb, no CF bypass | `info.description` → `description_md` **in SSR hits** | none | 2026-10-01 (59★) |
| [La-Li-Lu-Le-Lo/hamedn-hiring-cafe](https://github.com/La-Li-Lu-Le-Lo/hamedn-hiring-cafe) | Frontend clone: exact legacy search call in `components/BrowseJobsV2/SearchHitsV5.js:158-186`; AI-search calls in `hooks/useAISearch*.js` | optional Firebase ID token | no bulk hydrate route in clone | GPL-3.0 | 2026-02-27 (1★) |
| [nipunsomani/job-forager](https://github.com/nipunsomani/job-forager) | Docs of old `POST /api/search-jobs` 1000/page (`docs/API_SOURCES.md:605-660`); code rewritten to Next.js data API | none | no | none | 2026-05-13 (2★) |
| [millsoft/job-scanner](https://github.com/millsoft/job-scanner) | `scraper/hydrate-jobs.js` is a **local script name**, Puppeteer one job page at a time (Indeed `#jobDescriptionText`) — irrelevant | none | 1 job/request | none | 2024-06-25 (0★) |

## Reusable findings (best first)

**1. Descriptions are already in the search SSR payload — no per-job request needed.**
`DevelopIQ-ai/jobs_db/data_in_progress/jobs/hiring_cafe/scraper.ts` `transformJob()` reads `job.job_information.description` from `ssrHits` and converts it to `description_md`. The public dataset row sampled below contains a full multi-paragraph description. So when fetching `/classic?searchState=...&page=N`, first check `hit.job_information.description`; only fall back to `/job/<id>` or `/api/job-description?id=<objectID>` if empty. **Caveat:** the sample row was scraped 2026-05-07; the 2026-11-20 live probe from devbox was 403'd, so confirm on one working crawler request before deleting the fallback. Other useful hit fields: `objectID`, `collapse_key`, `source_and_board_token`, `is_expired`, `apply_url`, `v5_processed_job_data` (~90 tags), `enriched_company_data`.

**2. One SSR page can exceed 40 jobs.** `chen-gdp/hiringcafe-cli/roadmap.md:147-152`: `ssrPageSize` 40, but grouped employer cards unpacked 40 groups → **124 unique `objectID`s** in one probe. Count with `ssrTotalCount`, not `len(ssrHits)`. Dedupe by `objectID`/`collapse_key`.

**3. Use the Next.js data route for pages 1..N (smaller than full HTML).** From `a-palamarchuk/hiringcafe-toolkit/src/hiringcafe_toolkit/api/client.py`:
```bash
# page 0: GET /classic?searchState=<compact JSON>  -> __NEXT_DATA__ has buildId, page="classic", pageProps.ssrHits
# pages 1..N (buildId/route discovered at runtime, changes on each deploy):
curl -sS -H 'x-nextjs-data: 1' \
  'https://hiringcafe.com/_next/data/<buildId>/classic.json?searchState=<urlencoded-json>&page=1'
```
Treat 404, `pageProps.__N_REDIRECT`, or non-JSON as a stale build → re-read build id and retry (max ~3). The route moved `/` → `/classic` around 2026-09-30 (`index.json` now returns redirect-only payloads). Pacing used by that repo: sequential, 1 s between pages, retries 3× with 5 s×n backoff on 5xx, default cap 500 pages, stop after empty page or two consecutive zero-new pages. Past ~10k results: split the search into narrower `searchState`s (industry/location/date) instead of pushing `page` higher — `jobs_db` slices across 1,453 industries.

**4. Download a dataset instead of crawling (answers Q4).** Public Supabase REST table `ds_hiring_cafe`, ~178k US jobs, includes `title`, `apply_url`, `source`, `collapse_key`, `scraped_at`, salary fields and full `description_md`:
```bash
curl -sS 'https://<project>.supabase.co/rest/v1/ds_hiring_cafe?select=*&limit=100' \
  -H 'apikey: <publishable key from the dataset README>'
# PostgREST filters, e.g. ?title=ilike.*engineer*&salary_min_yearly=gte.100000
# anon key is a PUBLISHABLE, RLS read-only key (GET 200 / POST 401) from the public README
```
Documented at `DevelopIQ-ai/jobs_db/README.md:43-70` and `.agents/skills/jobs-data-refresh/SKILL.md`. Sample row's newest `scraped_at` should be checked before use; exact `count(*)` times out on their project, and it sits on an over-quota grace period. No other large public dump was found; Apify datasets are per-run only.

**5. Official read-only MCP — sanctioned but slow (answers Q3 partly).** `POST https://hiringcafe.com/api/mcp`, JSON-RPC 2.0, no sign-in:
```bash
curl -sS -X POST https://hiringcafe.com/api/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_job_details","arguments":{"job_id":"<objectID>"}}}'
```
`search_jobs` takes `search`, `location`, `workplace_types`, `radius_miles`, `employment_types`, `limit` 1–25 (default 10), returns one job per company, Markdown text, no pagination; `get_job_details` returns a `Full description` section. IP rate-limited (429 + optional `Retry-After`), links carry Claude attribution params. Docs: `https://hiringcafe.com/documentation/hiringcafe-claude-connector`. A ChatGPT variant exists at `POST /api/chatgpt/mcp` (`search_hiringcafe_jobs`, `get_hiringcafe_job_details`). Not a bulk route; also a ToS/competitor concern (see `docs/research/hiring-cafe.md` §Q3–Q4).

## Direct answers

**Q1. Bulk description endpoint?** **None found.** `/api/ai-search/hydrate-jobs`, `/api/get-job-details`, Firestore/Meilisearch/Algolia bulk queries: not present in any repo or code search (GitHub search rate-limited near the end; mark unknown, but unlikely). `hydrate-jobs` only appeared as `millsoft/job-scanner/scraper/hydrate-jobs.js` (local Puppeteer script, unrelated site). One-job endpoints: `GET /api/job-description?id=<objectID>` (anonymous, historical `{"job":{"job_information":{"description":"..."}}}`, `cache-control: public` + ETag but no max-age; 403 challenge since 2026-10-11) and MCP `get_job_details`. `/api/ai-search/search` is a **private, user-auth'd** POST `{conversation_id,page,size}` (28/page) tied to an AI chat — not a bulk feed. **The practical bulk route is the `description` field already inside each `ssrHits` record** (finding 1).

**Q2. Proxy pools / hosted APIs?** No reusable proxy pool in any repo. AnshumanAtrey's actors use **Apify Residential** (paid, included in their price, fresh IP per challenge); no credentials or proxy list are published. `jobs_db` has a `BRIGHTDATA_API_KEY` env slot but its active scraper uses fresh Playwright contexts, not Bright Data. `chongha96` uses SeleniumBase UC + xvfb + `uc_gui_handle_captcha()`; `a-palamarchuk` refuses to bypass and falls back to a human-driven browser capture. All are subscription/private infra, not something to reuse cheaply.

**Q3. Hosted `global-job-search-api`?** Yes, but **only as an Apify actor**, not a standalone public REST API and no data dump. `POST https://api.apify.com/v2/acts/anshumanatrey~global-job-search-api/run-sync-get-dataset-items` with `Authorization: Bearer <APIFY_TOKEN>` and body `{"searchTerms":["data analyst"],"location":["London"],"platforms":["hiringcafe","greenhouse","ashby"]}`; also MCP `https://mcp.apify.com?tools=anshumanatrey/global-job-search-api`. Pricing: $0.004/job, $0.005/job with details, $0.01 per board searched; run cap 300 s. Schema: flat rows with `platform`, `title`, `company`, `location`, `applyUrl`, `ats`, `jobId`, `postedAt`, salary, seniority, skills; full details add `description`, `descriptionHtml`. HiringCafe-only actor: $0.000062/job, $0.00026 with details. Source is private (repos are docs + examples). Unknowns: hosted uptime/SLA, hard rate limits, whether descriptions are truly bulk-fetched (README says "one more call a job").

**Q4. Public dataset/dump?** Yes — `ds_hiring_cafe` Supabase table (finding 4). No other downloadable dump found.

## Endpoint status cheat-sheet (from `chen-gdp/hiringcafe-cli/roadmap.md:120-165`, verified 2026-10-11)

| Route | Status |
|---|---|
| `GET /?searchState=<json>&page=N` (now `/classic`) | worked 2026-08-17; 403 CF challenge 2026-10-11; ~1 MB, `no-store` |
| `GET /_next/data/<buildId>/classic.json?...&page=N` | working pattern per `a-palamarchuk`, build id rotates |
| `GET /api/job-description?id=<objectID>` | 1 job, historically anonymous; 403 challenge now |
| `POST /api/mcp` / `POST /api/chatgpt/mcp` | official, live, anonymous, rate-limited; 1 job/company, no pagination |
| `GET /api/jobs`, `GET /api/getMarketplaceJobsCount` | reachable, `{"jobs":[]}` / `{"count":0}`, unknown semantics |
| `GET /api/search-facets` | 400 without exact `facetType` (unknown) |
| `GET /api/search-jobs?s=<b64>&size=40&page=N` | legacy frontend call; now 401 Unauthorized |
| `POST /api/search-jobs`, `/api/search-jobs/get-total-count`, `/ssr/search-jobs` | 405 / 404 / 404 — dead |

**Bottom line:** stop issuing one request per description — read `job_information.description` from the cards you already fetch; if that field is missing on today's site, the next best options are the public Supabase dump or paying per job on Apify. Nothing found beats ~40–124 jobs/request on a self-hosted crawl, and nothing reliably defeats Cloudflare from a datacenter IP.
