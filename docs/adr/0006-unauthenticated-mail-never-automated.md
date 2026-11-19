---
status: accepted
---

# Mail that fails SPF/DKIM/DMARC is kept but never automated

Inbound mail is never dropped, because almost anything sent to a job-search address is about an application. Mail that fails authentication is stored and shown with "Couldn't verify sender", but it is never used to read a verification code or to move a card between Stages.

## Considered Options

- Dropping failed or spam-like mail: loses real employer replies.
