---
status: accepted
---

# Three plans, renewing, no annual

Trial: 3 applications once, card verified, one per card by a fingerprint that survives account deletion. Week: $9.99 for 50 over 7 days. Month: $29.99 for 250 over 30 days. Both renew; unused applications expire; no refunds by default because failures are never charged. Billed through regular Stripe Billing (hosted Checkout, the customer portal and signed webhooks), behind a `Payments` port; Overture is the seller and Stripe is the payment processor. Regular Stripe charges 2.9 % + $0.30 a card payment plus 0.7 % Stripe Billing, so 3.6 % + $0.30 on a domestic card and 5.1 % + $0.30 on an international one; the margin page measures net revenue after that fee, $0.114 an Application on Month and $0.187 on Week domestic. The owner locked these prices in issue #254 after M1 cost was measured.

## Considered Options

- An annual plan: nobody searches for a year.
- Larger caps (600 a month, 40 a day): too generous to look human.
