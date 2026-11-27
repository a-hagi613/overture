---
status: accepted
---

# Dry submit: a local switch that stops before the Submit click

Implements the switch half of issue #710 under the owner's 2026-11-26 direction (EPIC #678). It replaces the ad-hoc
harness edit the 26 Nov local walk used to stop a real form before Submit. It does not change ADR 0025: the employer's
server still decides what "submitted" means.

## Context

The end-to-end walk has to fill a real form with a real browser and stop with proof (a screenshot, an attempt trace)
before anything is sent. The previous walk patched the harness to skip the click, which is easy to leave behind and
impossible to test. The stop point the product already has is the `onWillSubmit` hook every ATS sender calls right
before its Submit click, and it already runs the pre-Submit screenshot.

## Decision

1. **One env var turns it on: `OVERTURE_DRY_SUBMIT=1`** (`true` is accepted too). Any other value is a config error, so
   a typo is refused rather than guessed. It is a process-wide switch fixed at boot, never a server route or a setting.
2. **Production refuses it, twice.** The env schema rejects `OVERTURE_DRY_SUBMIT` when `NODE_ENV` is `production` or
   `FLY_APP_NAME` is set, and `drySubmitActive(env)`, which `main.ts` calls to wire the dispatcher, throws
   `DrySubmitRefusedError` if the parsed flag is on while `NODE_ENV` is production. A production process that somehow
   receives the flag fails loudly at boot; it neither dry-runs nor sends. No other process reads `process.env`: the
   executor receives the resolved boolean.
3. **The stop lives in `onWillSubmit`**, in `src/server/dispatch/dry-submit.ts` (`beforeSubmitStep`). Every sender
   (Ashby, browser-form, Greenhouse, hosted, Lever, Personio, Workable) already awaits the hook before it clicks Submit,
   so the hook first keeps the pre-Submit screenshot and then throws `DrySubmitStoppedError` in dry mode. No flow
   reaches its click, `onResponse` never runs, and no after-Submit shot is taken.
4. **`submit_clicked_at` is never written in dry mode.** It stays the only "submitted" marker (ADR 0025); the normal
   branch of the same step writes it after the screenshot, immediately before the click.
5. **The trace says what happened.** The executor records the attempt as outcome `dry_submit` with error code
   `dry_submit`, returns the Application credit, and moves the Application back to Ready with its frozen plan cleared
   and a status event whose reason is `dry_submit`. The screenshot stays under the attempt, so the proof is readable
   afterwards. The Application never reaches confirming, sent or a Snapshot.
6. **A dry attempt is not a provider result.** `dry_submit` is deliberately absent from the kill-switch sample list, so
   a walk can never trip a provider's or an ATS's success-rate kill switch.
7. **It is observable in admin.** The attempt outcome filter and label include `dry_submit` ("Dry submit").

## Consequences

- The walk uses the shipped code path; nothing is patched to get the stop.
- `bun test src/server/dispatch/dry-submit.test.ts` proves the flag parsing, the production refusal (module and env
  schema), the screenshot-then-stop order, the untouched normal send, and that fifty dry attempts trip no kill switch.
- Deleting the switch later is one env var and one module; no stored data depends on it beyond the historical attempt
  outcome.
