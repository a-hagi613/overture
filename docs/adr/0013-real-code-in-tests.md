---
status: accepted
---

# Tests run real code; only the network edge is intercepted

Every external dependency sits behind a port, and domain code imports ports only. Tests do not replace any of them
with hand-written stand-ins: they run the production adapters. Where a real local equivalent exists, tests use it
(SQLite, a local Chrome filling saved ATS forms served by the fixture server, a disk object store, the real signed
inbound-mail endpoint). Third-party HTTP APIs (Anthropic, SES, Browser Use's control API, the ATS feeds, push
services, the FX feed, Stripe) are intercepted at the network by MSW, inside the app process, with
`onUnhandledRequest: "error"` and responses recorded from the real service. Time comes from the real clock adapter,
whose offset tests can move through a test-only route that is not mounted in production.

What this cannot catch (an employer changes a form, Browser Use is blocked, Haiku's output drifts, mail stops
arriving) is caught by **daily live checks** on `overture-web`: real forms filled and stopped before Submit, a small set
of real Haiku calls, a real mail loop through SES and Cloudflare to an Overture-owned check address, and a real R2
round trip. Each check alerts on failure and refreshes the saved forms and recordings the tests replay. None submits
an application or touches a user.

End-to-end Playwright tests are the standard, driving only what a user, an admin or a webhook touches. Unit tests
(Vitest) exist only for six invariants: ledger, crypto, planner, address, tag rules, question normalisation. CI stays
under two minutes on pull requests, sharded, with no sleeps and zero retries.

## Considered Options

- Hand-written fakes for every port: fast, but they test our idea of the service rather than the service, and drift silently. Banned by Landmines `no-test-doubles`.
- Real third-party services in every test run: slow, costly, flaky, and would touch employers.
- A unit-heavy suite (v1: about 118 files): tested implementation rather than behaviour.
