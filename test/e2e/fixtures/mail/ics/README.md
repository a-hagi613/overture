# Interview `.ics` fixtures

These are reconstructed, not captured, employer invitations: no real recorded `.ics` exists in the repository yet
(approved by the coordinator on 2026-11-21). Each file follows RFC 5545 and the shape Greenhouse, Lever and Ashby send
for an interview invite: a `VCALENDAR` with `PRODID`, `METHOD`, a `VTIMEZONE` block where the invite carries a `TZID`,
and a `VEVENT` with `UID`, `SEQUENCE`, `DTSTAMP`, `DTSTART`, `DTEND`, `SUMMARY`, `ORGANIZER` and `ATTENDEE`. Replace a
file verbatim once a real captured invite arrives in beta; the tests assert absolute UTC instants, so a replacement
with the same people and dates keeps them valid.

| File | Covers |
|---|---|
| `greenhouse-invite.ics` | `METHOD:REQUEST`, `UID`, `SEQUENCE:0`, `DTSTART;TZID=America/New_York` |
| `greenhouse-update.ics` | the same `UID` rescheduled with `SEQUENCE:1` |
| `greenhouse-stale.ics` | the same `UID` again with the older `SEQUENCE:0`, which must not win |
| `greenhouse-cancel.ics` | `METHOD:CANCEL` and `STATUS:CANCELLED` with `SEQUENCE:2` |
| `greenhouse-cancel-stale.ics` | a cancellation with the older `SEQUENCE:0`, which must not remove the rescheduled row |
| `lever-floating.ics` | `DTSTART` with no `Z` and no `TZID`, a floating time read in the user's timezone |
| `ashby-sydney.ics` | `DTSTART;TZID=Australia/Sydney` in daylight-saving time |
| `greenhouse-unlinked.ics` | an invite for an employer with no Application, which must not reach the Calendar |

The forwarded mail around them is built in `test/e2e/calendar-api.test.ts`; only the calendar part is a file.
