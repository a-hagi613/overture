# Paid / hosted options for hiring.cafe descriptions

Research date: 2026-11-19. Scope: getting job **descriptions** out of hiring.cafe at scale without
fighting Cloudflare. Prices are list prices on the vendor's own page; USD. "Unknown" means I could
not verify it and did not guess.

## TL;DR

1. The actor named in the task (`manojachari/hiring-cafe-scraper`) is **not** the cheapest and is
   **not** actually billed per result — it is pay-per-usage. Its README price table is not live.
2. **Cheapest credible path for a 10k-description backfill: an Apify hiring.cafe actor at
   $1.15–$1.25 / 1k results with descriptions included** (~$12–15 total). Several exist; two have
   real track records.
3. **Ongoing 2k/day: same actor in incremental mode** (~$70/mo), or — cheaper — keep our crawler for
   listing pages (robots-legal for `/job/`, 50 listing pages/day is under the throttle) and buy only
   the 2k daily detail pages.
4. **Biggest non-price finding: our current crawler uses a robots-disallowed URL shape**
   (`?searchState=` and `?page=`). See [Legality](#legality--tos-evidence-not-advice).
5. Bright Data's hiring.cafe page is a *build-your-own* AI scraper studio, not a fixed dataset, and
   its published field list **does not include the description**.

## Comparison

| Provider | Mechanism | Descriptions? | Price / 1k jobs | Free tier | CF handling | Notes |
|---|---|---|---|---|---|---|
| Apify `manojachari/hiring-cafe-scraper` **(task's actor)** | Internal hiring.cafe API, driven by Camoufox anti-detect browser | Claimed (HTML-stripped) | **Pay-per-usage, not per result** — live `currentPricingInfo` is `null`. 4 GB RAM run: $0.20/CU + residential proxy $8/GB | Apify free plan: $5/mo credit, **no residential proxy** | Claimed (Turnstile via stealth browser), ~10–20 s startup | 58 users, 3/mo, single 1★ review. No public source on GitHub (checked). README's "$0.003/result" table contradicts the live pricing model |
| Apify `blackfalcondata/hiringcafe-scraper` | Listing + detail-page enrichment | **Yes**, full cleaned description, `descriptionMaxLength`, `includeDetails` | **$1.15 / 1k** (single per-result event; detail reads included) | Apify $5/mo credit; residential needs paid plan | Built-in; residential proxy recommended | 152 monthly users, 99.9% success, 5★. Incremental mode with `stateKey` emits NEW/UPDATED/REAPPEARED only, "saves 80–95% on daily monitoring". Does not bill a job whose description it failed to fetch |
| Apify `memo23/apify-hiring-cafe-scraper` | Listing + detail page per job (`enrichDescription`) | **Yes**, full HTML in `job_information.description` | **$1.25 / 1k** | Apify $5/mo credit | Built-in; own proxy config | **Category leader**: 882 users, 201/mo, 99.8% success, 5★. `incrementalMode` with NEW/UPDATED/UNCHANGED; re-checks descriptions ~weekly |
| Apify `abotapi/hiring-cafe-scraper` | Listing + optional detail read | Yes (`description` HTML + `description_text`) | **$2.30 / 1k** on FREE tier ($1.70 result + $0.60 detail) → $1.30 on Gold | Apify $5/mo credit | Residential required (says ~200 KB/job) | 100+ fields, nested raw payload, `resumeFromRunId`, incremental. Only 29 users, 3★ |
| Apify `fetch_cat/hiring-cafe-jobs-scraper` | Listing + "supported routes" enrichment | Partial — "availability varies by posting" | **$0.17–$0.20 / 1k** (cheapest) | Apify $5/mo credit | Automatic connection mode | **Disqualified for backfill**: `maxItems` capped at 1000/run and `runBudgetSeconds` 60–270 s. 10k needs ≥10 runs and descriptions are best-effort |
| Bright Data `products/web-scraper/hiringcafe` | AI Scraper Studio (prompt → scraper you own), Bright Data unblocking + browsers | **Not in the published schema** — can probably be prompted for, unknown | **$1.5 / 1k page loads** (Scale $1.3 over 383k) | **5,000 page loads/mo** (~$7.50), no card | Yes, managed unblocking/CAPTCHA | Published fields: title, company, location, remote, salary range, seniority, employment type, industry, skills, posted date. Triggerable by API + schedules; JSON/CSV/Parquet/S3/BigQuery delivery. **Must build and verify the scraper first** |
| Zyte API | Smart proxy/unblocker, returns raw body or browser-rendered | N/A — we parse `__NEXT_DATA__` ourselves | HTTP body $0.13–$1.27 / 1k; **browser-rendered $1.01–$16.08 / 1k** by site tier (**tier unknown for hiring.cafe**) | $5 credit, 30 days | Automatic, incl. CAPTCHA + session persistence | Best "keep our parser" option *if* hiring.cafe lands in a low tier. Measure it with the free credit before committing |
| ScrapingBee | Proxy + headless browser, returns HTML | N/A (we parse) | 25 credits/req (JS + premium proxy) → **$4.90 / 1k** ($49 = 250k credits) | 1,000 credits = **40 requests** at 25 credits | Passes many CF challenges; **Turnstile not guaranteed** | Returns raw HTML, so our existing parser works unchanged |
| ScraperAPI | Proxy + JS rendering + anti-bot | N/A (we parse) | 1 + 10 CF credits = 11/req → **~$5.4 / 1k** ($49 Hobby = 100k credits) | 1,000 credits (~90 requests), 7-day trial | "Cloudflare/Datadome/PerimeterX add 10 credits" — so it expects to handle it | Same parser benefit; `max_cost` per request cap |
| Browserbase | Managed stealth Chrome via CDP; our Playwright code unchanged | N/A (we parse) | $20/mo: 100 browser hrs (10k × ~4 s ≈ 11 hrs) + 1 GB proxy, then **$12/GB** → **~$20–32 / 10k** | 1 browser hour, 1,000 Fetch calls | Captcha solving on paid plans; "strategic partnerships" incl. Cloudflare | Cheapest way to reuse our *existing* browser crawler at volume — only the `connectOverCDP` target changes |
| Steel.dev | Hosted browsers; `/scrape` endpoint or browser hours | N/A (we parse) | `/scrape` **$5 / 1k**; or $0.10/browser-hr + proxy $10/GB + $3/1k captchas | **$30 one-time credit** | Captcha solves built in | ~$21–50 / 10k depending on route |
| Firecrawl | Scrape/crawl → markdown or HTML | N/A (we parse) | 1 credit/page; $99 Standard = 100k pages | 1,000 credits/mo | Some CF support; **Turnstile on hiring.cafe unverified** | Cheap per page but wrong shape for a known Next.js site; likely the weakest CF story of the open-web APIs |
| Oxylabs / PhantomBuster / Octoparse / Browse AI / Databar / Teracrawl | Not evaluated | — | — | — | — | Excluded on fit, not on price: enterprise-quote or desktop/no-code, and none returns raw page HTML for a `__NEXT_DATA__` parser. Do not spend time here without a specific reason |

Cost basis for 10k: Apify residential proxy is **$8/GB** and detail pages are ~200 KB–1 MB each, so
1–10 GB (~$8–80) *if* the actor bills proxy separately. Actors that advertise a flat per-result price
(the four above) appear to bundle it; **verify on the first run's `usageTotalUsd`**.

## Legality / ToS (evidence, not advice)

- `https://hiring.cafe/robots.txt` (fetched 2026-11-19) allows `/job/`, `/jobs`, `/careers`,
  `/recently-posted-jobs`, `/insights`; **disallows `/*?searchState=*`, `/*?page=*`, `/*&page=*`,
  `/viewjob/`, `/req/`, `/board/`, `/applyclick`, `/api/applyclick/`, `/org/`, `/company/`, `/b/`.**
  Our current crawler hits exactly `/classic?searchState=…&page=N` — the disallowed shape. The
  per-job `/job/<id>` pages we fetch for descriptions are allowed.
- The file also declares `Sitemap: …/job-posting-sitemap.xml`, `…/priority-jobs-sitemap.xml`,
  `…/vip-jobs-sitemap.xml` and says outright *"Apply links. Nothing for a crawler here."*
- `robots.txt` is a crawling preference, not a contract, and is not the same as the Terms.
  **`/terms-and-conditions` and `/terms` both return HTTP 403 behind Cloudflare**, so I could not
  read whether automated access or personal read-only use is prohibited. **Unknown — treat as
  unresolved** and read it in a browser before scaling anything up.
- Note the direction of travel: the operators clearly do not want bulk search-page crawling. Buying
  data through a third party does not change what the source permits; it moves the decision to you.

## Recommendation

### (a) One-off backfill of ~10,000 descriptions — fastest, cheapest, least work

**Use `blackfalcondata/hiringcafe-scraper` ($1.15/1k, details included), fall back to
`memo23/apify-hiring-cafe-scraper` ($1.25/1k) if anything is off.** Both have real volume and ~100%
success; both return the full description without you writing a scraper. Budget **~$12–15** for the
10k, cap it with `maxTotalChargeUsd`, and check `usageTotalUsd` afterwards for proxy surprises.

Do **not** use `manojachari` for this: it bills 4 GB of browser compute + residential bandwidth per
job, so 10k stealth-browser page loads plausibly costs **$30–100** — more than the per-result actors,
with a 1★ reputation. `fetch_cat` is 6× cheaper per result but its 1,000-item / 270-second caps turn
10k into a babysat batch job with best-effort descriptions.

Reasoning: every option that lets us keep our own parser costs the same or more (Browserbase ~$20–32,
ScrapingBee/ScraperAPI ~$49–55, Zyte unknown-but-likely-$40+) *and* leaves us maintaining the CF
retry logic. Paying ~$1.15/1k for someone else's residential pool + parser is the better trade for a
one-off.

### (b) Ongoing 2k new jobs/day — hybrid, our listing crawler + bought descriptions

- Listings: **2,000 jobs/day = 50 listing pages/day at 40/page**. That is well under the "moving
  fast" threshold, and can be made robots-clean by discovering URLs from the declared
  `job-posting-sitemap.xml` (or the allowed `/jobs` pages) instead of `?searchState=&page=`.
- Descriptions: the only genuinely rate-limited part. Buy just those: **2k × $1.15/1k ≈ $2.30/day,
  ~$70/month**, via the same actor in incremental mode with a stable `stateKey` so a re-run never
  re-bills unchanged jobs.
- Do not run a full re-scrape monthly to rebuild state: `blackfalcondata` charges full price on the
  baseline run, and `memo23` re-checks descriptions weekly.
- If the 50 daily listing pages are fine and only the 2k detail pages hurt, this hybrid is already
  ~30% cheaper than any all-in-one per-page provider and keeps our record shape.

## Concrete next steps

1. Create an Apify account (free), set a hard cap, and do a 50-job smoke test before anything else:
   ```bash
   export APIFY_TOKEN=...            # never commit
   curl -sS -X POST \
     "https://api.apify.com/v2/acts/blackfalcondata~hiringcafe-scraper/runs?token=$APIFY_TOKEN&maxTotalChargeUsd=1" \
     -H 'Content-Type: application/json' \
     -d '{"startUrls":["https://hiring.cafe/?searchState=%7B%22sortBy%22%3A%22date%22%7D"],
          "maxResults":50,"includeDetails":true}'
   # then: GET /v2/datasets/{defaultDatasetId}/items  and  GET /v2/actor-runs/{id} -> usageTotalUsd
   ```
2. Assert on the smoke test: `description` non-empty for ≥95% of rows, HTML present, and
   `usageTotalUsd` close to $0.058 (50 × $0.00115). That single number settles the proxy question.
3. If it holds: rerun with `maxResults: 10000` and a `maxTotalChargeUsd` cap of ~$20. Persist the
   dataset to `/tmp` and load it into the seed store; do not re-run.
4. For daily sync, add `incrementalMode: true` + a fixed `stateKey` and an Apify Schedule (or call
   the run endpoint from cron) at ~2k results/day, `includeDetails: true`.
5. Separately, fix the crawler's URL shape: switch discovery to `job-posting-sitemap.xml` and keep
   `/job/<id>` for descriptions, so the only Cloudflare exposure left is the daily tail.
6. Before any of this at scale, read `hiring.cafe/terms-and-conditions` in a real browser (403 to
   bots) — the one question this research could not answer.

## Verified / unverified

Verified: actors, their live event prices (Store API `currentPricingInfo`), schemas, run stats,
robots.txt, and the vendor pricing pages cited above.

Unverified: hiring.cafe ToS text (403); whether the flat per-result actors bill residential proxy on
top (first run's `usageTotalUsd` answers it); Zyte's site tier for hiring.cafe; Bright Data's ability
to return the description field; Firecrawl's Turnstile handling on this site.

## Sources

- https://apify.com/manojachari/hiring-cafe-scraper (.md, and `api.apify.com/v2/actors/manojachari~hiring-cafe-scraper`)
- https://apify.com/blackfalcondata/hiringcafe-scraper · https://apify.com/memo23/apify-hiring-cafe-scraper
- https://apify.com/abotapi/hiring-cafe-scraper · https://apify.com/fetch_cat/hiring-cafe-jobs-scraper
- https://api.apify.com/v2/store?search=hiring%20cafe (19 actors, live pricing)
- https://apify.com/pricing/proxy (residential $8/GB; free plan $5/mo, no residential)
- https://brightdata.com/products/web-scraper/hiringcafe
- https://www.zyte.com/pricing/ · https://www.scrapingbee.com/pricing/ · https://www.scraperapi.com/pricing/
- https://www.browserbase.com/pricing · https://steel.dev/pricing · https://www.firecrawl.dev/pricing
- https://hiring.cafe/robots.txt
