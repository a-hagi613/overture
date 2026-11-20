# Inbound mail Worker

The Cloudflare Email Worker that receives the `tryoverture.com` catch-all and hands ATS mail to
`overture-web` (`POST /internal/mail/inbound`, SPEC §11.1, ADR 0028).

It takes the forwarding id from the recipient with `forwardingIdFrom` (`src/shared/inbound-mail.ts`).
An unknown or forged address is dropped silently. Gmail and Outlook forwarding-confirmation messages
are forwarded to the owner's verified destination. Any other message whose original From domain is
not in `src/shared/ats-mail-domains.ts` is dropped. Accepted mail is POSTed as raw MIME with the
envelope headers in `INBOUND_HEADERS`, signed with `signInbound` under `INBOUND_HMAC_SECRET`.
Messages over `INBOUND_MAX_BYTES` are dropped, and a non-2xx answer throws so Email Routing retries.
No LLM runs here and message content is never logged.

## Email Routing

In the Cloudflare dashboard for the `tryoverture.com` zone, open **Email Routing → Routes**:

- The catch-all route sends to this Worker (`overture-inbound-mail`).
- Keep the literal routes such as `hello@tryoverture.com` forwarding to the owner as they are.
- The forwarding addresses live on the apex, `in-{id}-{mac}@tryoverture.com`.

## Configuration

Secrets are set with `wrangler secret put` and are never committed:

| Name | Kind | Value |
|---|---|---|
| `INBOUND_HMAC_SECRET` | Worker secret | The same value as `overture-web` uses to verify inbound requests |
| `OVERTURE_ORIGIN` | Worker variable | `https://tryoverture.com` (in `wrangler.jsonc`) |
| `OWNER_FORWARD_TO` | Worker variable | The owner's verified destination for forwarding confirmations |

## Commands

```sh
cd workers/inbound-mail
bunx wrangler secret put INBOUND_HMAC_SECRET
bunx wrangler deploy --var OWNER_FORWARD_TO:<owner-verified-address>
```

`bunx wrangler deploy --dry-run` builds the Worker without deploying it; CI runs that on every build.

## Tests

The e2e test in `test/e2e/inbound-mail-worker.test.ts` runs the Worker's `email` handler against the
recorded `.eml` fixtures in `test/e2e/fixtures/inbound-mail/` and POSTs to a local Bun server that
verifies each request with `verifyInbound`. It needs no Cloudflare account.
