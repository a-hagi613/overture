---
status: accepted
---

# Actual per-Application variable cost, and the covering index for the subscriber count

Implements issue #570 (WS-1b), a child of the owner's Part 1 architecture revision (issue #560). It extends the cost
report of ADR 0026 and the Regular Stripe Billing baselines of ADR 0018 with what an Application actually spent, kept
on the Application row rather than recomputed at read time.

## Context

ADR 0026 defines cost per completed Application as all Browser Use and Anthropic spend for attempted Applications,
failed tries included, divided by sent ones. That is the right number for a plan row, but it is a monthly average: the
admin cannot see what one Application cost, how much of it a retry burned, or how it compares with the $0.114 (Month)
and $0.187 (Week) net revenue one Application brings in after Stripe's fee.

The sources already exist. `attempts.cost_micros` is the browser spend of one try, written in the send worker's
`finally` from the provider's reported usage. `llm_usage.cost_micros` is the model spend of one call, and it carries
the person, not the Application, because the call sites do not have an Application id at hand (SPEC §10.4).

Issue #585 (WS-1a) deferred one schema item to this migration: `count(distinct user_id)` over the unexpired `period`
grants is read by the subscriber-scaled LLM and mail spend budgets, and no index covered it.

## Decision

**The Application row carries its own cost.** `applications` gains `browser_cost_micros`, `retry_cost_micros`,
`llm_cost_micros` (integer micros, `NOT NULL DEFAULT 0`, matching every other money column) and `cost_recorded_at`,
which stays null until a refresh has measured the row, so a measured zero is never confused with a missing one.

**The send is the base, the retries are separate.** The try that sent the Application — the last try that clicked
submit when one did, which covers the page- and email-confirmed paths — contributes to `browser_cost_micros`. Every
other attempted try contributes to `retry_cost_micros`. Tries that never counted as attempted Applications
(`posting_closed`, `duplicate`, `needs_review`) contribute nothing, as in ADR 0026. The two columns add up to the
browser spend ADR 0026 counts, so a retry can never double count a send and the total never loses one either.

**Model spend is attributed, not invented.** `llm_usage` has no Application id, so the person's actual
Application-purpose model spend is divided evenly across their completed Applications, with the remainder going to
the oldest ones. The stored shares always add up to the real total; the split is an allocation of measured spend, not
a second measurement. A person with no completed Application has no share to allocate.

**It is a recompute, not an increment.** `recordApplicationVariableCosts` reads the person's tries and model spend and
writes only rows whose numbers moved. Running it twice writes nothing the second time, so a retried confirmation, a
crash-recovery pass or a duplicate webhook cannot inflate a cost. It runs when a try finishes in the send worker, when
an email confirms a send, and when a confirming Application expires.

**The margin view shows both.** `/admin/api/margin` now carries the stored breakdown per Application overall and per
plan (`llm`, `browser`, `retry`, `total`), and beside it the actual cost against the Month and Week net revenue
baselines of ADR 0018, with the margin and the cost's share of that revenue. Applications that predate the columns,
or never recorded a cost, are left out of the average instead of counted as free.

**The subscriber count gets its covering index.** Migration `0062` adds
`grants_paying_subscribers` on `(source, starts_at, expires_at, user_id)`, so the active paid-subscriber count reads
the index alone. It is additive, and `IF NOT EXISTS` keeps a database that already carries it migratable.

## Consequences

- The cost report and the margin report still compute their monthly averages from `attempts` and `llm_usage`; the
  stored columns are the per-Application record, and the two agree by construction when the read window matches.
- Cost recording is best-effort at the send boundaries: a failure is logged and never fails a send that already
  happened, and the next try on the same Application recomputes the same rows.
- Old Applications show no breakdown (they are excluded, not zeroed). Nothing backfills them, because reprocessing a
  finished send to price it is not worth a migration-time job.
- The admin page's JSON grows; the web schema strips unknown keys, so a deploy where the server is newer than the
  bundle keeps working.
