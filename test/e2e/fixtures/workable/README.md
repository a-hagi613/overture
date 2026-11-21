# Recorded Workable feed

`workable-trim.xml.gz` was recorded from production by the orchestrator on 2026-11-21T11:15:27Z, in one streamed
pass (`Last-Modified: Sat, 21 Nov 2026 11:15:27 GMT`). No development machine contacted Workable (ADR 0016). It holds
300 real `<job>` blocks in the feed's real structure and ends on `</source>`.

The recording contained five recruiter email addresses. They were replaced before committing, and everything else is
byte-for-byte unchanged:

- `Ramesh@two95intl.my` (four occurrences) → `recruiter@example.com`
- `katia.panits@cbtalents.de` (one occurrence) → `talent@example.com`

`targets.json` is the target union the e2e test passes to the real pass. The pass keeps 87 of the 300 postings.
