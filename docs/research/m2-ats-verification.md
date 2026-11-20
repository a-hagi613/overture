# M2 ATS and discovery claims, checked (issue #114)

Checked on **2026-11-20** against primary sources only: the vendors' own developer docs, help centres, policy
pages, licence files, and a few HTTP headers. Desk research, not legal advice. No hiring.cafe request, no form
submitted, no company board probed at scale. Quotes are verbatim from the page read that day; where the vendor
shows its own "updated" date it is given. A handful of one-off requests were made and are listed in §9.

This note answers ADR 0028's "Verify before building" list and adds claim 8 (Cloudflare Email Sending), which
decides #90.

## Verdicts at a glance

| # | Claim | Verdict |
|---|---|---|
| 1 | Recruitee `/api/offers/` needs a per-company token from 2027-02-10 | **Confirmed** |
| 2 | SmartRecruiters falls under the SAP API policy against bulk extraction and AI agents | **Confirmed** |
| 3 | Workable publishes one hourly bulk XML feed for all customers | **Confirmed** (but ~831 MiB); widget rate figure **unverifiable** |
| 4 | Personio XML feed: missing board redirects; English descriptions may be empty | URL/auth **confirmed**; redirect **refuted** (404); empty-English **confirmed** by docs |
| 5 | Workable detects synthetic applicant emails | **Confirmed** |
| 6 | Board-list licences | **Confirmed**, with one correction: `ats-directory` is CC0, not CC-BY; `job-board-aggregator`'s data is CC BY-NC, its code MIT |
| 7 | Gem and Pinpoint public job-board APIs | **Confirmed** for reading; no published rate limits; terms restrict republishing |
| 8 | Cloudflare Email Sending: GA, $5 for 3,000, DKIM from our domain | **Beta, not GA**; price **confirmed with a correction**; DKIM **confirmed** |

## 1. Recruitee: per-company token from 2027-02-10

**Verdict: confirmed.**

**Evidence.** <https://docs.recruitee.com/reference/authentication-1> (page updated 2026-08-12), read 2026-11-20:

> Deadline for introducing the token to calls is **10 February 2027**
> Calls without the authorization header will return the `401 Unauthorized` error

The same page makes the token per company account and narrow in scope:

> Careers API token only covers single account's Careers Site API. If you are a user in multiple companies, you
> need to generate the token for every company account to retrieve access to the API.
> The token only covers the endpoints mentioned in the documentation: **/offers**, **/offers/:id**,
> **/offers/:offer_slug/candidates**. The XML offer feed and jobs widget are not covered by the Careers API token

The legacy endpoint reference (<https://docs.recruitee.com/reference/offers-get>, updated 2025-12-16) marks
`/offers` "**Legacy endpoint**" and its only 401 example is "Resource access requires authentication!".

Vendor changelog (<https://support.recruitee.com/en/articles/12087172-upcoming-changes-to-your-custom-api-integrations>,
read 2026-11-20) adds rate limits: "The /offers endpoint upgrade takes effect on **1 December 2025**" and
"We'll introduce rate limits on **15 October 2025**".

The XML offer feed is not an escape hatch for a catalog: it is "generated per job board"
(<https://docs.recruitee.com/docs/feed>, updated 2025-06-12) and has a `<credentials>` node for board partners,
so it is a partner feed rather than a public per-company API.

**What it means for M2:** drop Recruitee from M2 as ADR 0028 says; there is no token-free public API to build on,
and asking each of thousands of employers to mint Overture a Careers API token does not scale.

## 2. SmartRecruiters: SAP API policy

**Verdict: confirmed.**

**Evidence.** <https://developers.smartrecruiters.com/docs/the-smartrecruiters-platform> (page updated 2026-06-23),
read 2026-11-20:

> Please note that any use of SmartRecruiters APIs is governed by the SAP API Policy posted here, subject to the
> specific SmartRecruiters clarifications identified below.

Its clarifications remove any reading that this is a different policy:

> All references to "SAP" within the Policy shall be interpreted as references to "SmartRecruiters"

The policy itself, SAP API Policy v.4.2026a (<https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf>,
read 2026-11-20), §2.2.2:

> Except through and within the limits of SAP-endorsed architectures, data services, or service-specific pathways
> expressly identified and intended for such purposes, SAP prohibits API use for: (a) interaction or integration
> with (semi-) autonomous or generative AI systems that plan, select, or execute sequences of API calls, and (b)
> scraping, harvesting, or systematic and/or large-scale data extraction or replication.

§3 gives the remedy: "SAP may monitor API usage and take reasonable enforcement actions, including throttling,
suspension, or termination of access". The policy also binds third parties, not just customers.

**What it means for M2:** drop SmartRecruiters. Overture is exactly (a) a semi-autonomous agent and (b) a
systematic extractor; neither has an endorsed pathway, and the downside is a terminated integration.

## 3. Workable: one bulk feed, hourly; widget rate limiting

**Verdict: the feed is confirmed on all three counts; the widget rate-limit figure is unverifiable and
undocumented.**

**Evidence.** <https://help.workable.com/hc/en-us/articles/4420464031767-Utilizing-the-XML-Job-Feed>, read
2026-11-20:

> The XML feed (https://www.workable.com/boards/workable.xml) contains all job information for all our customers
> published on Jobs by Workable.
> The XML feed is updated **every hour,** so more frequent consumption is unnecessary.

Two operational rules matter as much as the coverage:

> Requests that do not specify a supported compression format are blocked with a 403 response indicating that
> compression is required.
> We don't support any filtering parameters on the feed; you should read/download the full file and filter on your
> end.

**Size (one HEAD and two capped GETs, 2026-11-20).** `HEAD` with `Accept-Encoding: gzip` answered `HTTP/2 200`,
`content-type: application/xml`, `x-workable-feed-cache: hit from GCP`. The server ignores `Range`: a ranged GET
returned `200` and `content-length: 871,311,141` — **about 831 MiB of XML** (the transfer was stopped at the 30 s
cap and not retried). With gzip, about 70 MB had arrived when the same cap hit, so the compressed transfer is at
least that; the final size was not measured. A plain (uncompressed) GET was served, so the documented 403 is not a
reliable guard against pulling the whole file.

**Widget rate limit.** Workable documents a limit for its authenticated API, not for the public job widget:
"Yes, it is 10 requests per 10 seconds. If you reach the limit, you will be getting the error 429"
(<https://help.workable.com/hc/en-us/articles/115013356548-Workable-API-Documentation>, read 2026-11-20). No page
states "8 requests in 40 s then Cloudflare 1015"; that number came from a one-off probe and was not repeated here,
because repeating it is probing at scale. **Unverifiable from primary sources**, and moot once the bulk feed is
used.

**What it means for M2:** build Workable from the bulk feed, streamed and decompressed in one pass, refreshed at
most hourly — but do not model it as a board feed: the documented XML carries `<company>` (a display name) and
`<url>` (`apply.workable.com/j/<shortcode>`), not the Workable account slug, so it cannot populate
`company_boards.board_token`; ingest it as postings keyed by `<referencenumber>`.

## 4. Personio: URL, missing board, language fallback

**Verdict: URL and no-auth confirmed; "missing board redirects to the marketing site" refuted; empty English
descriptions with German content confirmed by documentation.**

**Evidence — URL and languages.** <https://developer.personio.de/v1.0/reference/get_xml> (page updated
2026-07-22), read 2026-11-20:

> To URL of the XML feed in English is: https://{YOUR_COMPANY}.jobs.personio.de/xml?language=en
> https://{YOUR_COMPANY}.jobs.personio.de/xml?language=de - German

(sic: "To URL".) The help centre adds that no credentials are needed: "No, you don't need credentials. You can
access your XML feed via the following link: **youraccount.jobs.personio.com/xml**"
(<https://support.personio.de/hc/en-us/articles/29375445597725-Frequently-asked-questions-on-XML-job-integration>,
updated 2026-10-15).

**Evidence — empty English.** Same FAQ:

> The values for the job and the job details always appear in English, but the job description fields can appear
> in different languages. This depends on the language in which you've published the job.

Read strictly, that says descriptions are per-language, so an English feed for a German-only posting has no
description to return while `?language=de` does. The pair itself was not reproduced, because the claim concerns
how a job was published and a second company would not settle it either.

**Evidence — missing board.** A single `HEAD` to a never-used subdomain
(`https://overture-does-not-exist-20261120.jobs.personio.de/xml?language=en`) answered `HTTP/2 404` from the
Personio career-site stack (Express behind CloudFront), **not** a redirect. The claim is therefore **refuted as
stated** for a board that never existed. A deactivated board might redirect, but no safe way to find one was
available. The operational rule survives with one word changed: any non-200 means gone.

**What it means for M2:** keep Personio; fetch per company from the documented `.de` host with no credentials,
treat 3xx and 404 as gone, and fill empty English description blocks from a second `language=de` fetch.

## 5. Workable: synthetic applicant emails

**Verdict: confirmed.**

**Evidence.** <https://help.workable.com/hc/en-us/articles/35293126257815-Managing-AI-assisted-and-automated-job-applications>,
read 2026-11-20:

> Workable detects AI-assisted applications by analyzing application metadata and identifying patterns commonly
> associated with automated application tools.
> If a system-generated email was used during the application, Workable will replace it with the candidate's actual
> email from their resume, when available.

The same page describes the generated-address pattern (`example123.nnx@emailcorper.com`) and the bot defences:
"Web Application Firewall (WAF)", "IP reputation checks and browser integrity validation", and "Rate limiting, bot
management, and CAPTCHA for suspicious traffic".

**What it means for M2:** the ADR's rule stands — type the user's real email on every form and never a generated
address; Workable may rewrite a synthetic one, which would break inbound mail threading.

## 6. Discovery board-list licences

**Verdict: confirmed, with one correction and one nuance.**

Read 2026-11-20 from each repository's `LICENSE` and README through the GitHub API and raw files.

| Repository | Claimed | Found | Verdict |
|---|---|---|---|
| `kalil0321/ats-scrapers` | MIT | "MIT License" (<https://github.com/kalil0321/ats-scrapers/blob/main/LICENSE>) | **Confirmed** |
| `strelov1/freehire` | MIT | "MIT License" (<https://github.com/strelov1/freehire/blob/main/LICENSE>) | **Confirmed** |
| `elliottdehn/open-jobs` | CC0 | "CC0 1.0 Universal" (<https://github.com/elliottdehn/open-jobs/blob/main/LICENSE>) | **Confirmed** |
| `moonie0201/ats-directory` | CC-BY (attribution) | "CC0 1.0 Universal"; README: "CC0 1.0 Universal — public domain dedication. Use it for anything, no attribution required." (<https://github.com/moonie0201/ats-directory/blob/main/LICENSE>) | **Refuted — CC0, not CC-BY** (more permissive, no attribution owed) |
| `yc-oss/api` | (no licence stated) | No `LICENSE`, GitHub reports no licence, README has no licence section (<https://github.com/yc-oss/api>) | **Confirmed — unlicensed** |
| `Riley-Dorrington/job-board-aggregator` | CC BY-NC | Code MIT; README: "The curated company datasets in `data/` are licensed under CC BY-NC 4.0" (<https://github.com/Riley-Dorrington/job-board-aggregator>) | **Confirmed for the data** (code is MIT) |
| `SimplifyJobs` | no licence | `Summer2027-Internships` and `New-Grad-Positions` both have no licence file and GitHub reports none (<https://github.com/SimplifyJobs>) | **Confirmed — unlicensed** |

Also relevant to provenance: `yc-oss/api`'s README says it does not scrape Y Combinator but uses the Algolia search
index; that does not grant a redistribution right.

**What it means for M2:** merge only ats-scrapers, freehire, open-jobs and ats-directory into Overture's own file;
exclude yc-oss (no licence), job-board-aggregator's `data/` (non-commercial) and SimplifyJobs (no licence); if a
CC-BY source is ever added, ship an attribution NOTICE.

## 7. Gem and Pinpoint as Recruitee replacements

**Verdict: confirmed as per-company public read APIs; neither is a discovery feed; neither publishes a rate limit.**

### Gem

- **Endpoint.** `GET https://api.gem.com/job_board/v0/{vanity_url_path}/job_posts/`
  (<https://help.gem.com/databases/gem-help-center/the-job-board-api>, read 2026-11-20). The OpenAPI file
  (<https://api.gem.com/job_board/v0/openapi.json>, read 2026-11-20) has one GET and no security scheme.
- **Auth.** "Most endpoints in the Job Board API are **public** and do not require authentication — job board
  information can be read by anyone using your job board's vanity URL path." Only `POST .../applications` needs a
  team `X-API-Key`.
- **Requirements and limits.** "Requires Gem ATS to be enabled on your account with at least one live job post
  published." No rate limit is documented. Postings link out to `jobs.gem.com`.
- **Terms.** The Gem Acceptable Use Policy (<https://gem.com/compliance/acceptable-use-policy>, effective
  2023-06-22) forbids use that "attempts to reverse engineer, decompile, hack, disable, disassemble, modify, copy
  or create derivative works of the features, functionality, performance or other aspects of the Services",
  "building a similar or competitive product or service", and distributing third-party data "unless you have all
  licenses, rights, valid legal bases and consents to do so".

### Pinpoint

- **Endpoint.** `https://{company-subdomain}.pinpointhq.com/postings.json`
  (<https://developers.pinpointhq.com/docs/jobs-json-endpoint>, updated 2026-04-20, read 2026-11-20).
- **Auth.** None: "This resource can be fetched client side with no CORS issues." Filters by department, location,
  division and city; `/{locale}/postings.json` for other languages.
- **Limits.** "If the locale identifier is left out then by default all results will be returned in English. If no
  translation is found for an attribute then the text returned will fallback to English." No rate limit is
  documented.
- **Terms.** The Pinpoint AUP (<https://pinpointhq.com/security-privacy/acceptable-use-policy>, read 2026-11-20)
  §5(b)(ix) forbids customers to "copy, modify, duplicate, create derivative works from, frame, mirror, republish,
  download, display, transmit, or distribute all or any portion of the Pinpoint Service", and §7 says no access
  right extends to "(iii) use any part of the Content for commercial purposes other than as expressly permitted
  under your subscription". As with Gem, this is written for the employer who bought the ATS, not for a third
  party republishing its postings.

**What it means for M2:** both can replace Recruitee as a per-company JSON read (one request per company, no key),
but only once a company list supplies the Gem vanity path or Pinpoint subdomain; neither feed discovers companies,
and neither grants bulk republication, so keep them behind an employer-opt-out and prefer Pinpoint's documented
public feed first.

## 8. Cloudflare Email Sending (added 2026-11-20, decides #90)

**Verdict: not generally available (Beta); the price is right only when restated; DKIM and our sender domain are
fine; the terms make it unusual for production auth mail today.**

**Evidence — GA.** <https://developers.cloudflare.com/email-service/> (page updated 2026-10-15, read 2026-11-20):

> **Email Sending** Beta sends outbound transactional emails. Available on Workers Paid plan

The Beta label is not cosmetic. Cloudflare's terms (<https://www.cloudflare.com/terms/>, read 2026-11-20):
"Beta Services are intended for testing purposes only"; "We may discontinue, suspend, or remove Beta Services …
at any time in our sole discretion and may never make them generally available"; and Cloudflare has "no liability
for any harm or damage arising out of or in connection with any Beta Services".

**Evidence — price.** <https://developers.cloudflare.com/email-service/platform/pricing/>, read 2026-11-20. The
Workers Paid column reads "3,000 included per month, then $0.35 per 1,000 emails"; the Free column reads "Not
available".

$5 is the Workers Paid minimum, not a mail-only plan: "The Workers Paid plan includes Workers, Pages Functions,
Workers KV, Hyperdrive, and Durable Objects usage for a minimum charge of $5 USD per month for an account"
(<https://developers.cloudflare.com/workers/platform/pricing/>, read 2026-11-20). So "$5/month for 3,000 emails"
is true for an account that needs Workers Paid anyway, and misleading otherwise.

**Evidence — DKIM and sender.** Onboarding a sending domain adds "TXT record for DKIM to provide authentication
for emails sent from your domain", and the selector is `cf-bounce._domainkey.yourdomain.com`; "Cloudflare
automatically generates and manages DKIM keys" (<https://developers.cloudflare.com/email-service/concepts/email-authentication/>,
page updated 2026-11-17). The sender domain must be onboarded on the account, and the docs open with "You must be
using Cloudflare DNS to use Email Service." (<https://developers.cloudflare.com/email-service/get-started/send-emails/>).
`tryoverture.com` is on Cloudflare DNS, so `no-reply@tryoverture.com` can be signed with DKIM. Email Routing
and Email Sending keep separate records (Routing on the apex, Sending on `cf-bounce`), so they coexist.

**Evidence — limits and terms.** <https://developers.cloudflare.com/email-service/platform/limits/> (updated
2026-10-30): 50 recipients per email, 998-character subject, 25 MiB total, 16 KB headers, 30 sending domains per
zone. Sending volume is not published: "New accounts start with a conservative daily quota and scale up over time
based on your sending behavior, deliverability rates, and account standing." The FAQ is explicit on scope: "Can I
use Email Service for marketing emails? No. Email Service supports transactional email only."
(<https://developers.cloudflare.com/email-service/reference/faq/>). The limits page requires compliance with
CAN-SPAM, GDPR and CASL and "proper unsubscribe mechanisms".

**What it means for #90:** do not move magic links onto Cloudflare Email Sending now — it is a beta whose own
terms say testing only, which is not an acceptable base for production sign-in; keep the SES adapter from #90 and
revisit Cloudflare when Email Sending is GA, where 3,000 included emails on a $5 Workers plan would be cheaper
than SES sandbox work.

## 9. Probes run (2026-11-20)

| Request | Result |
|---|---|
| `HEAD https://www.workable.com/boards/workable.xml` with `Accept-Encoding: gzip` | `200`, `content-type: application/xml`, `x-workable-feed-cache: hit from GCP` |
| `GET` the same URL with `Range: bytes=0-1023` (no compression) | Range ignored: `200`, `content-length: 871,311,141`; stopped at 30 s, not retried |
| `GET` the same URL with `Range` and gzip | Range ignored again; stopped at 30 s after 70.9 MB compressed, not retried |
| `HEAD https://overture-does-not-exist-20261120.jobs.personio.de/xml?language=en` | `404` (`text/html`, Express/CloudFront), no `location` header |
| `GET https://personio.jobs.personio.de/xml?language=en` and `?language=de` | `200` each, 2 positions each, no empty `<value>` blocks; not evidence for or against the empty-English case |

No employer board was polled, no form was submitted, and nothing was fetched from hiring.cafe. The only company
board read was Personio's own two-position board, once per language. No personal data is in this note.

## M2 ATS plan

| Source | What the check found | M2 action |
|---|---|---|
| **Recruitee** | Per-company Careers API token from 2027-02-10; no public API; XML feed is per job board | **Drop** from M2 catalog and apply paths; leave the sender domain in `ats-mail-domains.ts` (a user may still get Recruitee mail from an application made elsewhere) |
| **SmartRecruiters** | SAP API policy §2.2.2 forbids AI agents and systematic extraction | **Drop**; revisit only with written SmartRecruiters/SAP permission |
| **Workable** | One hourly bulk XML feed for all customers; ~831 MiB uncompressed, gzip required; no account slug in the documented sample | **Build** a dedicated streamed ingest of `workable.xml` (gzip, one pass, hourly or daily), keyed by `<referencenumber>`; do not add Workable to the per-board sweep or store a `company_boards` row for it |
| **Personio** | Documented per-company `/xml`, no credentials; per-language descriptions; missing board is 404 | **Build** per-company fetch on `.de`; 3xx and 404 = gone; fetch `language=de` when the English description blocks are empty |
| **Workable email** | Detects AI-assisted applications and may replace a synthetic address with the resume one | **No change**: real user email on every form (ADR 0028 already requires it) |
| **Gem** | Public per-company job-board JSON API, no key for reads, no published limit; terms restrict copying | **Defer**; second choice behind Pinpoint, needs a vanity-path list |
| **Pinpoint** | Public per-company `postings.json`, no key, no published limit, English fallback; terms restrict republishing | **Defer** as the first Recruitee replacement candidate; needs a subdomain list and an employer opt-out |
| **Discovery licences** | ats-scrapers MIT, freehire MIT, open-jobs CC0, ats-directory CC0; yc-oss unlicensed; job-board-aggregator data CC BY-NC; SimplifyJobs unlicensed | **Build** the weekly merge from the four permitted lists only; record the excluded three in the ingester and its NOTICE |
| **Cloudflare Email Sending** | Beta, not GA; $5 Workers Paid includes 3,000 then $0.35/1k; DKIM works; transactional only | **Do not use** for #90; keep SES and revisit at GA |

Consequences the ADR has not yet recorded:

- `docs/SPEC.md` §6.1 still lists SmartRecruiters and Recruitee feeds, has no Workable or Personio rows, and
  assumes a per-board feed. After ADR 0028 merges, that table needs the Workable-feed exception: a Workable
  posting has no board token, only a shortcode and a company display name.
- Dropping Recruitee and SmartRecruiters removes two of the four ATSes named in SPEC §17 (M2-10..13) and in the M2
  milestone row. Whether the M2 milestone keeps "four ATSes" or restates it as "two ATSes plus one feed" is an
  owner decision, not a research finding.

## URLs for ADR 0028

For the "Verify before building (M2 and discovery)" list, one line per item:

- **Recruitee token deadline:** <https://docs.recruitee.com/reference/authentication-1>; changelog and rate limits:
  <https://support.recruitee.com/en/articles/12087172-upcoming-changes-to-your-custom-api-integrations>; feed is per
  job board: <https://docs.recruitee.com/docs/feed>.
- **SmartRecruiters / SAP policy:** <https://developers.smartrecruiters.com/docs/the-smartrecruiters-platform>;
  policy PDF: <https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf>.
- **Workable bulk feed, hourly, all customers:** <https://help.workable.com/hc/en-us/articles/4420464031767-Utilizing-the-XML-Job-Feed>;
  feed URL: <https://www.workable.com/boards/workable.xml>.
- **Workable rate limits (API, not widget):** <https://help.workable.com/hc/en-us/articles/115013356548-Workable-API-Documentation>.
- **Personio XML feed and languages:** <https://developer.personio.de/v1.0/reference/get_xml>; no credentials,
  per-language descriptions: <https://support.personio.de/hc/en-us/articles/29375445597725-Frequently-asked-questions-on-XML-job-integration>;
  setup: <https://support.personio.de/hc/en-us/articles/207576365-Integrate-jobs-from-Personio-into-your-website-via-XML>.
- **Workable synthetic-email detection:** <https://help.workable.com/hc/en-us/articles/35293126257815-Managing-AI-assisted-and-automated-job-applications>.
- **Board-list licences:** <https://github.com/kalil0321/ats-scrapers/blob/main/LICENSE>,
  <https://github.com/strelov1/freehire/blob/main/LICENSE>,
  <https://github.com/elliottdehn/open-jobs/blob/main/LICENSE>,
  <https://github.com/moonie0201/ats-directory/blob/main/LICENSE>,
  <https://github.com/yc-oss/api>,
  <https://github.com/Riley-Dorrington/job-board-aggregator>,
  <https://github.com/SimplifyJobs>.
- **Gem job-board API:** <https://help.gem.com/databases/gem-help-center/the-job-board-api> and
  <https://api.gem.com/job_board/v0/openapi.json>; terms:
  <https://gem.com/compliance/acceptable-use-policy>.
- **Pinpoint postings feed:** <https://developers.pinpointhq.com/docs/jobs-json-endpoint>; terms:
  <https://pinpointhq.com/security-privacy/acceptable-use-policy>.
- **Cloudflare Email Sending (claim 8, decides #90):** <https://developers.cloudflare.com/email-service/>; pricing:
  <https://developers.cloudflare.com/email-service/platform/pricing/>; limits:
  <https://developers.cloudflare.com/email-service/platform/limits/>; DKIM:
  <https://developers.cloudflare.com/email-service/concepts/email-authentication/>; transactional-only FAQ:
  <https://developers.cloudflare.com/email-service/reference/faq/>; Workers Paid $5:
  <https://developers.cloudflare.com/workers/platform/pricing/>; beta clause: <https://www.cloudflare.com/terms/>.
