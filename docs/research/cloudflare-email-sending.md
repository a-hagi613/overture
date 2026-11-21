# Cloudflare Email Sending, checked for Overture (#90)

Checked on **2026-11-21** against Cloudflare's own documentation and terms, plus Cloudflare's API reference for the send
endpoint. Desk research only: no account was used, no API call was made, no email was sent. Quotes are verbatim from the
pages read that day; each page's own "updated" date is given where the docs show one.

The owner decided on 2026-11-21 that Overture uses Cloudflare for all mail: inbound already runs on Email Routing and
the Email Worker (ADR 0028), and outbound moves from the SES adapter to Cloudflare Email Sending, accepting that
Email Sending is still labelled Beta. This note records what the service actually offers and what the build must do.

## Verdicts at a glance

| Question | Answer |
|---|---|
| Can it send to any recipient? | **Yes, once a sending domain is onboarded.** Before that, only the account's verified destination addresses. |
| REST API from a Fly server? | **Yes.** `POST /accounts/{account_id}/email/sending/send` from any backend; a Worker binding is one option, not a requirement. SMTP also exists. |
| Authentication | **Cloudflare API token**, `Authorization: Bearer …`, permission **Email Sending Write** (the dashboard calls it "Email Sending: Edit"), plus the account id in the path. |
| Published send rate limit | **No numeric rate is published.** A conservative per-account daily quota scales with reputation; the API answers `429` with `email.sending.error.throttled`. |
| DNS records | SPF, DKIM and bounce MX on the `cf-bounce` subdomain; DMARC on `_dmarc`; separate from the Email Routing records on the apex. |
| Price | Workers Paid only for arbitrary recipients: **3,000 emails a month included, then $0.35 per 1,000**; the Workers Paid minimum is $5 a month. |
| Beta | **Still Beta on 2026-11-21**, and Cloudflare's terms say Beta Services are "intended for testing purposes only". |
| Use for Overture | **REST from `overture-web`**, `fetch`, no SDK, plain-text body. The owner accepts the Beta risk. |

## 1. Any recipient, not only verified addresses

**Verdict: yes, after onboarding a sending domain.**

<https://developers.cloudflare.com/email-service/platform/limits/> (page updated 2026-10-30, read 2026-11-21):

> Before you onboard a sending domain, you can send emails only to [verified destination addresses]
> in your account. After you onboard a sending domain, you can send to any recipient immediately.

The pricing page says the same with the plan attached: "Sending to arbitrary recipients requires the Workers Paid
plan. Sending to verified destination addresses in your account is free on all plans" and "Outbound emails (Email
Sending)" is "Not available" on Workers Free (<https://developers.cloudflare.com/email-service/platform/pricing/>, page
updated 2026-06-09). The landing page repeats it: "**Email Sending** Beta sends outbound transactional emails. Available
on Workers Paid plan" (<https://developers.cloudflare.com/email-service/>, page updated 2026-10-15).

Sends to verified destination addresses "are always free: they do not count toward your monthly quota or your daily
sending limits, on any plan" (limits page). The FAQ adds the scope: "Email Service supports transactional email only"
(<https://developers.cloudflare.com/email-service/reference/faq/>, updated 2026-10-15).

**For Overture:** magic links go to the user's own address, which is arbitrary, so the account must be on Workers Paid
and `tryoverture.com` must be onboarded for Email Sending. That is different from the SES sandbox constraint: there is
no per-recipient verification once the domain is onboarded.

## 2. REST API from a Fly server, not only a Worker binding

**Verdict: a REST API exists and is documented for use outside Workers.**

<https://developers.cloudflare.com/email-service/api/send-emails/rest-api/> (page updated 2026-11-17):

> The REST API allows you to send emails from any application using a standard HTTP request to
> `POST /accounts/{account_id}/email/sending/send`. Use it from any backend, serverless function, or CI/CD pipeline —
> no Cloudflare Workers binding is required.

The get-started page gives the full URL and a `curl` example
(<https://developers.cloudflare.com/email-service/get-started/send-emails/>, updated 2026-06-25):

```bash
curl "https://api.cloudflare.com/client/v4/accounts/{account_id}/email/sending/send" \
  --header "Authorization: Bearer <API_TOKEN>" \
  --header "Content-Type: application/json" \
  --data '{
    "to": "recipient@example.com",
    "from": "welcome@yourdomain.com",
    "subject": "Welcome to our service!",
    "html": "<h1>Welcome!</h1><p>Thanks for signing up.</p>",
    "text": "Welcome! Thanks for signing up."
  }'
```

The request schema comes from Cloudflare's API reference
(<https://developers.cloudflare.com/api/resources/email_sending/methods/send/>, read 2026-11-21): "Provide the sender,
recipients, subject, and at least one of `text` or `html`; attachments are optional." The reference example sends `to`,
`bcc` and `cc` as arrays of strings, and supports `headers`, `reply_to` and base64 `attachments`. The get-started page
also accepts a plain string for `to`.

A successful response carries a message id and per-recipient status:

```json
{
  "success": true,
  "errors": [],
  "messages": [],
  "result": {
    "message_id": "<aB3xK9mP2qR5sT8uV0wX1yZ4cD6fG7hJ9kL0@example.com>",
    "delivered": ["recipient@example.com"],
    "permanent_bounces": [],
    "queued": [],
    "suppressed_recipients": []
  }
}
```

Suppression is off by default per sending domain. With **Drop suppressed recipients** off, "a message containing any
suppressed recipient fails. The REST API returns `400`", and with it on the API reports those addresses in
`suppressed_recipients` (<https://developers.cloudflare.com/email-service/configuration/domains/#drop-suppressed-recipients>,
updated 2026-11-17).

SMTP is a third option on `smtps://smtp.mx.cloudflare.net:465` authenticated with the API token
(<https://developers.cloudflare.com/email-service/api/send-emails/smtp/>), but `fetch` to the REST endpoint is the
smallest dependency for `overture-web`.

**For Overture:** `overture-web` calls the REST endpoint with `fetch`, as the SES adapter did with its own signed
request. No Cloudflare SDK and no change to the inbound Worker are needed.

## 3. Authentication and token scope

**Verdict: one API token with `Email Sending Write`, plus the account id in the path.**

The REST page shows `Authorization: Bearer <API_TOKEN>` and links the token guide. The API token documentation for the
dashboard names the permission **Email Sending: Edit** (get-started page), and the API reference lists the accepted
permission as **`Email Sending Write`** — the same permission under its API name. The account id is part of the URL,
so Overture needs `CLOUDFLARE_EMAIL_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

There is no SigV4-style request signing, no configuration set and no bounces webhook requirement in the send path. The
error table on the REST page covers the failure modes Overture can see: `401` for a missing or invalid token, `403`
for a token without the permission or an account not entitled, `403` when "Sending disabled for this zone or account",
`429` for throttling and `500`/`503` for Cloudflare's side.

## 4. Rate limits and message limits

**Verdict: no published numeric send rate; a per-account daily quota that starts conservative.**

The limits page is explicit about volume:

> New accounts start with a conservative daily quota and scale up over time based on your sending behavior,
> deliverability rates, and account standing.

The FAQ adds: "Email Service may queue or reject emails that exceed sending limits. Error responses include rate-limit
information." The documented failure code is `429` `email.sending.error.throttled`. Only the suppression-list bulk
import has a published numeric limit (10 requests a minute), which does not apply to sending.

The fixed message limits are published:

| Component | Limit |
|---|---|
| Recipients (`to`, `cc`, `bcc`) | 50 per email, combined |
| Subject line | 998 characters |
| Total message size | 25 MiB including attachments |
| Header size | 16 KB of custom headers |
| Sending domains per zone | 30, combined with Email Routing |

Overture sends one recipient, one short subject and a plain-text body, so none of these bind today.

## 5. Domain onboarding and DNS records

**Verdict: `tryoverture.com` can be onboarded for sending without disturbing inbound mail, but it adds new records on
`cf-bounce` and possibly a DMARC record.**

The service requires Cloudflare DNS: "You must be using Cloudflare DNS to use Email Service"
(get-started page). `tryoverture.com` already is.

<https://developers.cloudflare.com/email-service/configuration/domains/> (updated 2026-11-17) lists what onboarding a
domain for **sending** creates on the `cf-bounce` subdomain, separate from the Email Routing records on the apex:

| Type | Name | Value (shape) |
|---|---|---|
| MX | `cf-bounce.tryoverture.com` | `route1.mx.cloudflare.net`, `route2…`, `route3…` (priority assigned by Cloudflare) |
| TXT | `cf-bounce.tryoverture.com` | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| TXT | `cf-bounce._domainkey.tryoverture.com` | `v=DKIM1; h=sha256; k=rsa; p=…` |
| TXT | `_dmarc.tryoverture.com` | `v=DMARC1; p=reject;` — added only when no DMARC record exists |

The authentication page confirms the split: Email Sending uses `cf-bounce._domainkey` for DKIM and
`cf-bounce.tryoverture.com` for SPF, while Email Routing uses `cf2024-1._domainkey` on the apex; "Cloudflare
automatically generates and manages DKIM keys"
(<https://developers.cloudflare.com/email-service/concepts/email-authentication/>, updated 2026-11-17). DNS changes
"can take up to 24 hours to propagate globally, but usually complete within 5-15 minutes for domains using Cloudflare
DNS" (domains page).

Cloudflare adds a `p=reject` DMARC record only when the domain has none, and "If a DMARC record already exists,
Cloudflare keeps it unchanged". Overture already intends `p=reject` with a reporting address (SPEC §3.3), so the
existing record stays.

Sending records on `cf-bounce` are locked for the life of the domain configuration; only Email Routing records on the
apex support unlocking (domains page). Removing the domain from Email Sending deletes the `cf-bounce` MX, SPF, DKIM and
the DMARC record Cloudflare added.

**For Overture:** adding sending does not touch the apex MX, the apex SPF include or the `cf2024-1` DKIM record that
Email Routing and the inbound Worker depend on. The orchestrator's DNS work is the `cf-bounce` set plus, if the apex
record is missing, one DMARC record.

## 6. Pricing

**Verdict: 3,000 included emails a month on Workers Paid, then $0.35 per 1,000.**

<https://developers.cloudflare.com/email-service/platform/pricing/> (updated 2026-06-09):

|  | Workers Free | Workers Paid |
|---|---|---|
| Outbound emails (Email Sending) | Not available | 3,000 included per month, then $0.35 per 1,000 emails |
| Inbound emails (Email Routing) | Unlimited | Unlimited |

"The 3,000 included emails apply per account, per month, aligned with your Cloudflare subscription billing cycle.
Emails that hard-bounce or are otherwise accepted by Email Service count toward the quota. Emails rejected at the API
boundary, including sends blocked by the suppression list, do not count toward the quota." Sends to verified
destination addresses are free and outside the quota.

$5 is the Workers Paid minimum, not a mail-only plan: the Workers pricing page describes it as the minimum monthly
charge for Workers, Pages Functions, Workers KV, Hyperdrive and Durable Objects
(<https://developers.cloudflare.com/workers/platform/pricing/>). Overture's inbound Email Worker already puts the
account on a Cloudflare plan, and the catalog/discovery work uses R2, so the marginal mail cost is the per-email rate
after 3,000.

**For Overture:** sign-in magic links, live-check mail and later "ready to send" notices are far below 3,000 a month
in M1/M2. The mail-only price is not $5; the quota is part of an account that pays for Workers anyway.

## 7. Beta status and terms

**Verdict: still Beta, and the terms still say testing only. This is the risk the owner accepted on 2026-11-21.**

The landing page calls it "**Email Sending** Beta" (updated 2026-10-15), and the 2026-11-20 research note recorded the
same label. Cloudflare's Self-Serve Subscription Agreement (<https://www.cloudflare.com/terms/>, last updated
2025-09-12, read 2026-11-21), §5 Beta Services:

> Beta Services are intended for testing purposes only … We may discontinue, suspend, or remove Beta Services …
> at any time in our sole discretion and may never make them generally available … we will have no liability for any
> harm or damage arising out of or in connection with any Beta Services.

The docs also do not promise support for Beta: "Cloudflare is not obligated to provide you with support for the Beta
Services or correct any bugs, defects, or errors".

**For Overture:** the failure mode to design for is that sign-in mail stops, not that it is billed wrongly. The
in-memory sink stays behind `MailSender`, and a provider swap remains a one-file change. The owner has accepted the
Beta terms for production sign-in as of 2026-11-21; the decision is recorded in ADR 0028.

## 8. What the build does with this

- `CloudflareMailSender` sits behind the existing `MailSender` port in `overture-web` and sends plain text with
  `fetch` to `POST {CLOUDFLARE_EMAIL_API_BASE_URL}/accounts/{CLOUDFLARE_ACCOUNT_ID}/email/sending/send`.
- It is selected only when both `CLOUDFLARE_EMAIL_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set; otherwise the sink is
  used. A half-set pair stops the server at boot, and the deploy gate names the same pair once
  `REQUIRE_CLOUDFLARE_EMAIL_SECRETS` is set.
- The From address stays `no-reply@tryoverture.com` (`MAIL_FROM`). No HTML body is sent: magic-link copy is plain text.
- Tests run the real adapter against MSW, which intercepts the send endpoint and asserts method, URL, bearer token and
  body; no request reaches Cloudflare (ADR 0013).

## 9. Sending-domain onboarding and the guards (#211)

The sending domain is managed by a different, **zone-scoped** API from the send endpoint:

| Operation | Endpoint | Permission |
|---|---|---|
| List sending subdomains | `GET /zones/{zone_id}/email/sending/subdomains` | `Email Sending Write` or `Email Sending Read` |
| Create or re-enable one | `POST /zones/{zone_id}/email/sending/subdomains` with `{"name": "tryoverture.com"}` | `Email Sending Write` |
| Read its expected records | `GET /zones/{zone_id}/email/sending/subdomains/{tag}/dns` | `Email Sending Write` or `Email Sending Read` |

So the operator needs `CLOUDFLARE_ZONE_ID` in addition to the account id and token. If it is unset, the script tries
`GET /zones?name=tryoverture.com`, which also needs **Zone: Read**; setting the zone id avoids that permission. The
create response carries `enabled`, `dkim_selector` and `return_path_domain`; the DNS response carries the expected MX,
SPF, DKIM and DMARC records (shapes in `test/e2e/recordings/cloudflare-email/`).

`scripts/onboard-email-sending.ts` lists first, creates only when the subdomain is absent or disabled, and reads the
records back; a second run reports `action: none`. `--dry-run` sends no write request, and `--check` is read-only. The
DMARC record is required to exist with `p=reject`; Cloudflare adds one only when the zone has none, so Overture's
existing `p=reject; rua=…` record is kept.

The deploy workflow runs `--check` on the running release before deploying, and the daily `mail.sending` check runs the
same readiness read in-process. Both are gated by `REQUIRE_EMAIL_SENDING`: while it is unset they warn or record
`status: "gated"` and the deploy continues; once the owner sets it they refuse the deploy or alert the owner. The
fixtures beside the test are the response examples published in Cloudflare's API reference (read 2026-11-21): there is
no paid account to record the endpoints live until M2 owner setup (#236) turns the plan on, after which the owner can
refresh them.


## Sources

| Page | Updated | Read |
|---|---|---|
| <https://developers.cloudflare.com/email-service/> | 2026-10-15 | 2026-11-21 |
| <https://developers.cloudflare.com/email-service/get-started/send-emails/> | 2026-06-25 | 2026-11-21 |
| <https://developers.cloudflare.com/email-service/api/send-emails/rest-api/> | 2026-11-17 | 2026-11-21 |
| <https://developers.cloudflare.com/api/resources/email_sending/methods/send/> | — | 2026-11-21 |
| <https://developers.cloudflare.com/email-service/api/send-emails/smtp/> | — | 2026-11-21 |
| <https://developers.cloudflare.com/email-service/concepts/email-authentication/> | 2026-11-17 | 2026-11-21 |
| <https://developers.cloudflare.com/email-service/configuration/domains/> | 2026-11-17 | 2026-11-21 |
| <https://developers.cloudflare.com/email-service/platform/limits/> | 2026-10-30 | 2026-11-21 |
| <https://developers.cloudflare.com/email-service/platform/pricing/> | 2026-06-09 | 2026-11-21 |
| <https://developers.cloudflare.com/email-service/reference/faq/> | 2026-10-15 | 2026-11-21 |
| <https://www.cloudflare.com/terms/> | 2025-09-12 | 2026-11-21 |
