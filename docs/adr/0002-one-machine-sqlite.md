---
status: accepted
---

# One Fly machine, one process, SQLite

Production is one Fly app (`overture-web`, yyz) on one machine with one volume: a single Bun process serves the API, the SPA and SSE, and runs the scheduler, the job queue and browser control. Data is SQLite (WAL, `synchronous=FULL`, STRICT) behind Drizzle, replicated continuously to R2 by Litestream with a weekly restore drill. Deploys cost 10–30 s of downtime, accepted until about 200 paying users; Drizzle and the ports keep a Postgres, multi-machine path open.

## Considered Options

- Postgres now: cost and a network hop with no need at this scale.
- A separate runner app for browsers: unnecessary once browsers are rented (ADR 0003).
