# hiring.cafe as a tag source: desk research

Researched 2026-11-19 for the v2 architecture decision on job tags (role, seniority, workplace, location, employment type, salary, industry, skills). This is desk research and **not legal advice**. No hiring.cafe API, JSON or search endpoint was called. The live site answered every page request from devbox with a Cloudflare challenge, so hiring.cafe's own pages were read from Internet Archive captures (capture dates given). Numbers nobody could confirm from a primary source are marked **unverified**.

## 1. Bottom line

- **Unwise to build on.** hiring.cafe's tags are its own GPT output (GPT-3.5 in 2023, GPT-4o-mini in 2025, about $3k/month in Feb 2025). Copying them still means using a per-posting LLM, just someone else's, under their schema (`v5_processed_job_data`), which can change at any time.
- **Contract risk is high and specific.** Its Terms (§5) forbid anyone to "Republish", "Reproduce, duplicate, or copy" or "Redistribute content from HiringCafe" and allow "your own personal use" only. A bulk import served to Overture's users breaks every one of those. robots.txt also disallows the `?searchState=` URLs v1 used.
- **Solving CAPTCHAs by hand makes it worse, not better.** The Cloudflare challenge is a technical access control. Getting past it to run automated bulk pulls shows you knew access was unwanted. That supports contract, CFAA (US) and anti-circumvention claims (DMCA §1201, Canada Copyright Act s.41.1), and it is unworkable for an hourly feed.
- **Fragile.** Cloudflare blocks devbox-class IPs (ADR 0003). hiring.cafe is a competitor moving into matching ("Talent Agent"). There is no API, licence or feed for sale.
- **Best alternative:** derive tags ourselves from the ATS data we already fetch, in this order: (1) the ATS's own structured fields, (2) code rules plus a title dictionary built from O\*NET (CC BY 4.0), (3) Claude Haiku 5.5 through the Batch API for whatever is left. LLM cost is about **$1.60–$16 one-off** for a 400k backfill and **$1.80–$18 per month** at 15k new postings/day (10–100% fallback). If we need a vendor instead, Fantastic.jobs or TheirStack sell licensed, tagged ATS job data.

## 2. Findings per question

### Q1. Where hiring.cafe's data comes from

- **Company career pages, scraped directly.** The About page: "We collect jobs directly from company websites in real time and filter out external recruiting agencies and fake consulting firms" [S1]. Co-founder Ali Mir (u/alimir1), Sept 2023: "The script I wrote just downloads raw HTML and feeds it to the [GPT] API", "Absolutely avoiding LinkedIn and other job boards", and "Puppeteer works well in node" [S3][S4].
- **How it grew.**
  - Sept 2023: a spreadsheet of **14k** remote-hiring companies, fetched daily, "avg 500-800 new remote job openings per day" [S3].
  - Feb 2025 (co-founder Hamed Nilforoshan, u/hamed_n, "How I scraped 2.1 million jobs"): company URLs from Apollo.io, a Node.js/Cheerio/Puppeteer crawler that finds career pages, an LLM that decides whether a page holds jobs, about **30k** career pages vetted by hand, rotating proxies "only for a few companies", and **"I scrape every company 3x/day"**. He added "I've only scraped 1.35 million [US] jobs out of the 7 million" [S5][S6].
  - 2026 hiring pages: "Web crawlers that scrape every job on earth, in real-time" and "AI browser agents that scrape every job on earth" [S7][S8].
- **Which ATSes.** Many more than Overture's seven. The `source` values in 147 job records embedded in a Canada-located capture of the homepage were `icims2`, `successfactors`, `grnhse`, `adhoc`, `saashr`, `careerplug` and `avature` [S2]. A third-party scraper claims "46 ATS platforms" (**unverified**) [S17]. Founder posts and reviews also name Workday, Greenhouse and Lever [S5][S20].
- **Scale.**
  - The Canada capture showed "283,704 jobs · 12,427 companies" [S2].
  - The global figure of about 3.68M jobs across 115,829 companies comes from a third-party review snapshot (**unverified**) [S20]. Scraper listings give anywhere from 2.8M to 6M (**unverified**).
  - hiring.cafe says it grew from "0 → 1 million+ monthly active users in 12 months" [S7].
- **Refresh.** The founder said 3x/day per company in Feb 2025 [S5][S6]. Today's site says "real time" [S1] (no number given).

### Q2. How it produces tags; its filters and taxonomy

- **The tags are LLM output, by the founders' own account.**
  - 2023: "Then I used GPT API to grab listings and summarize job descriptions", the model was "GPT-3.5 turbo… Only beef is frequent inaccuracy", and seniority was "hard for GPT to classify" [S3].
  - 2025: "GPT-4o-mini" turns raw HTML into JSON (salary, YOE, remote…) at "About 3k/month right now", batching "3 jobs into a single prompt" [S5][S6].
  - The 2026 data model confirms it. Every job carries a `v5_processed_job_data` object with about 90 extracted fields. Employer attribution records `"method": "llm_pick"` on 143 of 147 sampled records. Duplicates are clustered (`strict_dedup_cluster_id`, `liberal_dedup_cluster`) [S2].
- **Filter panel dimensions** (homepage capture, Oct 2026, verbatim) [S2]: Date Posted · Apply Process · Exclude Jobs · Activity & Outcomes · Departments · Job Titles & Keywords · Experience · Commitment · Salary · Benefits & Perks · Education · Licenses & Certifications · Security Clearance · Languages · Encouraged to Apply · Shifts & Schedules · Travel Requirement · Company · Industry · Stage & Funding · Size · Founding Year. Location sits under its own control (city, state, country or continent, with radius and "anywhere in continent/world") [S2][S4].
- **Values.** The full enumerations are in the client JavaScript, which was not read. Below are values seen in the 147-record sample [S2], plus the full sets documented by a scraper's input schema [S16]:

| Field (`v5_processed_job_data`) | Values |
|---|---|
| `seniority_level` | No Prior Experience Required, Entry Level, Mid Level, Senior Level, Director, Executive (full set per [S16]) |
| `commitment` (multi) | Full Time, Part Time, Contract, Internship, Temporary, Seasonal, Volunteer (full set per [S16]) |
| `workplace_type` | Remote, Hybrid, Onsite (filter set [S16]), plus Field (seen in data) |
| `role_type` | Individual Contributor, People Manager |
| `job_category` (28 seen; full list unknown) | Engineering; Software Development; Information Technology; Sales; Business Development; Business Operations; Customer Service; Marketing; Communications and Public Affairs; Finance and Accounting; Human Resources; Legal and Compliance; Administrative & Clerical Support; Project and Program Management; Quality Assurance; Research and Development (R&D); Supply Chain / Logistics / Procurement; Transportation Services; Food and Beverage Services; Custodial Services; Education services; Healthcare Services - Nursing / - Allied Health / - Pharmacy; Skilled Trades - General Labor / - Maintenance and Repair / - Manufacturing and Industrial / - Mechanical and Electrical |
| `company_sector_and_industry` (14 seen) | Agriculture; Construction; Consulting Services; Education; Finance; Government Agencies and Departments; Healthcare; Hospitality and Tourism; Industrial Processing; Information Technology; Manufacturing; Media and Communications; Retail and Wholesale; Transportation and Logistics |
| company `industries` (fine-grained, 25+ seen) | e.g. IT Services & Consulting, Software & SaaS, Hospitals & Health Systems, Logistics & Supply Chain Services, Retail… |
| company `organization_type` | Private, Public, Government, Non-Profit, Cooperative / Mutual |
| salary | `{yearly,monthly,weekly,bi-weekly,daily,hourly}_{min,max}_compensation`, `listed_compensation_currency`, `listed_compensation_frequency` (Yearly/Monthly/Weekly/Daily/Hourly), `is_compensation_transparent` |
| experience | `min_industry_and_role_yoe`, `min_management_and_leadership_yoe` |
| education | `{associates,bachelors,masters,doctorate}_degree_requirement` (Required / Preferred / Not Mentioned) and `_fields_of_study` |
| work conditions | `physical_labor_intensity`, `cognitive_demand`, `computer_usage`, `oral_communication_level` (Low/Medium/High); `physical_position` (Sitting/Standing); `workplace_physical_environment` (Office, Customer-Facing, Industrial, Outdoor); `air/land_travel_requirement` (None/Minimal/Moderate…); `morning/evening_shift_work`, `overnight_work` (Required/Optional/Not Indicated); `on_call_requirement` |
| flags | visa_sponsorship, relocation_assistance, fair_chance, military_veterans, 401k_matching, retirement_plan, tuition_reimbursement, generous_paid_time_off, generous_parental_leave, four_day_work_week, overtime_required, weekend/holiday availability, is_driver_license_required, is_high_school_required |
| other | `security_clearance` (None, Secret, Top Secret, Other…), `language_requirements`, `technical_tools`, `role_activities`, `core_job_title`, `requirements_summary`, `licenses_or_certifications`, `position_employer_type` (Internal/External Position) |

- **No published or open taxonomy was found.** The category names are hiring.cafe's own. They do not match O\*NET, ESCO or LinkedIn labels.

### Q3. Official API, feed, licensing or partnership

- **No data API, feed, export or licence is offered, and no pricing exists.** No such page was found. A competing vendor states "Hiring.cafe does not offer a public API" [S18]. The FAQ and Terms do not mention licensing [S1][S9].
- **One sanctioned machine interface exists: an anonymous, read-only MCP "Claude Connector" (and a ChatGPT app)** at `hiringcafe.com/api/mcp`. Its tool `search_jobs` takes `search`, `location`, `workplace_types`, `radius_miles` and `employment_types`, and returns "one job per company" [S10][S11]. It is built for a person's conversational search. It is not a bulk channel and does not change §5 of the Terms. Using it to backfill a catalog would be the same breach by a different route. Not called in this research.
- **The ecosystem is gray-market.** About 15 Apify actors and GitHub projects resell hiring.cafe scraping at roughly $1–3 per 1k jobs. They advertise riding Cloudflare's challenge with residential proxies and push ToS compliance onto the buyer [S16][S17].

### Q4. Terms of Service, robots.txt and enforcement

- **Terms** (effective Aug 28, 2024; capture of 2026-10-24) [S9]:
  - §1: "By accessing this website, we assume you accept these terms and conditions. Do not continue to use HiringCafe if you do not agree…" This is a **browsewrap**: it binds every visitor, not only account holders.
  - §5 Intellectual Property: "HiringCafe and/or its licensors own the intellectual property rights for all material on this website… You may access this from HiringCafe for your own personal use subjected to restrictions set in these terms and conditions. You must not: Republish material from HiringCafe; Sell, rent, or sub-license material from HiringCafe; Reproduce, duplicate, or copy material from HiringCafe; Redistribute content from HiringCafe."
  - §7: you indemnify HiringCafe for "any and/or all liabilities… related to your breach".
  - §10: California law, exclusive jurisdiction of California courts.
  - **There is no express "no scraping/robots/CAPTCHA" clause.** But "personal use" plus the bans on copying and republishing cover a bulk import into a commercial product. The operator is **SPICYHR INC.**, Cupertino [S1].
- **robots.txt** (fetched live 2026-11-19; Cloudflare + Vercel) [S12]. `User-agent: *` allows `/`, `/about`, `/jobs`, `/job/`, `/careers`, `/insights`, `/recently-posted-jobs`, `/talent-network`, `/terms-and-conditions`, `/private-policy` and `/ai-search/$`. It disallows:
  - `/cdn-cgi/` and `/viewjob/`
  - the apply links `/applyclick`, `/api/applyclick/`, `/api/sponsored/`, `/org/`, `/company/`, `/b/`. The file comments: "A client that requests these anyway is ignoring this file."
  - the duplicates `/req/` and `/board/`
  - **`/*?searchState=*`, `/*?page=*` and `/*&page=*`**
  - the private areas and `/ai-search/` chats
  - the whole site for `meta-externalagent` and `Applebot-Extended`

  It lists six sitemaps, including `jobs-sitemap.xml`. Note that v1 parsed `https://hiring.cafe/?searchState=…` URLs (`src/brain/hiring-cafe/search-state.ts`), which is exactly a disallowed pattern.
- **Enforcement.** No public report of a lawsuit, cease-and-desist letter or blocking campaign against hiring.cafe scrapers was found (searched 2026-11-19) [S19]. Absence of reports is not evidence of tolerance. The Backend/Infra job ad asks for "an interest in security and reverse-engineering" [S7], which reads as active anti-abuse work (interpretation).

### Q5. Anti-bot measures (public evidence only)

- **Cloudflare managed challenge.**
  - In this research, plain HTTPS GETs from devbox to `/terms-and-conditions`, `/about` and `/private-policy` returned **HTTP 403 "Just a moment… Enable JavaScript and cookies to continue"** with `cType: 'managed'`. The `robots.txt` request returned 200 with `server: cloudflare` and `x-vercel-id` [S12].
  - A commercial scraper documents waiting for the "Cloudflare Managed Challenge to self-solve (typically 8–20 seconds)", then calling "Hiring.cafe's internal search API directly from the browser context, reusing the Cloudflare cookies", on residential US proxies with up to 6 retries [S16].
  - Our own ADR 0003: "datacenter IPs are blocked by hiring.cafe's Cloudflare" [S21].
- **Rate limits, CAPTCHA vendor beyond Cloudflare, and how long `cf_clearance` lasts:** not publicly documented (**unverified**).

### Q6. Legal landscape (summary, not legal advice)

**United States**
- **hiQ v. LinkedIn.** The Ninth Circuit (2019, reaffirmed 2022 after *Van Buren*) said scraping *public* pages is probably not "without authorization" under the CFAA [S22]. But on remand LinkedIn **won on breach of contract** (Nov 2022: hiQ's automated scraping and its fake-account "turkers" breached the User Agreement). The case ended with a **stipulated $500,000 judgment and a permanent injunction** against scraping "directly or indirectly… whether logged in or not" (Dec 6–8, 2022) [S23][S24]. Lesson: the contract, not the CFAA, is what bites.
- **Meta v. Bright Data** (N.D. Cal., Jan 23, 2024). Summary judgment went to Bright Data. Meta's terms covered only *logged-in* use, and they stopped binding Bright Data once its accounts were closed. Meta later dropped the case [S25]. Lesson: logged-off scraping can escape a contract claim **when the terms bind only account holders**. hiring.cafe's §1 browsewrap claims to bind every visitor. Whether a browsewrap binds turns on notice, and Overture's owner plainly has notice. Related: *X Corp. v. Bright Data* (May 2024) dismissed state-law scraping claims as preempted by copyright, and was appealed [S26].
- **Getting past technical barriers.** In *Facebook v. Power Ventures* (9th Cir. 2016), access **after a cease-and-desist letter and an IP block** was CFAA and Cal. Penal Code §502 liability [S27]. On CAPTCHAs specifically:
  - *Ticketmaster v. RMG* (C.D. Cal. 2007) found CAPTCHA-defeating software likely violated **DMCA §1201**. It ended with an $18M judgment and an injunction.
  - *Craigslist v. Naturemarket* (N.D. Cal. 2010) followed the same reasoning, by default [S28].

  These are district-court rulings and they targeted *tools*. A person solving a CAPTCHA by hand is arguably not "circumventing". But using the cleared session to drive automated bulk requests is exactly what the challenge exists to stop, and it proves knowledge.

**Canada**
- **Contract and browsewrap.** In *Century 21 Canada v. Rogers Communications (Zoocasa)*, 2011 BCSC 1196, a **browsewrap was enforceable** against a scraper who used the site with notice of its terms. Scraping in breach of the terms was a breach of contract and an injunction was granted. Accounts of the copyright and damages findings differ [S29].
- **Copyright in compilations.** Facts are not protected. A compilation is protected only for original selection or arrangement (Copyright Act s.2; *CCH v. LSUC*, 2004 SCC 13). The **job descriptions** belong to the employers. hiring.cafe's tags are largely facts, but its summaries and taglines are expression. Scraping cases still win on copyright plus contract, e.g. *TREB v. Mongohouse* (FC 2019) [S30].
- **Technological protection measures.** Copyright Act **s.41.1** bars circumventing a TPM that controls access to a work, with civil remedies for the owner [S31]. Whether a Cloudflare challenge in front of a site full of copyrighted descriptions counts as a TPM is untested (**unverified**). CanLII v. Caseway (2024) pleads exactly ss.41 and 41.1 plus a ToS ban on bulk downloading (allegations only) [S30].
- **PIPEDA** is mostly irrelevant to job ads. It would apply to recruiter names, emails and phone numbers inside descriptions, which some scraper outputs extract [S17].

**What this means for the plan.** The risky part is not reading public job facts, which Overture already does from the ATSes. It is: (a) taking a **competitor's derived dataset**, (b) **in bulk**, (c) for **commercial redistribution**, (d) against an express "personal use only / no reproduce / no redistribute" term, (e) **with notice**, (f) after **getting past a bot challenge** by hand, (g) under a California venue clause. Every one of those is a factor courts have weighed against scrapers. Damages would probably be modest. The likely real outcome is a demand letter, an injunction, IP or account bans, and the import disappearing overnight.

### Q7. Legitimate alternatives

**(a) Open taxonomies**

| Taxonomy | Fit | Licence |
|---|---|---|
| **O\*NET-SOC (O\*NET 31.0)** | US occupations (923 data-level per [S36]); includes alternate and reported job titles that are ideal for a title dictionary | **CC BY 4.0**: attribute "O\*NET 31.0 Database, USDOL/ETA", link the licence, mark changes; trademark rules apply [S32] |
| **ESCO** (EU; ISCO-08 based) | About 3k occupations and 13.9k skills (**unverified** counts), 28 languages, CSV/RDF | Commission Decision 2011/833/EU: "download, use, reproduce and reuse for any purpose… free of charge" with attribution; API software EUPL 1.2 [S33] |
| **ISCO-08** (ILO) | 4-level international occupation codes; ESCO bundles it as a supporting module | ILO licence not confirmed (**unverified**) [S33] |
| **NOC 2021** (Statistics Canada) | Canadian occupations, relevant for Canadian users | Statistics Canada Open Licence (**unverified**, not fetched) |
| **LinkedIn job function codes** | 35 short codes (acct, adm, advr, anls, art, bd, cnsl, cust, dist, dsgn, edu, eng, fin, genb, hcpr, hr, it, lgl, mgmt, mnfc, mrkt, othr, pr, prch, prdm, prjm, prod, qa, rsch, sale, sci, stra, supl, trng, wrt). A good UX-level function list [S34] | Published as API docs under LinkedIn's API terms. Copying a 35-word generic category list is low risk, but don't call LinkedIn APIs for it |
| **Lightcast Open Skills / Titles** | 33k+ skills, 75k+ titles [S35] | Free with attribution, but "for for-profit or production use cases, a commercial license is required" [S35] |

**(b) Open-source title normalizers and classifiers**
- **onet-match** (MIT; O\*NET 31.0, 923 occupations). Fine-tuned bge-base bi-encoder plus reranker. **51.1% top-1 / 79.1% top-5** on 6,792 held-out O\*NET texts and **65.4% / 92.9%** on messy text, against TF-IDF at 20.5% / 40.5%. About 47 ms per query on a laptop, 0.5 GB (130 MB int8) [S36].
- **TechWolf JobBERT-v2** (MIT; from all-mpnet-base-v2). Job-title embeddings trained on about 5.5M title–skill pairs, **0.6457 MAP on TalentCLEF** [S37]. JobBERT-v3 is multilingual (licence not checked).
- **MatchMyJob** (SBERT O\*NET autocoder). 73.4% accuracy at the 2-digit SOC major group (485/661); licence not found [S38].
- **NIOSH NIOCCS.** Free industry and occupation autocoder (SOC/NAICS/Census) with a free web API and no account. Built for survey coding. No public accuracy figure [S39].

Takeaway: exact SOC 6-digit codes are hard (about 50% top-1). But **function-level buckets (~25–35 classes) are much easier**, since major-group accuracy is around 73% even for a weak model, and a title dictionary plus department hints lifts it further.

**(c) Licensed job-data vendors**

| Vendor | Coverage | Tags | ATS URL | Price |
|---|---|---|---|---|
| **Fantastic.jobs** | 275k+ career sites on 58 ATSes, 3M+ ATS jobs/month, polled hourly, 6-month backfill [S13] | "20+ AI-enriched fields" (not itemised on the pricing page) [S13] | Links to original postings; a field-level apply URL is not documented [S13] | $45/mo (5k jobs) … $250 (100k) … $900 (500k) … $2,800 (2M); custom above that [S13] |
| **TheirStack** | 373k sources, 195 countries, history from 2021 [S14] | `seniority` always filled (c_level, staff, senior, mid_level, junior); `employment_statuses` (91% filled); `workplace_types` (about 21% filled); salary normalized to annual USD (about 20% filled) [S15] | `url` is the original posting, following job-board redirects [S15] | $49 (1.5k credits) … $600 (100k) … $1,500 (1M) … $5,500 (5M); 1 credit per job [S14] |
| **Coresignal** | 460–480M job records (**unverified**) | Standard job fields | **unverified** | About $49–$5,000/mo, 1 credit per job (third-party figures, **unverified**) [S40] |
| **Adzuna API** | Aggregator | Categories, salary | Adzuna redirect (not confirmed) | Free key is "intended for evaluating"; "for any use in a product… that generates revenue or leads, a licence agreement is required"; Adzuna branding required on adverts [S41] |
| **Techmap, LinkUp, Lightcast Job Postings, Jooble, Indeed/ZipRecruiter feeds** | — | — | — | Not researched in depth. All are enterprise or partner contracts, mostly built around board traffic rather than ATS apply URLs (**unverified**) |

For Overture specifically, a vendor adds little. We already pull the seven ATS APIs directly for apply, and only those seven can be applied to. A vendor makes sense only if we want discovery beyond our 22,800 boards.

### Q8. LLM-fallback cost (Claude Haiku 5.5)

Assumptions from the brief: $0.10 per 1M input tokens and $0.50 per 1M output tokens. That matches the Claude API reference bundled with Claude Code (cached 2026-11-03; price applies to prompts up to 100K tokens). The Message Batches API is 50% off [S42]. Each call is about 500 input and 60 output tokens, so **$0.00008 per posting at standard rates and $0.00004 through Batch**.

| Fallback rate | 400k backfill (std / batch) | 15k/day (std / batch) | per 30 days (std / batch) |
|---|---|---|---|
| 100% | $32.00 / **$16.00** | $1.20 / $0.60 | $36.00 / **$18.00** |
| 30% | $9.60 / **$4.80** | $0.36 / $0.18 | $10.80 / **$5.40** |
| 10% | $3.20 / **$1.60** | $0.12 / $0.06 | $3.60 / **$1.80** |

Caveats:
- **Turn thinking off.** Haiku 5.5 runs adaptive thinking **by default (effort `medium`)**, and thinking tokens bill as output. Send `thinking: {type: "disabled"}` (allowed at effort high or below) together with structured outputs, so the 60-token assumption holds. About 300 thinking tokens per call would roughly triple the cost [S42].
- **Full descriptions cost more.** Sending the full description (~1,500 tokens) instead of the first ~300 words roughly doubles or triples the input cost. Still under $50 for the backfill.
- **One-off company industry tagging is pocket change.** Industry is a company property, so tag the 22,800 employers once: at about 1,000 input and 50 output tokens each, that is about **$2.85 standard / $1.43 batch**.
- **For comparison,** hiring.cafe reported spending about $3k/month to LLM-tag 2.1M+ jobs with about 90 fields [S6].

## 3. Recommendation: taxonomy and classification

**Taxonomy (product-facing, small and stable; codes stored behind it):**
- **Function:** about 30 Overture functions. Use LinkedIn's 35-code list as the UX vocabulary, and give each one an O\*NET-SOC 2019 major/minor-group mapping (CC BY 4.0) so analytics and crosswalks (ESCO/ISCO, NOC) stay possible. Keep the O\*NET-SOC code per posting where confident.
- **Seniority:** Intern/No experience · Entry · Mid · Senior · Staff/Principal/Lead · Manager · Director · Executive. Collapse these onto the existing onboarding `ExperienceLevel` (intern, junior_mid, mid_senior, staff_plus) in `src/shared/onboarding.ts`. Store `role_type` (IC vs people manager) separately, as hiring.cafe does.
- **Workplace:** remote / hybrid / onsite / unknown. This is already `WorkplaceType` in `src/shared/types.ts`.
- **Employment type:** full_time, part_time, contract, temporary, internship, seasonal, volunteer.
- **Salary:** min, max, currency and period as listed, plus annualised values. Only when stated (pay-transparency laws make this common).
- **Location:** country, region and city, plus a remote-eligibility region. Geocode with GeoNames (CC BY 4.0, **unverified**).
- **Industry:** company level, tagged once per employer. **Skills:** defer. If needed, ESCO skills (free) rather than Lightcast (commercial licence).

**Pipeline** (code first; the LLM only for what's left):
1. **ATS structured fields first.** Lever `categories.commitment/department/team` and `workplaceType`; Ashby `employmentType`, `isRemote`/`workplaceType` and compensation; SmartRecruiters `experienceLevel`, `typeOfEmployment`, `function`, `industry`; Workable `employment_type`, `experience`, `function`, `industry`, `workplace`; Recruitee `category`, `employment_type`, `experience`, remote flags and salary; Personio XML `employmentType`, `seniority`, `occupationCategory`; Greenhouse `departments`/`offices` plus pay-transparency metadata where present. This field list comes from general knowledge of each ATS's public API (**unverified in this session**). Check it against `src/brain/sources/*` before relying on it.
2. **Deterministic rules.** Title regexes for seniority (Intern, Junior, Associate, I/II/III, Senior/Sr, Staff, Principal, Lead, Manager, Head of, Director, VP, Chief), keyword rules for workplace and employment type, a salary regex, and a department→function dictionary.
3. **Title dictionary plus embeddings.** Use O\*NET alternate and reported titles (CC BY 4.0) as the dictionary. On a miss, run nearest neighbour on JobBERT-v2 or onet-match (both MIT, CPU-only, ~50 ms). Accept above a confidence threshold.
4. **Haiku 5.5 through the Batch API** for what is still uncertain. Send title, department and the first ~300 words, with structured output limited to our enum values, thinking off, and the result cached by normalized `(title, department, company)` so repeat postings cost nothing. Expect a 10–30% fallback rate in practice (**unverified**; measure it).
5. **Eval.** Hand-label about 500 postings across the seven ATSes. Report per-field accuracy and fallback rate, and re-run the eval whenever the rules change.

**Expected cost:** about $5–16 one-off for the backfill and about $5–18 per month ongoing. No vendor, no ToS exposure, and no human CAPTCHA duty.

## 4. Sources (all accessed 2026-11-19)

- [S1] hiringcafe.com/about, Internet Archive capture 2026-10-22: https://web.archive.org/web/20261022145808/https://hiringcafe.com/about
- [S2] hiringcafe.com homepage (filter panel and embedded `__NEXT_DATA__` job records), capture 2026-10-21: https://web.archive.org/web/20261021223849/https://hiringcafe.com/
- [S3] u/alimir1, "I used GPT to fetch 40,918 remote jobs", r/ChatGPT, 2023-09-06; archived: https://web.archive.org/web/20231116012849/https://old.reddit.com/r/ChatGPT/comments/16c0b6p/i_used_gpt_to_fetch_40918_remote_jobs/
- [S4] u/alimir1, "My 2-year plan to destroy Indeed", r/recruitinghell, 2024-07-31; archived: https://web.archive.org/web/20250319143816/https://old.reddit.com/r/recruitinghell/comments/1egpyx6/my_2year_plan_to_destroy_indeed/
- [S5] u/hamed_n, "How I scraped 2.1 million jobs…", r/datascience, 2025-02-26: https://www.reddit.com/r/datascience/comments/1iynyco/ (archived https://web.archive.org/web/20250227171625/https://www.reddit.com/r/datascience/comments/1iynyco/how_i_scraped_21_million_jobs_including_5335_data/)
- [S6] Gist copy of [S5] post body: https://gist.github.com/thoroc/21601e286d9d4fec8505a88d71145ad9 (comment quotes "About 3k/month", "batch jobs together", "Only for a few companies, see point 4 about proxies" from the [S5] archive)
- [S7] hiringcafe.com/work-here/founding-engineer-backend-infra, capture 2026-10-24: https://web.archive.org/web/20261024094917/https://hiringcafe.com/work-here/founding-engineer-backend-infra
- [S8] hiringcafe.com/work-here/founding-engineer-ml-ai-search, capture 2026-10-24: https://web.archive.org/web/20261024094917/https://hiringcafe.com/work-here/founding-engineer-ml-ai-search
- [S9] HiringCafe Terms and Conditions (effective 2024-08-28), capture 2026-10-24: https://web.archive.org/web/20261024094917/https://hiringcafe.com/terms-and-conditions
- [S10] HiringCafe Claude Connector docs (via search-result extract; live page behind Cloudflare): https://hiringcafe.com/documentation/hiringcafe-claude-connector
- [S11] HiringCafe privacy policy, capture 2026-10-23 (mentions Claude Connector / ChatGPT app): https://web.archive.org/web/20261023163213/https://hiringcafe.com/private-policy
- [S12] https://hiringcafe.com/robots.txt (fetched live; headers `server: cloudflare`, `x-vercel-id`); same-day 403 Cloudflare managed challenge on /terms-and-conditions, /about, /private-policy
- [S13] Fantastic.jobs API pricing: https://fantastic.jobs/api ; about: https://fantastic.jobs/about
- [S14] TheirStack pricing: https://theirstack.com/en/pricing
- [S15] TheirStack job data dictionary: https://theirstack.com/en/docs/datasets/options/job
- [S16] Apify "Hiring.cafe Jobs Scraper & API" (parsebird): https://apify.com/parsebird/hiring-cafe-scraper
- [S17] Apify "Hiring.Cafe Jobs Data API — 46 ATS" (blackfalcondata): https://apify.com/blackfalcondata/hiringcafe-scraper
- [S18] JobsPipe, "Hiring.cafe API: there isn't one" (2026-07-28, competitor content): https://jobspipe.dev/blog/hiring-cafe-api
- [S19] Web searches for hiring.cafe scraper enforcement and CAPTCHA reports (no results specific to hiring.cafe), 2026-11-19
- [S20] Scoutify, "HiringCafe Review 2026": https://scoutify.com/blog/hiringcafe-review/ ; ResumeUp review: https://resumeup.ai/blog/hiringcafe-review
- [S21] Internal: `docs/adr/0003-cloud-brain-laptop-hands.md` (datacenter IPs blocked by hiring.cafe's Cloudflare)
- [S22] Haynes Boone on hiQ v. LinkedIn (9th Cir. 2022): https://www.haynesboone.com/news/publications/ninth-circuit-rejects-linkedin-efforts-to-block-web-scraping--of-member-public-profiles.pdf
- [S23] hiQ/LinkedIn stipulated consent judgment: https://s3.documentcloud.org/documents/23429042/hiq-stip.pdf
- [S24] ZwillGen, "hiQ v. LinkedIn Wrapped Up": https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/ ; Privacy World (Nov 2022 breach-of-contract ruling): https://www.privacyworld.blog/2022/11/federal-court-rules-in-favor-of-linkedins-breach-of-contract-claim-after-six-years-of-cfaa-data-scraping-litigation/
- [S25] Farella Braun + Martel on Meta v. Bright Data: https://www.fbm.com/technology/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/ ; Eric Goldman blog: https://blog.ericgoldman.org/archives/2024/01/game-on-bright-data-scores-major-victory-in-web-scraping-dispute-with-meta-guest-blog-post.htm ; MediaPost (Meta abandons suit): https://www.mediapost.com/publications/article/393996/None
- [S26] Proskauer on X Corp. v. Bright Data: https://newmedialaw.proskauer.com/2024/05/14/california-court-issues-another-noteworthy-decision-dismissing-breach-of-contract-and-tort-claims-in-web-scraping-dispute/ ; Techdirt: https://www.techdirt.com/2024/05/15/musks-extwitter-fumbles-copyright-law-loses-data-scraping-lawsuit
- [S27] Apify blog on Facebook v. Power Ventures: https://blog.apify.com/facebook-v-power-ventures/
- [S28] InfoLawGroup, "CAPTCHA. DMCA GOTCHA?": https://www.infolawgroup.com/insights/2010/10/articles/digital-millenium-copyright-ac/captcha-dmca-gotcha ; Ticketmaster v. RMG opinion: https://www.cacd.uscourts.gov/sites/default/files/CV07-2534ABD.pdf
- [S29] Barry Sookman on Century 21 v. Rogers: https://barrysookman.com/2011/09/08/website-terms-copyright-used-to-shut-down-real-estate-data-scraping-in-century-21-v-rogers/ ; DWW: https://www.dww.com/articles/bc-court-finds-web-site-%E2%80%9Cbrowse-wrap%E2%80%9D-agreement-enforceable ; Slaw: https://www.slaw.ca/2011/10/21/browsewrap-contract-upheld-in-canada/
- [S30] Shift Law, webscraping and copyright in factual content: https://shiftlaw.ca/copyright-and-factual-content/ ; ABA Business Law Today (CanLII v. Caseway, OpenAI suit): https://businesslawtoday.org/2025/02/scraping-the-surface-openai-sued-for-data-scraping-in-canada/
- [S31] Copyright Act (Canada) s.41.1: https://laws-lois.justice.gc.ca/eng/acts/C-42/section-41.1.html
- [S32] O\*NET 31.0 Database licence: https://www.onetcenter.org/license_db.html
- [S33] ESCO FAQ / reuse terms: https://esco.ec.europa.eu/en/about-esco/faq ; download: https://esco.ec.europa.eu/en/use-esco/download
- [S34] LinkedIn Job Function Codes (Microsoft Learn): https://learn.microsoft.com/en-us/linkedin/shared/references/reference-tables/job-function-codes
- [S35] Lightcast Open Skills FAQ: https://lightcast.io/open-skills/faqs ; free API access: https://docs.lightcast.io/lightcast-api/docs/free-api-access ; Open Terms: https://legal.lightcast.io/lightcast-legal/open-terms-of-use
- [S36] onet-match: https://github.com/Benjamin-V-Chan/onet-match
- [S37] TechWolf JobBERT-v2: https://huggingface.co/TechWolf/JobBERT-v2
- [S38] MatchMyJob: https://github.com/ankitk12029/MatchMyJob
- [S39] NIOSH NIOCCS web API: https://csams.cdc.gov/nioccs/HelpWebService.aspx ; NIOSH bulletin: https://cdc.gov/niosh/bulletin/2022/100-million-and-counting.html
- [S40] Coresignal pricing (third-party): https://jobspipe.dev/blog/coresignal-pricing ; https://datarade.ai/data-providers/coresignal/profile
- [S41] Adzuna API terms: https://developer.adzuna.com/docs/terms_of_service
- [S42] Claude API reference bundled with Claude Code (`claude-api` skill, model table cached 2026-11-03): Haiku 5.5 $0.10/$0.50 per MTok (≤100K-token prompts), adaptive thinking on by default (effort `medium`), Batches 50% off. Live pricing: https://platform.claude.com/docs/en/about-claude/pricing (not fetched)
