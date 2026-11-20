---
status: accepted
---

# "Submitted" is decided by the employer's server, not by the click

Refines ADR 0009. The executor watches the network request each ATS flow names as its application request.
`submit_clicked_at` is set only when that request may have been accepted: a 2xx answer, a 5xx, a timeout or a lost
connection. A 4xx answer (for example Greenhouse's 428 `captcha-failed`, which asks for an emailed code and a second
Submit) means nothing was submitted, so the try stays before Submit and may be retried. A flow that cannot observe its
application request treats the click itself as submitted, which is the safe side. ADR 0009's rule is unchanged: after
`submit_clicked_at`, never retry.

## Considered Options

- The click as the dividing line (ADR 0009 as first written): on Greenhouse's low-reCAPTCHA-score path every code
  timeout would become Couldn't apply and block the role for 60 days, though nothing was sent.
