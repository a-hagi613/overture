# Inbound mail Worker

The Cloudflare Email Worker that receives the `tryoverture.com` catch-all and hands ATS mail to
`overture-web` (`POST /internal/mail/inbound`, SPEC §11.1, ADR 0028), through a Queue.

It accepts a managed forwarding address (`in-{id}-{mac}@tryoverture.com`, checked with `forwardingIdFrom` in
`src/shared/inbound-mail.ts`) and an apex alias (`<handle>@<ALIAS_EMAIL_DOMAIN>`, WS-5b). A reserved system local part
(`hello@`, `support@`, …) and a forged `in-` address are dropped silently. A managed address keeps the ATS-sender
filter; an alias enqueues every message and copies ATS mail and threaded employer replies to `OWNER_FORWARD_TO` through
the `send_email` binding (`INBOUND_EMAIL`). The copy leaves from `FORWARD_FROM`
(`notify@notify.tryoverture.com`), puts the original sender in `Reply-To`, and carries only allow-listed headers
(`In-Reply-To`, `References`, `Thread-Index`, `Thread-Topic` and `X-*`, at most 20 named headers and 16 KB in total).
A copy over 4 MiB keeps its attachments in encrypted R2 under `mail-attachments/` and links to the Inbox instead.
Gmail and Outlook forwarding confirmations also go to the owner this way. `message.forward()` is never used: Cloudflare
caps it at 200 verified destinations per account. Accepted mail is enqueued on `overture-inbound-mail` as the raw
MIME with its envelope; a queue consumer signs it with `signInbound` under `INBOUND_HMAC_SECRET` and POSTs it to the
app. Messages over `INBOUND_MAX_BYTES` (25 MiB) are dropped. No LLM runs here and message content is never logged.

## Forwarding copies

The Worker never calls `message.forward()`. It builds a clean copy with the structured `send_email` API and sends it to
`OWNER_FORWARD_TO`:

- `From` is `FORWARD_FROM`; `Reply-To` is the original sender so a reply goes back to the employer or recruiter.
- Only `In-Reply-To`, `References`, `Thread-Index`, `Thread-Topic` and `X-*` headers are copied. `From`, `To`, `Date`,
  `Message-ID`, `MIME-Version`, `Content-*` and every other inbound header are dropped, because Email Sending rejects
  anything outside its allow-list (at most 20 named headers, 2 KB per value and 16 KB in total).
- The body is the original `text/plain`. An HTML-only message carries a short placeholder and a link to the Inbox,
  where the HTML is stored; the copy never renders inbound HTML.
- A copy whose attachments would push it over 4 MiB (the 5 MiB `send_email` cap leaves headroom) is sent without them,
  and one with more than 32 attachments sends the first 32 and links to the rest in the Inbox. Attachments removed by
  the 4 MiB guard are written to `INBOUND_SPILL` under `mail-attachments/{reference}/` (R2 encrypts objects at rest)
  and the copy lists their names, sizes and a link to the authenticated Inbox. The same 30-day lifecycle rule that
  covers `spill/` should cover `mail-attachments/`.

A failed send throws after the queue message is enqueued, so Email Routing retries and the app deduplicates by RFC
Message-ID. The queue delivery itself is never delayed behind a send. The app resolves a managed address today; a
readable alias resolves in the Inbox once WS-5b provisions it there, while the forwarded copy does not depend on that.

## The queue

| Setting | Value | Where |
|---|---|---|
| Queue | `overture-inbound-mail` | `wrangler.jsonc` (`INBOUND_QUEUE`), `src/shared/inbound-queue.ts` |
| Dead-letter queue | `overture-inbound-mail-dlq` | `wrangler.jsonc` |
| Retries per message | 100 | `wrangler.jsonc` (`max_retries`) |
| Retry delay | 5 minutes | `wrangler.jsonc` (`retry_delay`) |
| Retention | 14 days | the queue itself (`wrangler queues create --message-retention-period 1209600`) |
| Spill bucket | `overture-inbound-mail-spill` | `wrangler.jsonc` (`INBOUND_SPILL`), objects under `spill/` and `mail-attachments/` |

A 2xx from `POST /internal/mail/inbound` acks the message and deletes its spilled object. A network
error, `5xx`, `408`, `425` or `429` retries it. Any other refusal is dead-lettered at once. The
message that exhausts its retries lands in the dead-letter queue; its consumer POSTs a signed
`POST /internal/mail/dead-letter`, which raises the owner's `mail.dead_letter` alert. Redelivery is
at least once, and `mail.ingest` keeps storage exactly once by deduplicating on RFC Message-ID.

A Queue message is capped at 128 KB and carries the body as base64, so any message whose encoded
body does not fit — every message over 128 KB, and anything above about 95 KB raw — is written to R2
first and the queue carries `{ kind: "spill", spillKey }`. The object is deleted only after a 2xx. A
30-day lifecycle rule on the bucket removes objects that never delivered; the dead-letter alert names
the key so the owner can replay one.

## Email Routing

In the Cloudflare dashboard for the `tryoverture.com` zone, open **Email Routing → Routes**:

- The catch-all route sends to this Worker (`overture-inbound-mail`).
- Keep the literal routes such as `hello@tryoverture.com` forwarding to the owner as they are.
- The managed forwarding addresses live on the apex, `in-{id}-{mac}@tryoverture.com`. The apex alias domain is
  `ALIAS_EMAIL_DOMAIN` (default `tryoverture.com`); WS-5b provisions `<handle>@tryoverture.com` there.

## Configuration

Secrets are set with `wrangler secret put` and are never committed:

| Name | Kind | Value |
|---|---|---|
| `INBOUND_HMAC_SECRET` | Worker secret | The same value as `overture-web` uses to verify inbound requests |
| `OVERTURE_ORIGIN` | Worker variable | `https://tryoverture.com` (in `wrangler.jsonc`) |
| `OWNER_FORWARD_TO` | Worker variable | The owner's verified destination for forwarding copies |
| `ALIAS_EMAIL_DOMAIN` | Worker variable | `tryoverture.com` (in `wrangler.jsonc`) |
| `FORWARD_FROM` | Worker variable | `notify@notify.tryoverture.com` (in `wrangler.jsonc`) |
| `INBOUND_QUEUE` | Queue producer | `overture-inbound-mail` (in `wrangler.jsonc`) |
| `INBOUND_SPILL` | R2 binding | `overture-inbound-mail-spill` (in `wrangler.jsonc`) |
| `INBOUND_EMAIL` | `send_email` binding | Email Sending, from the onboarded `notify.tryoverture.com` domain; the binding allows only `notify@notify.tryoverture.com` as sender |

## Commands

```sh
cd workers/inbound-mail
bunx wrangler queues create overture-inbound-mail --message-retention-period 1209600
bunx wrangler queues create overture-inbound-mail-dlq --message-retention-period 1209600
bunx wrangler r2 bucket create overture-inbound-mail-spill
bunx wrangler secret put INBOUND_HMAC_SECRET
bunx wrangler deploy --var OWNER_FORWARD_TO:<owner-verified-address>
bunx wrangler queues info overture-inbound-mail
```

Add an R2 lifecycle rule on `overture-inbound-mail-spill` that deletes objects under `spill/` and `mail-attachments/`
after 30 days. `bunx wrangler deploy --dry-run` builds the Worker without deploying it; CI runs that on every build.

The `send_email` binding only sends from an onboarded sending domain: run
`scripts/onboard-email-sending.ts` (docs/DEPLOY.md, M2-02) for `notify.tryoverture.com` before deploying the binding.
Copy recipients are the owner's verified destination, so the copies stay inside Cloudflare's verified-address allowance.

## Observability

- Cloudflare Queue metrics per queue: backlog, oldest message age, retries and dead letters
  (`bunx wrangler queues info overture-inbound-mail`). A growing backlog while the app is up means the
  consumer cannot reach it; see the delivery status in the app's Inbox.
- Workers Logs (`observability.enabled` in `wrangler.jsonc`) record every invocation and its exceptions.
  Nothing in this Worker writes message content to a log.
- Email Sending metrics and logs in the Cloudflare dashboard cover the forwarding copies. A failed
  `send_email` rejects the invocation with `The inbound forward failed.` and the provider error as its
  cause, beside the Queue retry that follows.
- R2 metrics on `overture-inbound-mail-spill` show the `spill/` and `mail-attachments/` objects, and the
  30-day lifecycle rule bounds both. A copy that cannot be sent leaves the queue message intact, so the
  Inbox still receives the mail.
- The app's Inbox and its `mail.ingest` jobs show delivered mail per mailbox; the `mail.dead_letter` alert
  carries the reason, the attempt count, the mailbox id and the spill key, and reaches the in-app
  notification list plus the owner's phone through `ALERT_NTFY_URL` when it is set.
- The spend-guard runbook (`docs/research/cloudflare-spend-guard-runbook.md` §5) covers the trip where
  the Workers limit stops both the Email Worker and this consumer.

## Tests

`test/e2e/inbound-mail-worker.test.ts` runs the Worker's `email` and `queue` handlers against the
recorded `.eml` fixtures in `test/e2e/fixtures/inbound-mail/`, with a fake Queue, a fake R2 bucket, a fake
`send_email` binding and a local server that verifies every request with `verifyInbound`. It covers the managed-address
filter, apex aliases, the `send_email` copy with its `Reply-To` and allow-listed headers, the 4 MiB attachment spill,
and a static check that no Worker source calls `message.forward()`.
`test/e2e/inbound-mail-queue.test.ts` runs the consumer against the real app: an outage, a retry, a
recovery and a redelivery store the message exactly once, a message over 128 KB spills and is deleted
after delivery, and a dead-lettered message raises the owner's alert. Neither needs a Cloudflare
account.
