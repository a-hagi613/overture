---
status: accepted
---

# Pacing limits are fixed product rules, not user settings

At most 10 Applications a day, sent at random times at least 20 minutes apart inside 08:00–20:00 in the user's timezone, resetting at local midnight. One open Application per company at a time, and none for 7 days after a send; no re-apply to a reposted role within 60 days; at most 20 Overture applicants per Posting and 50 per employer per week. Limits are admin-tunable defaults, never exposed as user settings, because their purpose is to protect the user's and Overture's standing with employers.

## Considered Options

- User-set daily caps, company limits and overnight sending windows (drawn in v1): let one user's choices embarrass them and burn reputation for everyone.

*Amendment of 2026-11-26 (#679, #681): there is no send window, the gap between one user's paid sends is 5 minutes (the
trial's three are exempt and go at once), and browser concurrency is uncapped. See ADR 0046 ("Dispatch timing"). The
daily cap, the company cooldown, the repost guard, the crowd limits, the per-ATS cap and the confirmation wait are
unchanged.*
