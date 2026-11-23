---
status: accepted
---

# Applications left is a double-entry ledger with reserve, commit and release

Allowances are grants recorded in an append-only, zero-sum ledger. Sending reserves one; a confirmed send commits it; anything else releases it, so a failure is never charged. Balances and daily usage are derived from the ledger with idempotency keys, not kept in counters. A release is paired with its reservation by insertion order rather than `created_at`, and a grant that has carried a spend counts as started: a restart whose clock reads behind the rows the killed process wrote must still find that person's credit spendable, exactly once (issue #553). The ledger exists from M1 so billing in M3 rewrites nothing. When a paid period ends, a reservation held by a send already in flight stays: a confirmed send commits and is charged for what was sent, while a failed or unconfirmed one releases and the next expiry sweep expires it on the grant that ended.

## Considered Options

- Usage counters per user: drift under crashes and retries, and cannot be reconciled with Stripe.
