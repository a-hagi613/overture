# Calendar: a month view of the job pipeline

The owner wants a Calendar destination beside Inbox: a month grid showing, per day, the Applications sent that day and
the pipeline events (Stage moves, Check-ins, interview dates from forwarded ATS mail), kept current as Stages move.
They suggested a shadcn calendar. This note picks the component, the data model, the UX and what to do about `.ics`.
It changes no code. The decision is proposed in ADR 0034.

Sources: npm registry metadata read on 2026-11-21 (`npm view`), `ui.shadcn.com/docs/components/calendar`,
`daypicker.dev/guides/accessibility`, `fullcalendar.io/license`, and this repo (`package.json`, `src/web`,
`src/server/platform/db/schema.ts`, `docs/SPEC.md` §11.3 and §14). `schedule-x.dev` returned 502 on the day, so its
figures are from npm only.

## Short answers

- **Component: build our own month grid** (plain Tailwind, `Intl`/`Date` maths, no new dependency). shadcn Calendar is
  react-day-picker, a date _picker_, not an event calendar.
- **Data: no new table for sent, Stage and Check-in events**; one new table, `interview_events`, for dates parsed from
  mail. One read endpoint, `GET /api/calendar?from&to`.
- **UX:** month grid with per-day dots and counts, a day panel (side panel on desktop, sheet on the phone); at 390 px
  the grid collapses to an agenda list.
- **`.ics` feed:** later (M4), read-only, per-user signed URL. Google Calendar OAuth: not planned; the feed covers it.

## 1. Component

What the repo has: React 19, Tailwind 4, Vite 8, React Router, TanStack Query, lucide-react. There is **no shadcn, no
Radix, no `components.json` and no date library** in `package.json`. Every screen is hand-built to match a canvas board
pixel for pixel (ADR 0021, `DESIGN.md` §13), with our own tokens (`--need`, `--ok`, `shadow-sh`).

| Option | Version / license | Size (npm unpacked) | Fit |
|---|---|---|---|
| shadcn Calendar | wraps `react-day-picker` 10.0.2, MIT; needs `date-fns` ^4.1 and `@date-fns/tz` | package 0.99 MB; `date-fns` 10.9 MB on disk (tree-shaken in a build, but two new runtime deps) | A date picker: one selectable cell per day. Events per cell mean custom `Day` renderers over a widget built for choosing a date. The shadcn wrapper also brings shadcn's own styling, which our boards would override. |
| FullCalendar | MIT core and `daygrid`; v7.1.5 needs `temporal-polyfill`. Premium plugins (timeline, resource views) are separately licensed, which we do not need | `@fullcalendar/react` 1.4 MB, `daygrid` 6.1 0.2 MB | Full-featured, but it brings its own DOM and CSS, drag and drop and a view engine we do not use, and its markup fights the canvas. Biggest bundle of the four. |
| Schedule-X | MIT core, v4.9.1; Preact + signals + `temporal-polyfill` as peers | `@schedule-x/calendar` 1.07 MB | A second UI runtime (Preact) inside a React app. Same styling fight. |
| **Own month grid** | ours | a few KB of code, 0 deps | Matches the canvas exactly; we need only a 6×7 grid, a header and per-day chips. |

Accessibility: `daypicker.dev/guides/accessibility` documents keyboard navigation, focus management and screen-reader
labelling for react-day-picker, which is its strength, but it applies to choosing a date. We get the same result for a
read-only event grid with the WAI-ARIA grid pattern: `role="grid"`, one `role="gridcell"` per day with an accessible name
("Tuesday 18 November, 2 applications sent, 1 interview"), roving tabindex, arrow/Home/End/PageUp/PageDown keys, Enter
opens the day. We also own the contrast (§10 of `DESIGN.md`) and the 44 px target.

Mobile 390: the grid cannot show event text at 7 columns of about 50 px, so the phone shows the agenda list (§3).
Libraries would do the same with extra config.

**Pick: our own month grid.** Dates come from `Intl.DateTimeFormat` with the user's saved timezone
(`users.timezone`), bucketed on the client. Reconsider a library only if we later need week/day time-grids or drag to
reschedule; none of that is in scope.

## 2. Data model

Every event except interview dates already exists:

| Calendar item | Source | Notes |
|---|---|---|
| Application sent | `applications.sent_at` (index `applications_user_sent_at`) | joined to the snapshot's `posting_title` and the company name; links to the card |
| Stage move: screening, interviewing, offer, closed | `application_events` where `kind = 'stage'`, `at`, `from_value`, `to_value`, `source` (`user`, `email`, `checkin`, `system`) | `detail` can carry the closed reason. Undone moves (`POST /api/applications/:id/undo-stage`) write a later event; the client shows the latest per application per day |
| Check-in due / answered | `checkins.due_at`, `status`, `answer` | an open Check-in appears on its due day; an answered one on the day of its `application_events` row (`kind = 'checkin'`) |
| Interview date | **new table** | see below |
| Inbox messages | `messages.created_at`, `classification` | not shown as their own items: a classified `interview` message already produced a Stage event; the Inbox is the place for mail. Avoids two entries for one fact |
| Scheduled send | `applications.scheduled_for` | optional "will send" ghost chip on future days; leave for a later slice |

Why a new table: a Stage move happens when the mail _arrives_, but the interview is on a different, future date that is
only in the message. SPEC §11.3 already classifies scheduling links and `.ics` attachments as `interview`; nothing
stores the date.

```
interview_events
  id, user_id (cascade), application_id (cascade), message_id (cascade),
  uid, sequence (default 0),
  starts_at INTEGER NOT NULL, ends_at INTEGER NULL, tz TEXT NULL,
  source TEXT CHECK IN ('ics') NOT NULL,
  created_at INTEGER NOT NULL
  UNIQUE(user_id, uid); INDEX(user_id, starts_at); INDEX(message_id)
```

STRICT table, next free migration number taken at build time. `uid` and `sequence` are stored so an invite can be
recognised across messages; the built table leaves out the sketch's `title_enc` because the Calendar shows the job title
and company only, so no mail text needs to be kept for it. Parsing: only a `text/calendar` attachment
(`message_attachments.mime`) or a file named `.ics` with a `VEVENT` and `DTSTART` is trusted (`source = 'ics'`); `TZID`
is honoured, a floating time uses the user's timezone. Free-text dates ("Tuesday at 3pm") are **not** parsed in v1 (error
rate, no recordings to test against, and no synthetic data in tests, ADR 0013); the Calendar shows no interview rather
than a wrong one. A rescheduled invite (same `UID`, higher `SEQUENCE`) replaces the earlier row; a `METHOD:CANCEL` or
`STATUS:CANCELLED` deletes it. No new third-party dependency is needed for this: the parser is a small in-repo RFC 5545
reader (`src/server/inbox/ics.ts`) for the three properties, tested through realistic RFC 5545 fixtures (`test/e2e/fixtures/mail/ics`) that are reconstructed until a captured employer invite replaces them.

API (Hono, Zod, typed client, SPEC §14):

`GET /api/calendar?from=<ISO>&to=<ISO>` (at most 42 days, the visible grid) returns
`{ items: [{ id, kind: 'sent'|'stage'|'checkin'|'interview', at, applicationId, title, company, stage?, closedReason?, source? }] }`
ordered by `at`. It reads only the signed-in user's rows, and returns no mail body or answers (ADR "never in anything a
user can read"). Live updates: invalidate the query on the existing SSE topics `application.updated` and `board.moved`
and add `calendar.updated` only for new interview rows. No new job or poller.

## 3. UX

- **Nav:** Calendar after Inbox on the desktop side nav (Home, Ready, Board, Review, Inbox, **Calendar**, Profile).
  The phone tab bar already holds six; a seventh at 390 px is too tight, so on the phone Calendar is reached from a
  header link on Home and Board (open question for the Draw ticket).
- **Desktop:** header with month name, previous/next and Today; 7×6 grid; each day shows up to three colour-coded chips
  (sent = ink, interview = signal, offer = ok, closed = muted, Check-in = need) and "+N"; today is ringed; weekends
  muted; first day of week follows the user's locale. Clicking a day opens a right-hand panel listing that day's items
  in time order, each linking to the card.
- **Phone (390):** a month strip (dots only) over an agenda list grouped by day, today scrolled into view; tapping an
  item opens the existing card sheet.
- **Empty states:** a new user sees the grid with the line "Nothing yet. Applications you send and replies from
  employers appear here." An empty day panel says "Nothing on this day."
- **Dark mode:** tokens only; no new colours. Chips use the same `--ok`, `--need`, `--signal` pairs as the Board.
- **Copy:** Stage names and "Check-in" follow `GLOSSARY.md`; no "Hold".
- Boards must be drawn first (ADR 0021): month desktop, day panel, phone agenda, empty, dark.

## 4. `.ics` and Google Calendar (optional, later)

- **Read-only `.ics` subscription feed**, M4. `GET /calendar/<token>.ics` where the token is a random 32-byte value
  stored hashed in a `calendar_feed_tokens` table (revocable, rotatable in Settings). A signed URL is a bearer secret:
  calendar apps cannot send our session cookie. Mitigations: show it once, rotate on request, never log it, and keep
  titles minimal (job title and company only; no answers, no mail text). Employer names are personal data, so the
  Settings copy says anyone with the link can read them.
- **Google Calendar:** subscribing to that feed (Google's "From URL") is enough; Google refreshes it on its own
  schedule, often several hours, which suits a job pipeline. Do **not** add Google OAuth: the calendar scopes need
  Google's verification, and ADR 0028 chose not to take Google scopes for mail. Revisit only if users ask for write-back.
- Testing-phase cost (ADR 0033): none; the feed is one SQLite read.

## Build slices (tickets)

1. Draw: Calendar (canvas, owner).
2. `GET /api/calendar` for sent, Stage and Check-in items, with tests on the recorded data.
3. Calendar page: month grid, day panel, keyboard and a11y, live invalidation, nav entry.
4. Phone agenda view and the empty and dark states.
5. `interview_events` migration and the `.ics` attachment parser, fed from inbound mail.
6. (M4) read-only `.ics` feed with signed token.
