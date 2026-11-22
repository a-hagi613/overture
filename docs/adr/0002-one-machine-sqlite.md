---
status: accepted
---

# One Fly machine, one process, SQLite

Production is one Fly app (`overture-web`, yyz) on one machine with one volume: a single Bun process serves the API, the SPA and SSE, and runs the scheduler, the job queue and browser control. Data is SQLite (WAL, `synchronous=FULL`, STRICT) behind Drizzle, replicated continuously to R2 by Litestream with a weekly restore drill. Deploys cost 10–30 s of downtime, accepted until about 200 paying users; Drizzle and the ports keep a Postgres, multi-machine path open.

**Amended by ADR 0036:** the catalog tables live in a second SQLite file on the same volume, `/data/catalog.sqlite`,
which Litestream does not replicate. The application database keeps `synchronous=FULL` and every user, billing and
job-queue row; nothing else in this decision changes.

## Considered Options

- Postgres now: cost and a network hop with no need at this scale.
- A separate runner app for browsers: unnecessary once browsers are rented (ADR 0003).
