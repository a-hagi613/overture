---
status: accepted (inbound path replaced by ADR 0024)
---

# A generated job-search address per user; the personal mailbox is never connected

Each user gets `first.last@mail.tryoverture.com`, a subdomain of the one brand domain with its own SES identity, SPF, DKIM and DMARC at reject. It is the email typed on every application form, so codes and replies reach Overture. Inbound is received by Amazon SES (ADR 0024); outbound replies go through Amazon SES, only in threads the employer started, at most 20 a day. Every message is kept, encrypted. Addresses are never reused.

## Considered Options

- Connecting the user's Gmail or Outlook: reading a person's inbox is unacceptable, and Google's restricted-scope review costs money and weeks.
- A per-user alias forwarding to the personal inbox, or an IMAP app password: suspicious to employers, or hacky with real friction.
- A second, neutral mail domain: extra spend for a side project; the subdomain only sends replies, so reputation coupling is low.
