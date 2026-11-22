# Final prices proposal (issue #249, M3-08), 2026-11-21

Owner confirmation is step 5 of [#254](https://github.com/a-hagi613/overture/issues/254) (owner setup). Nothing here is a
price until the owner confirms it there. Stripe is not yet connected to live prices.

## Recommendation

- **Keep the public prices as they are:** Week $12 for 70 Applications over 7 days, Month $35 for 300 over 30 days,
  Trial 3 Applications free of revenue (ADR 0018).
- **Re-measure before the beta wave is priced.** Real sends are the first measured data (#181 is deferred to the end of
  M3). Two conditions come first (see "Before the price is final").

## Measured cost

The measured figures come from the cost review's recorded session, not from production traffic: no real send has run
yet (`docs/research/cost-m1.md` §2.1, §2.3). The admin report at `/admin/billing/margin` computes the same measure from
live `attempts` and `llm_usage` rows once real Applications exist.

| Line | Per completed Application | Basis |
|---|---|---|
| Browser Use (browser time and proxy) | $0.0265 | 9.27 min and 2.71 MB at one recorded send, ÷ 0.85 submit rate (cost-m1 §2.1) |
| Anthropic, Haiku 5.5 batch | $0.0005 | One open question and a cover letter (cost-m1 §2.3); $0.0001 for a typical form |
| **Cost per completed Application** | **$0.027** | Inside the $0.03 gate by 10 % |
| Fixed infrastructure | $20.76 a month, reported beside | cost-m1 §1; not in the per-Application number (ADR 0026) |
| Mail | $0.35 per 1,000 sends above 3,000 a month, reported beside | cost-m1 §1 |

With Anthropic spend included, the number is $0.027. The browser-only figure the Overview used before this change
($0.0265) understated it by about 2 % at Haiku 5.5, and by 18–25 % at the 4.5 default (cost-m1 §5.1).

## Margin per plan

Revenue per Application is the price divided by its allowance. Margin is revenue minus the measured cost.

| Plan | Price | Applications | Revenue per Application | Cost | Margin per Application | Margin |
|---|---|---|---|---|---|---|
| Trial | $0 | 3 | $0.000 | $0.027 | −$0.027 | n/a (3 Applications cost about $0.08) |
| Week | $12 | 70 | $0.171 | $0.027 | $0.144 | 84 % |
| Month | $35 | 300 | $0.117 | $0.027 | $0.090 | 77 % |

Break-even at the measured cost is far below the price: a Month Application earns $0.117 against $0.027 of cost. A 60 %
margin holds up to a cost per completed Application of about $0.047 on Month and $0.068 on Week. The cost-m1 note's 10-minute
code paste case ($0.038 per completed) keeps Month above 60 %.

Stripe Managed Payments fees and taxes are not in these figures. They change margin, not the browser or model levers
(cost-m1 §Limits). The owner adds them when step 2 of #254 sets the prices.

## Before the price is final

1. **The model default and price table** (cost-m1 §5.2). The code defaults to `claude-haiku-4-5`, whose batch rates are
   10× the Haiku 5.5 rates the spec names. At the 4.5 default the Anthropic line is $0.0051 an Application, the cost is $0.0316 and the Month margin falls to 73 % per Application (67 % per user-month once fixed infrastructure is included, cost-m1 §3). Fix
   the default and the exact-match prices before the beta wave, and check the Console price.
2. **Real measurements** from the beta wave: minutes, megabytes and code-wait minutes per ATS (cost-m1 §7). Egress is
   the one lever that changes the shape of the business (cost-m1 lever 1, $5/GB against $0.20/GB). If real forms carry
   10 MB, the proxy dominates again and the prices should be re-read.

## What changed in this measure

- `buildCostSummary` (the Overview gate) now includes the Anthropic spend of the Application purposes for the users
  whose attempts it counts (ADR 0026, finding 5.1). Before this change it summed only `attempts.cost_micros`.
- `/admin/billing/margin` reads the same data per plan over 30 days (`src/server/billing/margin.ts`). A user's plan is
  their latest paid period (by allowance: 70 is Week, 300 is Month); a user with no paid period is on the Trial; a user
  with no grant is in no plan.
- Anthropic spend is attributed per user, not per Application, because `llm_usage` has no application id and this
  change adds no migration. For a user, all of the window's Application-purpose calls are counted, including scoring for
  postings that were never attempted. That overstates cost slightly and is conservative for the gate.
- The per-provider report (`/admin/api/provider-report`) stays browser-only, as before. Anthropic spend cannot be split
  per ATS without an application id on `llm_usage`.

## Limits

- No production or beta send is in these numbers. They are the recorded fixture, with the arithmetic shown.
- The Trial's cost is an acquisition cost, not a plan's margin. It is reported so the owner can see what a free trial
  costs per Application.
- Five real applications for the owner (ADR 0026) are still the first live data point.
