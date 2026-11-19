---
status: accepted
---

# Never retry after Submit was pressed

The executor records the instant it presses the final Submit. Failures before it are retried once in a fresh session at least 6 hours later. Any failure after it (no confirmation, timeout, crash) puts the Application in Confirming for up to 24 hours, waiting for the employer's acknowledgement email: found means sent and charged; not found means Couldn't apply, not charged, never resent, and the role is treated as applied for the repost guard.

## Considered Options

- Retrying a missing confirmation: if the first submission landed, the employer receives the same application twice.
