---
status: proposed
---

# Use the Workers Paid plan inside its allowances, with layered spend guards

Draft from the research in `docs/research/cloudflare-paid-plan.md`. The owner decides; nothing here is built yet.

## Context

The owner pays $5 a month for Workers Paid and wants no spend above $5 a month in total. The $5 is the subscription, so the goal is zero overage. Cloudflare has no native hard cap on account spend: spending limits exist only for Workers and Durable Objects, and they are not exact.

## Decision

- **Use Cloudflare for what it does free at Overture's volume:** the inbound-mail Email Worker, a cron sentinel Worker, Workers Static Assets for the marketing pages, a Queue under the inbound mail path, and R2 as today.
- **Do not adopt** Browser Run for sending (no residential proxy or CAPTCHA solving, and a non-removable bot signature; ADR 0003 and 0016 stand), D1, KV, Durable Objects, Workflows, Vectorize, Hyperdrive, Containers or Images. The Workable pass stays on the GitHub Action (ADR 0032).
- **Guards, layered:** a Workers and a Durable Objects spending limit at $0.01, a budget alert, a sentinel Worker that watches usage and sets a degraded flag, and app-side counters for Email Sending and, if adopted, Workers AI. R2 cannot be blocked natively, so it is bounded by design: a Litestream sync interval chosen from measured Class A operations, lifecycle rules and a size alert.
- **The owner accepts the stated trade:** if the Workers limit trips, the Email Worker stops and inbound mail is lost until the period resets or the limit is lifted.

## Considered Options

- **Treat the Workers limit as the cap.** Rejected: it covers Workers and Durable Objects only, and Cloudflare says it does not guarantee a maximum.
- **A watchdog that revokes the R2 token at a threshold.** Rejected: it would stop the backups.
- **Browser Run for sending.** Rejected for the reasons above; cheaper per application but not a like-for-like browser.
- **Workable ingest on a Worker.** Rejected: about 3.6 M CPU-ms a day for the full pass against 30 M a month included, and no gain over the free Action.
