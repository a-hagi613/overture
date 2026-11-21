---
status: accepted
---

# Tests run real code; only the network edge is intercepted

Every external dependency sits behind a port, and domain code imports ports only. Tests do not replace any of them
with hand-written stand-ins: they run the production adapters. Where a real local equivalent exists, tests use it
(SQLite, a local Chrome filling saved ATS forms served by the fixture server, a disk object store, the real signed
inbound-mail endpoint). Third-party HTTP APIs (Anthropic, Cloudflare Email Sending, Browser Use's control API, the ATS feeds, push
services, the FX feed, Stripe) are intercepted at the network by MSW, inside the app process, with
`onUnhandledRequest: "error"` and responses recorded from the real service. MSW is pinned to 2.x: 3.x intercepts
nothing under Bun, and a CI check fails if a request to an unmocked host gets through. Time comes from the real clock adapter,
whose offset tests can move through a test-only route that is not mounted in production. Moving the clock does not
fire timers, so a second test-only route runs every job that is due, and code waiting for mail is woken when mail
arrives rather than by polling alone.

What this cannot catch (an employer changes a form, Browser Use is blocked, Haiku's output drifts, mail stops
arriving) is caught by **daily live checks** on `overture-web`: real forms filled and stopped before Submit, a small set
of real Haiku calls, a real mail loop through Cloudflare Email Sending to an Overture-owned check address, and a real R2
round trip. Each check alerts on failure and refreshes the saved forms and recordings the tests replay. None submits
an application or touches a user.

End-to-end Playwright tests are the standard, driving only what a user, an admin or a webhook touches. Unit tests
exist only for twelve invariants: ledger, crypto, planner, address, tag rules, question normalisation, answer
derivations, the answer planner (a salary Fact kept per currency is chosen only for the currency a question names),
the facts model (a Fact's scope is validated against its key), the onboarding step's salary and EEO reading, the
fixture sanitiser (recorded pages must carry no script, event handler, personal data or token), and the v1
answer-bank mapping. They import
`bun:test`, run with `bun test src`, and keep the Vitest lint plugin, whose test-shape rules do not depend on the
runner. CI stays under two minutes on pull requests: six shards balanced by per-file time, and a pull request runs
only the e2e files its committed reach map says its diff can reach, with everything unclassified running the full
suite. Main always runs all of them. No sleeps, no retries, no lowered timeouts.

## Considered Options

- Hand-written fakes for every port: fast, but they test our idea of the service rather than the service, and drift silently. Banned by Landmines `no-test-doubles`.
- Real third-party services in every test run: slow, costly, flaky, and would touch employers.
- A unit-heavy suite (v1: about 118 files): tested implementation rather than behaviour.
