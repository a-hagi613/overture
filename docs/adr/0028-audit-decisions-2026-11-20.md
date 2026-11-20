---
status: accepted
---

# Decisions from the architecture and feed audit (2026-11-20)

The owner's rulings after an external audit of the catalog, the submission path, inbound mail and the M2 ATS list.
Each point below is checked against the code or a production probe; anything not yet checked is listed at the end as
"verify before building".

## Applications use the user's real email; ATS mail is forwarded to Overture

- The email typed on every application form is the user's real email, the one on their resume. The resume is sent
  byte-for-byte unchanged, so a different address on the form would not match it, and some ATSes flag or overwrite
  synthetic addresses.
- The user adds one narrow filter in their own mailbox that forwards only mail from ATS sender domains
  (`src/shared/ats-mail-domains.ts`) to their forwarding address `in-{id}-{mac}@tryoverture.com`. `mac` is a
  truncated HMAC of the id under `INBOUND_HMAC_SECRET`, so forged or unknown addresses are dropped without a lookup.
  The forwarding address is never typed on a form.
- Direct replies from recruiters that do not come from an ATS domain stay in the user's own inbox and are not
  captured. The owner accepts this.
- No Gmail or Outlook API access: reading a mailbox needs Google's restricted-scope review and a paid annual security
  assessment. This keeps ADR 0005's rule that the personal mailbox is never connected; the user forwards, Overture
  never reads it.
- For M1 the owner creates the filter by hand. The onboarding step that guides it arrives in M2, after the owner adds
  it to the canvas (ADR 0021); until then no UI is built for it.

This supersedes ADR 0005's generated `first.last@mail.tryoverture.com` job-search address. It also removes the
risk that one shared `mail.tryoverture.com` domain is blocklisted for every user at once.

## Inbound mail goes through Cloudflare Email Routing and an Email Worker

- Email Routing on the apex `tryoverture.com` sends the catch-all to one Email Worker. Literal rules such as `hello@`
  keep forwarding to the owner. Catch-all works on the apex, which is where the forwarding addresses live.
- The Worker checks the address MAC, forwards Gmail and Outlook forwarding-confirmation messages to the owner's
  verified destination, drops mail whose original sender is not an ATS domain, and POSTs the **raw MIME** with the
  envelope as an HMAC-SHA256-signed request (timestamped, 5-minute replay window) to `POST /internal/mail/inbound`.
  No LLM runs in the Worker.
- `overture-web` verifies DKIM and DMARC itself on the raw message with `mailauth`. That answers ADR 0024's
  objection that the Worker gets no authentication results: Overture no longer depends on the receiver's verdicts.
  Forwarding breaks SPF but leaves the original DKIM signature intact, so `auth='pass'` means the original From
  domain's DKIM passes aligned.
- Ingest, threading, linking and "automate only on `auth='pass'`" are unchanged (SPEC §11.1, ADR 0006). Codes are
  read by deterministic patterns. If no code arrives within 10 minutes, the user is asked to paste it.
- No AWS for inbound: no SES receiving, S3 or SNS, and no `mail.sweep`; Email Routing retries on a non-2xx.

This supersedes ADR 0024.

Open for M2: replying to employers from Overture (SPEC §11.2) assumed the job-search address was the address the
employer knew. Under real email a reply from Overture would come from an address the employer never saw, so the
reply composer is not built until the owner decides how it should work.

## Company cooldown default is 30 days

`limits.company_cooldown_days` stays an admin setting; its default moves from 7 to 30 to stay clear of ATS
repeat-application throttles.

## Browser Use Cloud stays the browser for M1 and later

- The owner has reviewed Browser Use's standard terms, including its use of inputs, and accepts them for M1 and M2+.
  No provider evaluation or swap is planned. The Kernel adapter stays behind the port as the emergency fallback (ADR
  0026).
- Every session is stopped through Browser Use's API in a `finally` path and by the recovery sweep. Closing CDP alone
  does not stop billing.
- Every attempt records `browser_ms`, `proxy_bytes` and `cost_micros`. The admin view reports proxy MB and cost per
  completed application against the $0.03 gate (cost as defined in ADR 0026).

## Catalog

- **Greenhouse fetches content in two modes.** A board's first load, or a poll where more than 5 postings are new
  or changed, fetches `/v1/boards/{token}/jobs?content=true` once. Otherwise the summary list is fetched, plus
  `/jobs/{id}?pay_transparency=true` for the 1–5 changed postings. Application questions are fetched only when a
  posting enters the apply queue, never in a sweep. Measured on production: Stripe's `content=true` list is 779 jobs
  and 6.1 MB, Cloudflare's 496 jobs and 8.9 MB.
- **Sweep claims are small.** At most 20 boards per ATS per sweep (`catalog.sweep_max_boards`), so a batch finishes
  well inside its 15-minute claim. There is no lease heartbeat.
- **No worker thread for now.** HTTP stays responsive since the chunked writes of #80. The orchestrator watches
  `/api/health` latency during the faster backfill. A worker thread that writes only catalog rows is revisited only if
  latency regresses; the main thread keeps its read-write connection because sign-in, settings, the ledger and
  dispatch write from it.
- **Feed corrections.** The poll passes each feed's structured workplace to tagging; Ashby uses `workplaceType`,
  never `isRemote`. Lever gets an EU region (`api.eu.lever.co` is a separate board for the same slug), paginates
  with `limit=100&skip=N`, keeps slug case and uses `applyUrl`. Greenhouse has no separate EU API (production probe:
  `boards-api.eu.greenhouse.io` does not resolve, and `boards-api.greenhouse.io` serves `proton`), so only token
  parsing changes for EU board URLs.
- **Discovery after M1.** A weekly job off the production machine (a GitHub Action) merges open board lists into one
  file in Overture's own R2, replacing the runtime dependency on the Stapply bucket. Which lists are used depends on
  their licenses, checked first (below).

## Verify before building (M2 and discovery)

These came from the audit and have **not** been checked against primary sources yet. Each is checked, with its
source URL recorded in the M2 spec, before work that depends on it starts.

- Recruitee: the public `/api/offers/` endpoint is said to require a per-company token from 2027-02-10.
  If true, Recruitee is dropped from M2 and Gem or Pinpoint is evaluated instead.
- SmartRecruiters: said to fall under an SAP API policy restricting large-scale extraction and AI agents. Deferred
  until the policy text is read.
- Workable: said to publish one bulk feed, `https://www.workable.com/boards/workable.xml`, hourly, covering companies
  listed on Jobs by Workable, and to rate-limit per-company widget calls hard. If true, it replaces slug guessing.
- Personio: `https://{company}.jobs.personio.de/xml?language=en`. A missing board is said to redirect to the
  marketing site, so redirects count as gone, with a German fallback when English descriptions are empty.
- Workable is said to detect synthetic applicant emails, which this ADR already avoids.
- Board-list licenses for discovery: ats-scrapers (MIT), freehire (MIT), open-jobs (CC0), ats-directory (CC-BY,
  attribution), yc-oss; job-board-aggregator (CC BY-NC) and SimplifyJobs (no license) are excluded.

## Considered Options

- **A generated job-search address on every form (ADR 0005).** It gives a full inbox, but the form email does not
  match the resume, and one shared domain is a single point of blocklisting.
- **Gmail API access.** One-click setup, but restricted-scope review plus a paid annual assessment, or a per-user
  fee through a broker.
- **SES receiving (ADR 0024).** It gives receiver verdicts, but needs AWS credentials, S3, SNS and a sweep. With raw
  MIME and `mailauth`, the verdicts are no longer needed.
- **Switching browser providers before M2.** The owner accepts Browser Use's terms, so the switch buys nothing now.
