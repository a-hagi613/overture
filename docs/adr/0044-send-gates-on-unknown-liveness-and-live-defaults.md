---
status: accepted
---

# Unknown liveness does not block a send, and preflight judges the filled form

This records the two send-gate fixes from the #710 walk (issues #756 and #757). It amends the pre-send liveness
re-check in SPEC §9.3 and the live-form preflight rule in ADR 0029.

## Context

The first real walk reached Ready and approval on two ATS families but never started a send.

- **#756.** `createPostingLiveness` answered `unknown` for Personio and every batch-four/wave-two board, and the
  dispatcher treated `unknown` as blocked. The dispatcher also carried a hand-written ATS list that omitted JazzHR,
  BambooHR, Zoho Recruit, Manatal, Recruitee and SmartRecruiters, so even a supported adapter could never be claimed.
  A due JazzHR Application stayed `approved` across ticks.
- **#757.** The first live Greenhouse/Lever attempt stopped before Submit with `value_mismatch:phone`,
  `field_missing:resume`, `option_not_selected:country` and `option_not_selected:candidate-location`. The resume is a
  visually hidden file input, the country/city selects are react-selects that are still empty when the live form is
  read, and a phone widget formats the approved number before it settles.

## Decision

**Only a confirmed closed posting blocks a send.** A board with no liveness source is `unknown`, which is recorded in
the dispatch log and then sent. `closed` still skips the Application and closes the catalog row.
The liveness checker answers for the boards that have a source (Greenhouse, Lever, Ashby) and says `open` for Workable
from its daily snapshot; it never falls through to another board's API, because another board's 404 is not evidence
that this posting closed.

**The dispatcher claims every board with a shipped apply adapter.** Dispatch reads the shared apply-supported registry
instead of maintaining its own subset, so adding an adapter makes it sendable.

**Preflight judges the filled form, not the ATS's intermediate state.** Before it compares the plan, preflight
re-applies the approved answer to any control that is still at its untouched default: an empty option control, a blank
text field, or a phone holding only a dial code. Only approved answers are written, and only into controls the plan
already owns. File expectations match the file input the upload landed in even when that input is hidden and carries
no useful label. Phone values compare by digits, ignoring the ATS's formatting and a leading `1` country code. A
control whose id or name changed still matches by its exact approved label.

The guard is not weakened. A new required question still opens a Review, a changed option set still reports
`option_missing`, a field removed from the form still reports `field_missing`, and a control holding a genuinely
different value is never overwritten and still stops the send.

## Consequences

- An Application on Personio, JazzHR, BambooHR, Zoho Recruit, Manatal, Workable, Recruitee, SmartRecruiters or any
  other shipped adapter can now be claimed and sent; the send may be the first signal that its posting closed, and a
  form that is gone ends as a form change rather than a silent `approved` row.
- Dispatch logs `posting liveness unknown; sending anyway` for each such claim, so the gap in liveness coverage
  stays visible.
- ATS adapters no longer abort on a single failed field fill before preflight has seen the form. Personio, Ashby and
  the hosted batch adapters keep their own fill-failure handling; Greenhouse and Lever let preflight decide, and Lever
  still stops when its location suggestion never committed the backing id the form needs.
- Changing a question's wording changes its label, so the exact-label fallback no longer matches it; that is a form
  change and still returns the Application to Ready, as ADR 0029 requires.
