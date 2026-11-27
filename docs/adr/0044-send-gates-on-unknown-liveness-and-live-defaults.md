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

## 2026 pages: the form is behind an Apply control, and selects are widgets

The #710 rerun next reached BambooHR and Zoho Recruit. BambooHR stopped on four postings and Zoho Recruit on one:
BambooHR reported `form_changed` (the dispatcher's normalised name for `form_missing`) and Zoho reported
`identity_mismatch:board_token`.

- **BambooHR moved to the Fabric form.** The careers page now opens on the job description and adds
  `form#job-application-form` only after the "Apply for This Job" button is pressed. Its Submit is in the page footer,
  outside the form root, with `form="job-application-form"`. Province and Country are popup widgets (`button.fab-SelectToggle`
  plus a hidden `select` and a `role=listbox` menu), the date is a masked `dd/mm/yyyy` text field, and a second file
  upload is the optional Cover Letter. The detail JSON already carries these fields, but the live controls do not
  expose their values or options through the native element.
- **Zoho Recruit moved to the career-site webform.** It starts on the job description behind a cookie notice, opens
  the form from "I'm interested", and renders a nameless `<form>` whose fields are custom `crux-*` components.
  Gender and country picklists are `crux-picklist-component` popups, the address lines are dropdown-bound inputs, and
  the phone needs its country picker committed before the number survives a re-render.
- **Freehire names Zoho's board by its whole host.** `external_id` is `icschools.zohorecruit.com:<job>`, so the plan's
  `boardToken` is the host while the live posting URL yields the `icschools` subdomain. Both name the same board; the
  comparison now canonicalises a board-host token to its subdomain for the boards that render on their own host.

The preflight reads and drives those widgets through their own toggle and menu: it opens a popup to discover its
options (so the changed-option guard still compares the live set), fills an answer by clicking the option, reads the
visible selection back, and only falls back to the native input when a widget exposes one. Dates compare by day, month
and year, so the ISO approved answer matches a `dd/mm/yyyy` or `mm/dd/yyyy` field. A field whose live widget is
unsupported is still a genuine change if the plan answered it; the guard is not relaxed.

The Apply click, the consent click and the "I'm interested" click only advance the same posting's page. They never
write an answer or press Submit, and the dry-submit switch still throws before the Submit click.

