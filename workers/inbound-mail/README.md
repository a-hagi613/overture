# Inbound mail Worker

The Cloudflare Email Worker that receives the `tryoverture.com` catch-all and hands accepted mail to
`overture-web` (`POST /internal/mail/inbound`, SPEC §11.1, ADR 0028), through a Queue.

It accepts an apex alias (`<handle>@<ALIAS_EMAIL_DOMAIN>`, ADR 0040). A reserved system local part
(`hello@`, `support@`, …) and the retired `in-{id}-{mac}@tryoverture.com` forwarding address are
dropped silently. The Worker does not resolve the mailbox itself: the app resolves the envelope
recipient to exactly one active alias and drops a retired or unknown one.

**The Worker never sends mail.** It has no `send_email` binding and no forwarding destination, so
there is no shared or owner fallback anywhere (issue #693). `message.forward()` is never used either:
Cloudflare caps it at 200 verified destinations per account. Accepted mail is enqueued on
`overture-inbound-mail` as the raw MIME with its envelope; a queue consumer signs it with
`signInbound` under `INBOUND_HMAC_SECRET` and POSTs it to the app. The app stores it in that one
person's Inbox and sends a copy to that person's current verified login email. Messages over
`INBOUND_MAX_BYTES` (25 MiB) are dropped. No LLM runs here and message content is never logged.

## The queue

| Setting | Value | Where |
|---|---|---|
| Queue | `overture-inbound-mail` | `wrangler.jsonc` (`INBOUND_QUEUE`), `src/shared/inbound-queue.ts` |
| Dead-letter queue | `overture-inbound-mail-dlq` | `wrangler.jsonc` |
| Retries per message | 100 | `wrangler.jsonc` (`max_retries`) |
| Retry delay | 5 minutes | `wrangler.jsonc` (`retry_delay`) |
| Retention | 14 days | the queue itself (`bunx wrangler queues create --message-retention-period 1209600`) |
| Spill bucket | `overture-inbound-mail-spill` | `wrangler.jsonc` (`INBOUND_SPILL`), objects under `spill/` |

A 2xx from `POST /internal/mail/inbound` acks the message and deletes its spilled object. A network
error, `5xx`, `408`, `425` or `429` retries it. Any other refusal is dead-lettered at once. The
message that exhausts its retries lands in the dead-letter queue; its consumer POSTs a signed
`POST /internal/mail/dead-letter`, which raises the owner's `mail.dead_letter` alert. Redelivery is
at least once, and `mail.ingest` keeps storage exactly once by deduplicating on RFC Message-ID (or a
content hash when the sender left it out).

A Queue message is capped at 128 KB and carries the body as base64, so any message whose encoded
body does not fit — every message over 128 KB, and anything above about 95 KB raw — is written to R2
first and the queue carries `{ kind: "spill", spillKey }`. The object is deleted only after a 2xx. A
30-day lifecycle rule on the bucket removes objects that never delivered; the dead-letter alert names
the key so the owner can replay one.

## Email Routing

In the Cloudflare dashboard for the `tryoverture.com` zone, open **Email Routing → Routes**:

- The catch-all route sends to this Worker (`overture-inbound-mail`).
- Keep the literal routes such as `hello@tryoverture.com` forwarding to the owner as they are.
- The aliases live on the apex, `<handle>@tryoverture.com`. The apex alias domain is `ALIAS_EMAIL_DOMAIN`
  (default `tryoverture.com`); the app provisions `<handle>@tryoverture.com` at signup.

## Configuration

Secrets are set with `wrangler secret put` and are never committed:

| Name | Kind | Value |
|---|---|---|
| `INBOUND_HMAC_SECRET` | Worker secret | The same value as `overture-web` uses to verify inbound requests |
| `OVERTURE_ORIGIN` | Worker variable | `https://tryoverture.com` (in `wrangler.jsonc`) |
| `ALIAS_EMAIL_DOMAIN` | Worker variable | `tryoverture.com` (in `wrangler.jsonc`) |
| `INBOUND_QUEUE` | Queue producer | `overture-inbound-mail` (in `wrangler.jsonc`) |
| `INBOUND_SPILL` | R2 binding | `overture-inbound-mail-spill` (in `wrangler.jsonc`) |

## Commands

```sh
cd workers/inbound-mail
bunx wrangler queues create overture-inbound-mail --message-retention-period 1209600
bunx wrangler queues create overture-inbound-mail-dlq --message-retention-period 1209600
bunx wrangler r2 bucket create overture-inbound-mail-spill
bunx wrangler secret put INBOUND_HMAC_SECRET
bunx wrangler deploy
bunx wrangler queues info overture-inbound-mail
```

Add an R2 lifecycle rule on `overture-inbound-mail-spill` that deletes objects under `spill/` after 30
days. `bunx wrangler deploy --dry-run` builds the Worker without deploying it; CI runs that on every
build.

## Observability

- Cloudflare Queue metrics per queue: backlog, oldest message age, retries and dead letters
  (`bunx wrangler queues info overture-inbound-mail`). A growing backlog while the app is up means the
  consumer cannot reach it; see the delivery status in the app's Inbox.
- Workers Logs (`observability.enabled` in `wrangler.jsonc`) record every invocation and its exceptions.
  Nothing in this Worker writes message content to a log.
- R2 metrics on `overture-inbound-mail-spill` show the `spill/` objects, and the 30-day lifecycle rule
  bounds them.
- The app's Inbox and its `mail.ingest` jobs show delivered mail per mailbox, and each Message's
  `mail_deliveries` row shows whether its copy was sent, bounced, skipped or failed. The
  `mail.dead_letter` alert carries the reason, the attempt count, the mailbox id and the spill key, and
  reaches the in-app notification list plus the owner's phone through `ALERT_NTFY_URL` when it is set.

## Tests

`test/e2e/inbound-mail-worker.test.ts` runs the Worker's `email` and `queue` handlers against the
recorded `.eml` fixtures in `test/e2e/fixtures/inbound-mail/`, with a fake Queue, a fake R2 bucket and
a local server that verifies every request with `verifyInbound`. It covers the retired forwarding address,
apex aliases, reserved addresses, the queue spill path and a static check that no Worker source sends
mail or calls `message.forward()`.
`test/e2e/inbound-mail-queue.test.ts` runs the consumer against the real app: an outage, a retry, a
recovery and a redelivery store the message exactly once, a message over 128 KB spills and is deleted
after delivery, and a dead-lettered message raises the owner's alert. Neither needs a Cloudflare
account.
