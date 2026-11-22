# M1-09 — Production seed, backfill and census runbook

**Deliverable for issue #16.** The commands the orchestrator runs on the Fly machine (`fly ssh console`,
app `overture-web`, database `/data/app.sqlite`, repo at `/app`), the measured evidence behind them, and how long
the backfill takes at the SPEC §6.1 per-ATS limits. Every command is also proven by the recorded-fixture e2e suite;
nothing here touches a production ATS feed from a development box (ADR 0016).

## 1. Fetch the seed

```sh
bun run scripts/fetch-seed.ts --dir /data/seed
```

Downloads the pinned ats-scrapers manifest (`https://storage.stapply.ai/jobs/v1/manifest.json`) and
`companies.parquet` (`…/companies.parquet`), verifies both sha256 pins and the manifest's own declared parquet
hash against `src/server/catalog/companies-parquet.ts`, and only then writes
`/data/seed/manifest.json` and `/data/seed/companies.parquet`. A mismatch fails loudly before anything is
written, including on the loader (below), which re-checks the pins on every run.

A weekly `.github/workflows/stapply-seed.yml` run stages a candidate snapshot before anyone re-pins: it runs
`scripts/refresh-stapply-seed.ts`, which applies the same schema check, the manifest's own sha256 and a 20 % row-drop
guard, keeps the prior snapshot when upstream fails, and uploads the staged files plus a JSON summary as an artifact
(`docs/DEPLOY.md`, the Stapply seed refresh). To adopt one, read its hashes and row count, update both pins in
`src/server/catalog/companies-parquet.ts`, and rerun steps 1 and 2.

## 2. Load the discovered boards

```sh
bun run scripts/load-discovered-boards.ts \
  --db /data/app.sqlite \
  --manifest /data/seed/manifest.json \
  --companies /data/seed/companies.parquet
```

Loads the dataset's greenhouse, lever and ashby rows into `company_boards` with `source='discovered'`. The whole
load runs in a single transaction, so the pinned dataset's 13,911 boards and 13,586 companies land in one commit
with one fsync (`synchronous=FULL`), not one fsync per statement.

Measured (2026-11-20, dev box, full pinned dataset, `nice -n 10`):

| Run | Result |
|---|---|
| Fresh database | 13,911 boards created in **11.8 s** wall (including reading and validating the 173,344-row parquet) |
| Same database again | 0 created, 13,911 existing in **2.3 s** wall — idempotent |

Evidence of idempotency and pin-failure behavior against the small recorded fixture lives in
`test/e2e/catalog-discovered-seed.test.ts`; the load contract itself is unchanged from #56.

## 3. Start the backfill

```sh
bun run scripts/enqueue-backfill.ts --db /data/app.sqlite
```

Enqueues the `catalog.backfill` job (skipping the enqueue if one is already queued or running). The web process's
job worker claims it within its poll interval; the job marks every pollable board due and the sweep chain runs the
pass in batches, with per-feed requests always inside the SPEC §6.1 limits (4 concurrent, 2 req/s per ATS, each
request issued through `limiterFor` in `src/server/catalog/rate-limiter.ts` and each feed client). The script also
prints the request counts and duration estimate for the current database:

```json
{
  "backfillKind": "catalog.backfill",
  "estimate": {
    "perAts": [
      { "ats": "greenhouse", "boards": 7363, "listingRequests": 7363, "pendingDetailRequests": 0, "requests": 7363, "minIntervalMs": 500, "maxConcurrent": 4, "durationMs": 3681500 },
      { "ats": "lever", "boards": 2377, "requests": 2377, "durationMs": 1188500 },
      { "ats": "ashby", "boards": 4171, "requests": 4171, "durationMs": 2085500 }
    ],
    "passDurationMs": 3681500
  }
}
```

### How long 13,911 boards take at those limits

The three per-ATS limiters run in parallel, so the pass is bounded by the slowest ATS. At 2 req/s per ATS:
greenhouse 7,363 listings → **61.4 min**; lever 2,377 → 19.8 min; ashby 4,171 → 34.8 min — a board pass of about
**1 hour**. Two further facts set the real wall time:

- **Greenhouse per-job details.** On the first pass every new greenhouse Posting costs one detail request
  (`/jobs/{id}?content=true`) through the same limiter. The script counts the pending ones (open greenhouse
  Postings with no description yet) before the run; extrapolating the seed-comparison's ~174,000 greenhouse
  Postings (`docs/research/seed-comparison.md` §5), that is ~174,000 × 0.5 s ≈ **24 h** more, so the first full
  backfill is a ~1-day, greenhouse-bound run. Later passes are conditional (ETag / content hash) and only
  re-fetch what changed.
- **Sweep pacing.** The pass runs as a chain of sweeps, and each sweep claims its batch before polling: a board is
  claimed by moving `next_poll_at` forward to a 15-minute claim in the same statement that selects it, so
  overlapping sweeps never poll the same board and a crashed process's board returns when the claim lapses. At the
  defaults (`catalog.sweep_interval_ms` 60 s) one sweep claims 120 boards per ATS (the interval times the ATS's
  2 req/s rate), 360 in total — the same pace the §6.1 limits allow — so the board pass is bounded by Greenhouse:
  7,363 boards / 120 per sweep × 60 s ≈ **61.4 min**, the same ~1 hour as the request-count estimate above. A slower
  ATS cannot starve the others. `catalog.sweep_batch` overrides the per-sweep total (split across ATSes in
  proportion to their rates — e.g. 500 claims ~167 per ATS per sweep) and `catalog.sweep_interval_ms` overrides the
  chain interval (and with it the computed per-ATS batch); the per-ATS limiter is the only pacing that protects the
  feeds.

## 4. Run the census

```sh
bun run scripts/census.ts --db /data/app.sqlite --out docs/research/census.md
```

Prints and writes aggregates only: boards by ATS and status, Postings by ATS, country and workplace, the top 50
normalized titles, department frequency, rule coverage per tag dimension and the top 20 companies by open
Postings. It contains no apply URLs, no person names, no emails and no Postings descriptions; the e2e
(`test/e2e/census.test.ts`) asserts every aggregate against the recorded Greenhouse, Lever and Ashby fixtures and
asserts the output matches no email or URL pattern. Commit the report to `docs/research/census.md` after the
production run.
