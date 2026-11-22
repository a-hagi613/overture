---
status: accepted
---

# Use the Workers Paid plan inside its allowances, with layered spend guards

From the research in `docs/research/cloudflare-paid-plan.md`. The owner accepted the decision and the stated trade
on 2026-11-21; the first layer is live: the Workers and Durable Objects spending limits at 1¢ and the $0.50
account-wide budget alert exist on the account, and their commands, reading and lifting are in
`docs/research/cloudflare-spend-guard-runbook.md`. The sentinel is built (#283, `workers/sentinel`): it probes
health from outside Fly, watches the Workable snapshot's age and Cloudflare usage, and writes the degraded flag the app
reads. The marketing pages are served from Workers Static Assets (#284, `workers/marketing`) on routes for `/` and
`/pricing` only. The Queue, the app-side counters and the R2 bounds are separate tickets (#281–#287); the Workers AI
`email_classify` trial (#287) is dropped, so `email_classify` stays rules plus Haiku with no Neuron counter.

## Context

The owner pays $5 a month for Workers Paid and wants no spend above $5 a month in total. The $5 is the subscription, so the goal is zero overage. Cloudflare has no native hard cap on account spend: spending limits exist only for Workers and Durable Objects, and they are not exact.

## Decision

- **Use Cloudflare for what it does free at Overture's volume:** the inbound-mail Email Worker, a cron sentinel Worker, Workers Static Assets for the marketing pages, a Queue under the inbound mail path, and R2 as today.
- **Do not adopt** Browser Run for sending (no residential proxy or CAPTCHA solving, and a non-removable bot signature; ADR 0003 and 0016 stand), D1, KV, Durable Objects, Workflows, Vectorize, Hyperdrive, Containers or Images. The Workable pass stays on the GitHub Action (ADR 0032).
- **Workers AI is not adopted for `email_classify` (#287).** The fallback stays rules plus Haiku (SPEC §8.6, §11.3).
  The cost review (#184) prices a classification at 24 µUSD, or about 1.4 cents a user-month at the Month plan's full
  allowance, and no local Workers AI response exists to prove equal accuracy, so the issue's own rule skips the trial
  (`docs/research/cloudflare-paid-plan.md` §5). No Neuron counter is added: it would guard a spend the workload cannot
  reach, and it belongs with the live comparison if Workers AI is ever revived.
- **Guards, layered:** a Workers and a Durable Objects spending limit at $0.01, each emailing the owner at 80% and
  100%; a $0.50 account-wide budget alert; a sentinel Worker that watches usage and sets a degraded flag; and
  an app-side counter for Email Sending. R2 cannot be blocked natively, so it is bounded by
  design: a Litestream sync interval chosen from measured Class A operations, a lag read that lists one replica level
  instead of ten, a five-minute L0 retention check, lifecycle rules and a size alert. The measured list floor is about
  104k Class A a month before writes (#281, `docs/research/cloudflare-paid-plan.md` §2).
- **The owner accepts the stated trade:** if the Workers limit trips, the Email Worker stops and inbound mail is lost until the period resets or the limit is lifted. The Queue (#286) narrows this: a tripped limit also stops the queue consumer, but mail already queued waits inside its 14-day retention and is delivered when the limit is lifted; only mail that arrives while the Email Worker itself cannot run is lost. There is no non-Worker delivery path.
- **The sentinel reports through R2, not logs.** A Worker has no `process.stderr` and the lint rule set bans `console`, so the sentinel cannot log like the app. Instead each run records itself as `lastRun` in `ops/sentinel-state.json` — the object it already writes for alert de-duplication — with the instant, what it saw, the alerts it sent and anything it could not do; a failed state write throws so Cloudflare marks the invocation as an error. One `wrangler r2 object get` answers "is the cron alive and what did it find?". The degraded flag at `ops/degraded.json` is written only when its content changes, so a degraded period does not add a Class A write every ten minutes.

## Considered Options

- **Treat the Workers limit as the cap.** Rejected: it covers Workers and Durable Objects only, and Cloudflare says it does not guarantee a maximum.
- **A watchdog that revokes the R2 token at a threshold.** Rejected: it would stop the backups.
- **Browser Run for sending.** Rejected for the reasons above; cheaper per application but not a like-for-like browser.
- **Workable ingest on a Worker.** Rejected: about 3.6 M CPU-ms a day for the full pass against 30 M a month included, and no gain over the free Action.
- **Workers AI for the `email_classify` fallback.** Rejected (#287): the cost review puts the line at 24 µUSD a call and cents a user-month, and no Workers AI response is recorded, so equal accuracy cannot be shown. The rule that decides it is #287's own (`docs/research/cloudflare-paid-plan.md` §5).

## Consequences

- The sentinel is 4,320 invocations a month against the 10 M included, with `limits.cpu_ms` at 500 as a runaway
  guard; it deploys separately (`workers/sentinel`) with its own secrets and no public route. Until it is deployed, the
  80% email from the spending limit is the first signal, as before.
- The app gains one read path (`ops/degraded.json`, cached for a minute) and two behaviours it sheds while degraded;
  both log when they change, with the metrics that caused it.
- The degraded flag is compared before it is written, so a long degraded period costs Class B reads, not a Class A write
  every ten minutes.
