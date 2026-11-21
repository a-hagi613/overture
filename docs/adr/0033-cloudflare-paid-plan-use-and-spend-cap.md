---
status: accepted
---

# Use the Workers Paid plan inside its allowances, with layered spend guards

From the research in `docs/research/cloudflare-paid-plan.md`. The owner accepted the decision and the stated trade
on 2026-11-21; the first layer is live: the Workers and Durable Objects spending limits at 1¢ and the $0.50
account-wide budget alert exist on the account, and their commands, reading and lifting are in
`docs/research/cloudflare-spend-guard-runbook.md`. The sentinel, the Queue, the app-side counters and the R2 bounds
are separate tickets (#281–#287).

## Context

The owner pays $5 a month for Workers Paid and wants no spend above $5 a month in total. The $5 is the subscription, so the goal is zero overage. Cloudflare has no native hard cap on account spend: spending limits exist only for Workers and Durable Objects, and they are not exact.

## Decision

- **Use Cloudflare for what it does free at Overture's volume:** the inbound-mail Email Worker, a cron sentinel Worker, Workers Static Assets for the marketing pages, a Queue under the inbound mail path, and R2 as today.
- **Do not adopt** Browser Run for sending (no residential proxy or CAPTCHA solving, and a non-removable bot signature; ADR 0003 and 0016 stand), D1, KV, Durable Objects, Workflows, Vectorize, Hyperdrive, Containers or Images. The Workable pass stays on the GitHub Action (ADR 0032).
- **Guards, layered:** a Workers and a Durable Objects spending limit at $0.01, each emailing the owner at 80% and
  100%; a $0.50 account-wide budget alert; a sentinel Worker that watches usage and sets a degraded flag; and
  app-side counters for Email Sending and, if adopted, Workers AI. R2 cannot be blocked natively, so it is bounded by
  design: a Litestream sync interval chosen from measured Class A operations, lifecycle rules and a size alert.
- **The owner accepts the stated trade:** if the Workers limit trips, the Email Worker stops and inbound mail is lost until the period resets or the limit is lifted. The Queue (#286) narrows this: a tripped limit also stops the queue consumer, but mail already queued waits inside its 14-day retention and is delivered when the limit is lifted; only mail that arrives while the Email Worker itself cannot run is lost. There is no non-Worker delivery path.

## Considered Options

- **Treat the Workers limit as the cap.** Rejected: it covers Workers and Durable Objects only, and Cloudflare says it does not guarantee a maximum.
- **A watchdog that revokes the R2 token at a threshold.** Rejected: it would stop the backups.
- **Browser Run for sending.** Rejected for the reasons above; cheaper per application but not a like-for-like browser.
- **Workable ingest on a Worker.** Rejected: about 3.6 M CPU-ms a day for the full pass against 30 M a month included, and no gain over the free Action.
