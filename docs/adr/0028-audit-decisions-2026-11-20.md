---
status: accepted
---

# Decisions from the architecture and feed audit (2026-11-20)

The owner's rulings after an external audit of the catalog, the submission path, inbound mail and the M2 ATS list.
Each point below is checked against the code or a production probe; the M2 and discovery claims were checked against
primary sources before building (last section).

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
  verified destination, drops mail whose original sender is not an ATS domain, and hands the **raw MIME** with the
  envelope to the app. No LLM runs in the Worker.
- **The hand-off is a Cloudflare Queue, not a direct POST (#286).** The Worker enqueues the raw MIME (envelope as
  metadata) on `overture-inbound-mail`; a consumer in the same Worker signs it with HMAC-SHA256 (timestamped, 5-minute
  replay window) and POSTs it to `POST /internal/mail/inbound`. A 2xx acks the message; a network error or a `5xx`,
  `408`, `425` or `429` retries it after 5 minutes; any other refusal is dead-lettered at once. The queue keeps
  messages 14 days and retries each up to 100 times. Mail that arrives during a deploy or a restart is therefore
  delivered when the app returns, where the old direct POST lost it.
- **A message over the 128 KB Queue limit is spilled to R2.** A Cloudflare Queue message is at most 128 KB, and the
  signed body is base64 inside it, so any message whose encoded body would not fit (every message over 128 KB, and
  messages above about 95 KB raw) is written to the R2 bucket `overture-inbound-mail-spill` at
  `spill/{reference}.eml` and the queue carries that pointer. The consumer reads it, and deletes the object only
  after a 2xx. A 30-day lifecycle rule removes objects that never delivered; the dead-letter alert names the key so
  the owner can replay one. The queue and the spool hold the raw MIME unsealed while it is in flight, as any mail
  transport does; both are private to Overture's account, the spool is bounded by the lifecycle rule, and the durable
  copy `mail.ingest` keeps is sealed per user (ADR 0014). A dead-lettered message's body stays in its queue or spool
  until retention or the lifecycle rule removes it; the alert never contains the content.
- **A dead-lettered message raises an alert.** Messages that exhaust their retries move to
  `overture-inbound-mail-dlq`. Its consumer posts a signed `POST /internal/mail/dead-letter` to the app, which raises
  the owner's `mail.dead_letter` alert (`refused`, `spill_missing`, `malformed` or `retries_exhausted`, the attempt
  count, the mailbox and the spill key); the alert is the same in-app notification plus phone push as every other
  alert, and message content is never logged.
- **Delivery is at least once; storage is exactly once.** A lost ack or a retried POST sends the same MIME again, and
  the existing `(mailbox, RFC Message-ID)` check in `mail.ingest` drops the duplicate, so a mailbox never shows a
  message twice. The e2e test runs an outage, a retry, a recovery and a redelivery against the real app and asserts one
  stored message.
- **The cap guard applies to the consumer too (ADR 0033, #280).** A tripped Workers spending limit blocks queue
  consumers exactly as it blocks the Email Worker: the consumer stops, queued mail waits (up to the 14-day retention)
  and is delivered when the limit is lifted or the period resets, and mail that arrives while the Email Worker itself
  cannot run is still lost. There is no non-Worker delivery path that could bypass the limit, and the sentinel's
  degraded flag (#283) only has to keep the app's side cheap, not police this queue.
- `overture-web` verifies DKIM and DMARC itself on the raw message with `mailauth`. That answers ADR 0024's
  objection that the Worker gets no authentication results: Overture no longer depends on the receiver's verdicts.
  Forwarding breaks SPF but leaves the original DKIM signature intact, so `auth='pass'` means the original From
  domain's DKIM passes aligned.
- Ingest, threading, linking and "automate only on `auth='pass'`" are unchanged (SPEC §11.1, ADR 0006). Codes are
  read by deterministic patterns. If no code arrives within five minutes, the user is asked to paste it; the wait and
  the browser session stay open to the ten-minute expiry, so the paste resumes the same attempt.
- No AWS for inbound: no SES receiving, S3 or SNS, and no `mail.sweep`.

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
  completed application against the $0.03 gate (cost as defined in ADR 0026). Kernel's control API exposes no proxy
  volume, so its attempts keep `proxy_bytes` NULL (unknown) instead of a fake 0.

## Catalog

- **Greenhouse fetches content in two modes.** A board's first load, or a poll where more than 5 postings are new
  or changed, fetches `/v1/boards/{token}/jobs?content=true` once. Otherwise the summary list is fetched, plus
  `/jobs/{id}?pay_transparency=true` for the 1–5 changed postings. Application questions are fetched only when a
  posting enters the apply queue, never in a sweep. Measured on production: Stripe's `content=true` list is 779 jobs
  and 6.1 MB, Cloudflare's 496 jobs and 8.9 MB.
- **Sweep claims are small.** At most 20 boards per ATS per sweep (`catalog.sweep_max_boards`), so a batch finishes
  well inside its 15-minute claim. There is no lease heartbeat.
- **Catalog sweeps run in a Bun Worker.** `catalog.sweep` (fetch, parse, tag and the chunked writes of
  `company_boards`, `postings` and `posting_tags`) runs in a Bun Worker with its own SQLite connection (WAL, the same
  `busy_timeout` and #174's `SQLITE_BUSY` retries), and that worker writes only catalog rows. The main thread keeps
  its read-write connection for sign-in, settings, the ledger and dispatch, schedules the sweep, and receives results
  and metrics over `postMessage`. Writes stay chunked (at most 500 rows per transaction) and yield between chunks. A
  crashed worker restarts with backoff, raises the `catalog.worker` alert and never takes the server down; its board
  claim lapses so the next sweep retries it. An architecture rule reports any catalog table write outside the worker
  and the narrow, listed non-sweep paths: dispatch closing a dead posting, preparation marking the question cache,
  tag import, the retag and seed scripts, and the test routes. `catalog.sweep_max_boards` returns to 20 once this
  ships (#175).
- **Feed corrections.** The poll passes each feed's structured workplace to tagging; Ashby uses `workplaceType`,
  never `isRemote`. Lever gets an EU region (`api.eu.lever.co` is a separate board for the same slug), paginates
  with `limit=100&skip=N`, keeps slug case and uses `applyUrl`. Greenhouse has no separate EU API (production probe:
  `boards-api.eu.greenhouse.io` does not resolve, and `boards-api.greenhouse.io` serves `proton`), so only token
  parsing changes for EU board URLs.
- **Discovery after M1.** A weekly job off the production machine (a GitHub Action) merges open board lists into one
  file in Overture's own R2, replacing the runtime dependency on the Stapply bucket. Which lists are used depends on
  their licenses, checked first (below).

## Operating risks we watch

- **Proxy bytes and zombie sessions.** Proxy traffic is most of Browser Use's bill, and closing Playwright does not
  stop billing. Every session is stopped through the API (above), and the recovery sweep stops any session left open.
  The admin view alerts when proxy MB per completed application trends up, so heavy career pages are caught before
  cost passes $0.03.
- **One machine, no failover.** A restart mid-apply must never submit twice. Before `submit_clicked_at` an
  interrupted send is released and retried. After it, the Application goes to Confirming and is never resent
  (ADR 0025, SPEC §9.4). The e2e suite covers a kill at each side of Submit.
- **Large payloads.** Greenhouse `content=true` lists run 3–9 MB, and M2's Workable XML feed is one large file. The
  orchestrator watches `/api/health` latency and process RSS during the backfill. Workable XML is stream-parsed. The
  catalog sweep moved to the Bun Worker described under Catalog after the 2026-11-21 latency regression (#175);
  `/api/health` stayed under 300 ms p99 during a sweep of thousands of postings.
- **Anti-bot drift.** Lever's invisible hCaptcha and Greenhouse and Ashby fraud scoring change over time. Each user
  keeps an isolated Browser Use profile. Selector and pacing changes are driven by measured pass rates per ATS in
  M1 and M2, not by guesses.
- **Users who skip the forwarding filter (M2).** The 10-minute paste fallback (a phone notification, then paste the
  code) has to be quick, so it is designed as a first-class path, not an error screen.
- **Outbound sign-in mail (#90).** Magic links go through Cloudflare Email Sending from
  `no-reply@tryoverture.com`, behind `MailSender`, over its REST API (`fetch`, `CLOUDFLARE_EMAIL_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`). The owner decided on 2026-11-21 that Cloudflare is the one mail provider: inbound already
  runs on Email Routing and the Worker, and SES and Resend are dropped. The service is still in Beta, and Cloudflare's
  terms say Beta Services are "intended for testing purposes only"
  (<https://www.cloudflare.com/terms/>, <https://developers.cloudflare.com/email-service/>, read 2026-11-21); the owner
  accepts that risk for production sign-in. Sending to arbitrary recipients needs the Workers Paid plan (3,000 emails
  a month included, then $0.35 per 1,000) and an onboarded sending domain, which adds bounce MX, SPF and DKIM records on
  `cf-bounce.tryoverture.com` and leaves the Email Routing records on the apex alone. The sink stays the test and
  development adapter, and a half-set pair of Cloudflare names stops the server at boot. Details and quotes:
  `docs/research/cloudflare-email-sending.md`.

## Checked before building (M2 and discovery)

Each claim from the audit was checked against primary sources on 2026-11-20 (#114, full quotes in
`docs/research/m2-ats-verification.md`).

- **Recruitee: confirmed, dropped from M2.** The Careers API needs a per-company token from 2027-02-10
  (<https://docs.recruitee.com/reference/authentication-1>,
  <https://support.recruitee.com/en/articles/12087172-upcoming-changes-to-your-custom-api-integrations>). Pinpoint
  (<https://developers.pinpointhq.com/docs/jobs-json-endpoint>) and then Gem
  (<https://help.gem.com/databases/gem-help-center/the-job-board-api>) are the deferred replacements; both are
  per-company reads with no published limits.
- **SmartRecruiters: confirmed, dropped from M2.** The SAP API Policy forbids AI agents and systematic extraction
  (<https://developers.smartrecruiters.com/docs/the-smartrecruiters-platform>,
  <https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf>). It is revisited only with written
  permission.
- **Workable: the bulk feed is confirmed, and it is large.** One feed covers every customer on Jobs by Workable,
  updated hourly, gzip required (<https://help.workable.com/hc/en-us/articles/4420464031767-Utilizing-the-XML-Job-Feed>).
  It is about 831 MiB uncompressed. It carries a company display name and an apply shortcode, not a board slug, so
  Workable postings are ingested as a feed keyed by `<referencenumber>`, not as `company_boards`. Ingesting an
  831 MiB file on the 2 GB machine every hour is not assumed: M2 decides between a streamed daily pass on the
  machine and an off-box pass that writes only target-relevant postings to R2, measured first. The widget
  rate-limit figure from the audit is unverifiable and moot.
- **Personio: confirmed, with one correction.** The public per-company `/xml?language=en|de` feed needs no
  credentials (<https://developer.personio.de/v1.0/reference/get_xml>). A missing board answers **404**, not a
  redirect; 3xx and 404 are both treated as gone, with German as the fallback when English is empty.
- **Workable synthetic-email detection: confirmed**
  (<https://help.workable.com/hc/en-us/articles/35293126257815-Managing-AI-assisted-and-automated-job-applications>).
  Real email on forms already avoids it.
- **Discovery licences.** ats-scrapers (MIT), freehire (MIT), open-jobs (CC0) and ats-directory (**CC0**, not
  CC-BY) are usable. yc-oss/api (no licence), job-board-aggregator's data (CC BY-NC) and SimplifyJobs (no licence)
  are excluded.

The M2 scope therefore names Workable (feed) and Personio. Whether M2 still promises four ATSes, with Pinpoint and
Gem, or restates its scope is the owner's call.

## Considered Options

- **A generated job-search address on every form (ADR 0005).** It gives a full inbox, but the form email does not
  match the resume, and one shared domain is a single point of blocklisting.
- **Gmail API access.** One-click setup, but restricted-scope review plus a paid annual assessment, or a per-user
  fee through a broker.
- **SES receiving (ADR 0024).** It gives receiver verdicts, but needs AWS credentials, S3, SNS and a sweep. With raw
  MIME and `mailauth`, the verdicts are no longer needed.
- **Switching browser providers before M2.** The owner accepts Browser Use's terms, so the switch buys nothing now.
- **Keep the direct POST from the Email Worker (#286).** Email Routing retries only a Worker that answers non-2xx, an
  app outage can outlast those retries, and nothing recorded what was lost. The Queue adds retries, 14-day retention,
  a dead-letter queue and an alert, on a product the paid plan already covers.
- **Put the whole message in the queue.** Rejected: a Queue message is capped at 128 KB, so oversized mail goes to R2
  and the queue carries a pointer.
