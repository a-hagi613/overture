---
status: accepted
---

# Applications left is a double-entry ledger with reserve, commit and release

Allowances are grants recorded in an append-only, zero-sum ledger. Sending reserves one; a confirmed send commits it; anything else releases it, so a failure is never charged. Balances and daily usage are derived from the ledger with idempotency keys, not kept in counters. The ledger exists from M1 so billing in M3 rewrites nothing.

## Considered Options

- Usage counters per user: drift under crashes and retries, and cannot be reconciled with Stripe.
