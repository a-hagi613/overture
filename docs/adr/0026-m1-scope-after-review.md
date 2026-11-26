---
status: accepted
---

# M1 scope after the architecture review

The owner's rulings on the M1 architecture review (2026-11-19):

- **An early cloud probe.** Right after the first deploy, about five real Greenhouse applications for the owner are
  sent from `overture-web` through Browser Use, measuring megabytes per form, how often a code is asked for and
  whether confirmation is seen. Proxy traffic decides the cost gate (each extra MB per form is about $0.005), so it is
  measured before the rest of the pipeline is built on it. The owner types any emailed code by hand, and these five
  use the owner's own email because the job-search address does not exist yet; they are recorded so v2 never applies
  to the same roles again.
- **Sign-in in M1 is Google, LinkedIn and magic link.** Email and password moves to M2. Passkeys stay, for admin only.
- **Kernel stays behind the browser port** as an emergency fallback exercised on the synthetic lab, despite its
  acceptable-use policy (ADR 0003). Browserbase or Anchor are the alternatives if a real fallback is ever needed.
- **The gate's terms.** An Application counts as *attempted* once a try started in a cloud browser and did not end as
  `posting_closed`, `duplicate` or `needs_review`. The 85 % is sent ÷ attempted Applications, not tries. *Cost per
  completed Application* is all Browser Use and Anthropic spend for attempted Applications, failed tries included,
  divided by sent ones; live checks, the lab, discovery tagging and fixed infrastructure are reported beside it, not
  inside it.

## Considered Options

- First real send at the end of M1: leaves the largest risk untested until everything is built.
- All four sign-in methods in M1: three of them serve nobody while the owner is the only user.
- Dropping Kernel: the owner prefers to keep the adapter.

*Amendment of 2026-11-26 (#679): the synthetic lab, the provider report and the daily live checks are removed (ADR
0013, ADR 0046, SPEC §10.4 and §16.5). Cost per completed application is still measured from the attempt record, and a
send is proven by its before/after Submit screenshots and its timeline.*
