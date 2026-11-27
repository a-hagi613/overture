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
- **Plans are ADR 0018's** (trial 3 once per card, Week $9.99 for 50 over 7 days, Month $29.99 for 250 over 30 days,
  renewing, no rollover). The owner locked these prices in from the cost and margin measured in M1 and M2 (including the
  cost review, #184); the prices stay configuration until the owner confirms them.
- **The landing and pricing pages** are redrawn for the current product: Overture prepares every application and sends it
  when you approve; the ATSes are Greenhouse, Lever, Ashby, Personio and Workable; no Workday; the real prices.
- **The owner's console steps come last.** M3 ends with "M3: owner setup" (the Stripe account, two recurring prices,
  live keys, the webhook endpoint, the portal, Stripe Tax settings, final prices) and then "M3 close-out: open to the
  public". Everything else is built and verified against stripe-mock and signed webhook fixtures, gated by
  configuration.
- **Billing uses regular Stripe Billing with Stripe Tax, not Managed Payments.** Overture is the seller and Stripe the
  payment processor (ADR 0018); the `Payments` port keeps the provider seam, and the margin page measures net revenue
  after Stripe's 3.6 % + $0.30 domestic fee (5.1 % + $0.30 international).

## Considered Options

- **Open sign-up with free preparation.** Spend would be uncapped by payment; rejected for the card-verified trial gate.
- **Keep invites alongside payment.** Adds a second gate for no benefit once billing exists; admin grants still cover
  friends.

*Amendment of 2026-11-26 (#678, #679): the M3 scope above is history. Public sign-up, the three-plan onboarding choice
(#709), immediate approved sends (ADR 0046) and the current landing replace the flow described here. SPEC §15 and §2
are the current product; the plans themselves (trial 3, Week 50, Month 250) are unchanged.*
