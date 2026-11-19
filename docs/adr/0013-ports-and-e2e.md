---
status: accepted
---

# Every external dependency behind a port; end-to-end tests are the standard

Domain code imports ports only (LLM, browser, mail, object store, search, payments, push, FX, clock). Each port has a production adapter and a fake, and every end-to-end test runs on the fakes against a local fixture server. Playwright end-to-end tests cover essentially every flow; unit tests exist only for six invariant files (ledger, crypto, planner, address, tag rules, question normalisation). CI stays under two minutes on pull requests, sharded, with no sleeps and zero retries.

## Considered Options

- A unit-heavy suite (v1: about 118 files): slow, and it tested implementation rather than behaviour.
