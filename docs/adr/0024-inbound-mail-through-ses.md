---
status: accepted
---

# Inbound mail arrives through Amazon SES receiving

Mail for `mail.tryoverture.com` is received by Amazon SES in ca-central-1: the subdomain's MX points at
`inbound-smtp.ca-central-1.amazonaws.com`, and one receipt rule whose recipient is the whole subdomain stores the raw
message in an S3 bucket and publishes an SNS notification to `overture-web`. The notification carries SES's SPF, DKIM
and DMARC verdicts, which decide `auth`. The raw message is deleted from S3 once it is encrypted into R2. Mail to an
unknown or closed address is discarded at ingest, because SES cannot look addresses up before accepting them. This
replaces the Cloudflare Email Routing and Worker path in ADR 0005. The apex domain keeps Cloudflare Email Routing for
`hello@`.

## Considered Options

- Cloudflare Email Routing with a catch-all to a Worker: catch-all rules work only on the apex domain, the Worker does
  not receive authentication results, and Cloudflare rejects some failing mail before the Worker sees it.
- Cloudflare with one literal rule per mailbox, created by API: works, but stops at 200 rules per domain and still
  gives no authentication results.
