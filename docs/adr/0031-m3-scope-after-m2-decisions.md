---
status: accepted
---

# M3 scope after the M2 decisions

M3 (ADR 0019) is restated for the product as it now is: the user approves every send (ADR 0029), real email with
forwarded ATS mail (ADR 0028), and the plans of ADR 0018.

## Decisions

- **Public sign-up replaces invites**, with Turnstile and rate limits. Because anyone can now sign up, nothing is
  prepared for a user until a trial card is verified or a plan is paid, so public sign-ups cannot spend LLM or browser
  money for free. Users invited in M2 keep their admin grants and choose a plan when those run out.
- **Plans are ADR 0018's** (trial 3 once per card, Week $12 for 70 over 7 days, Month $35 for 300 over 30 days, renewing,
  no rollover). Final prices are set from the cost and margin measured in M1 and M2 (including the cost review, #184); the
  prices stay configuration until the owner confirms them.
- **The landing and pricing pages** are redrawn for the current product: Overture prepares every application and sends it
  when you approve; the ATSes are Greenhouse, Lever, Ashby, Personio and Workable; no Workday; the real prices.
- **The owner's console steps come last.** M3 ends with "M3: owner setup" (the Stripe account, Managed Payments approval,
  live keys, the webhook endpoint, tax settings, final prices) and then "M3 close-out: open to the public". Everything else
  is built and verified against stripe-mock and signed webhook fixtures, gated by configuration.
- **If Stripe declines Managed Payments**, plain Stripe Billing with Stripe Tax goes behind the same `Payments` port
  (ADR 0018); the owner setup ticket finds this out first.

## Considered Options

- **Open sign-up with free preparation.** Spend would be uncapped by payment; rejected for the card-verified trial gate.
- **Keep invites alongside payment.** Adds a second gate for no benefit once billing exists; admin grants still cover
  friends.
