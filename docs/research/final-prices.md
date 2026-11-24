# Final prices (issue #249, M3-08), 2026-11-21

The owner locked the prices in for step 5 of [#254](https://github.com/a-hagi613/overture/issues/254) (owner setup).
Stripe is not yet connected to live prices.

## Recommendation

- **Locked in by the owner:** Week **$9.99** for **50 Applications** over 7 days, Month **$29.99** for **250 Applications**
  over 30 days, Trial 3 Applications free of revenue (ADR 0018).
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

Gross revenue per Application is the price divided by its allowance. Regular Stripe Billing charges 3.6 % + $0.30 per
domestic charge (2.9 % card plus 0.7 % Billing) and 5.1 % + $0.30 on an international card; the fee line is that whole
charge, rounded to cents, and the net line is what reaches Overture. Profit per Application is net revenue minus the
measured cost, and Margin is profit over net revenue. Stripe Tax calculates the tax on each charge and Overture is the
seller, so tax is neither revenue nor cost here.

| Plan | Price | Applications | Gross per Application | Stripe fee | Net revenue | Net per Application | Cost | Profit per Application | Margin |
|---|---|---|---|---|---|---|---|---|---|
| Trial | $0 | 3 | $0.000 | $0.00 | $0.00 | $0.000 | $0.027 | −$0.027 | n/a (3 Applications cost about $0.08) |
| Week | $9.99 | 50 | $0.200 | $0.66 | $9.33 | $0.187 | $0.027 | $0.160 | 85.5 % |
| Month | $29.99 | 250 | $0.120 | $1.38 | $28.61 | $0.114 | $0.027 | $0.087 | 76.4 % |

An international card takes 1.5 points more, so the same charge nets $0.184 an Application on Week and $0.113 on
Month; the admin margin page reports both baselines and measures profit against the domestic one.

Break-even at the measured cost is far below the price: a Month Application nets $0.114 against $0.027 of cost and a
Week Application nets $0.187. After fees, a 60 % margin holds while cost per completed Application stays under about
$0.046 on Month and $0.075 on Week. The cost-m1 note's 10-minute code paste case ($0.038 per completed) keeps Month
above 60 %.

The model and browser levers do not change with the price (cost-m1 §Limits). The live Stripe price objects are still an
owner step (`scripts/setup-stripe.ts`, #254).

## Before the price is final

1. **The model default and price table** (cost-m1 §5.2). The code defaults to `claude-haiku-4-5`, whose batch rates are
   10× the Haiku 5.5 rates the spec names. At the 4.5 default the Anthropic line is $0.0051 an Application, the cost is $0.0316 and the Month margin falls to 72 % per Application (67 % per user-month once fixed infrastructure is included, cost-m1 §3). Fix
   the default and the exact-match prices before the beta wave, and check the Console price.
2. **Real measurements** from the beta wave: minutes, megabytes and code-wait minutes per ATS (cost-m1 §7). Egress is
   the one lever that changes the shape of the business (cost-m1 lever 1, $5/GB against $0.20/GB). If real forms carry
   10 MB, the proxy dominates again and the prices should be re-read.

## What changed in this measure

- `buildCostSummary` (the Overview gate) now includes the Anthropic spend of the Application purposes for the users
  whose attempts it counts (ADR 0026, finding 5.1). Before this change it summed only `attempts.cost_micros`.
- `/admin/billing/margin` reads the same data per plan over 30 days (`src/server/billing/margin.ts`). A user's plan is
  their latest paid period (by allowance: 50 is Week, 250 is Month); a user with no paid period is on the Trial; a user
  with no grant is in no plan.
- Anthropic spend is attributed per user, not per Application, because `llm_usage` has no application id and this
  change adds no migration. For a user, all of the window's Application-purpose calls are counted, including scoring for
  postings that were never attempted. That overstates cost slightly and is conservative for the gate.
- The per-provider report (`/admin/api/provider-report`) carries the same Anthropic attribution as the Overview: a
  user's window spend is spread across their attempted tries, so each provider × ATS row gets the share of that spend
  its tries hold. `llm_usage` still has no application id, so no row is joined to a call.

## Limits

- No production or beta send is in these numbers. They are the recorded fixture, with the arithmetic shown.
- The Trial's cost is an acquisition cost, not a plan's margin. It is reported so the owner can see what a free trial
  costs per Application.
- Five real applications for the owner (ADR 0026) are still the first live data point.
