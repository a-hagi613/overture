---
status: proposed
---

# A Calendar destination: our own month grid over existing events

Draft from `docs/research/calendar.md`. The owner drew and published the boards (#292) and opened the build tickets
(#293–#297); it is built in slices: the boards and `GET /api/calendar` are done, the page, phone agenda and interview
dates from mail follow.

## Context

The owner wants a Calendar beside Inbox showing, per day, Applications sent and pipeline events, kept current as Stages
move, and suggested a shadcn calendar. The repo has no shadcn, Radix or date library (React 19, Tailwind 4), and every
screen is drawn on the canvas first (ADR 0021).

## Decision

- **Build our own month grid** with Tailwind and `Intl`; add no calendar library. shadcn Calendar is react-day-picker,
  a date picker; FullCalendar and Schedule-X bring their own runtime and styling for features we do not need.
- **Reuse existing data**: `applications.sent_at`, `application_events` (Stage), `checkins`. Add one table,
  `interview_events`, filled only from a `text/calendar` attachment on forwarded ATS mail. Free-text dates are not parsed.
- **One endpoint**, `GET /api/calendar?from&to`, scoped to the user, no mail bodies or answers; updates through the
  existing SSE topics.
- **Placement**: a seventh destination after Inbox on the desktop nav, which amends ADR 0029's six. On the phone it is
  reached from Home and Board, not the tab bar, unless the board shows otherwise.
- **Phone**: agenda list at 390 px; month grid from the tablet width up.
- **Later, M4**: a read-only `.ics` feed on a revocable signed URL. No Google Calendar OAuth.

## Considered Options

- shadcn Calendar (react-day-picker 10 + date-fns): rejected, a picker, two new runtime dependencies.
- FullCalendar 7 / Schedule-X 4: rejected, size and a competing UI runtime.
- Parsing dates from message text: rejected for v1, no recordings and a wrong date is worse than none.
- Google Calendar write-back: rejected, scope verification cost and ADR 0028.

## Consequences

DESIGN.md §13 gains a Calendar board row; SPEC §14 gains the route; GLOSSARY gains nothing. The Calendar ships only
after the Draw ticket.
