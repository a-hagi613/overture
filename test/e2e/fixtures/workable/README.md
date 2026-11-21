# Workable fixtures

`workable-trim.xml.gz` was recorded from production by the orchestrator on 2026-11-21T11:15:27Z, in one streamed
pass (`Last-Modified: Sat, 21 Nov 2026 11:15:27 GMT`). No development machine contacted Workable (ADR 0016). It holds
300 real `<job>` blocks in the feed's real structure and ends on `</source>`.

The recording contained five recruiter email addresses. They were replaced before committing, and everything else is
byte-for-byte unchanged:

- `Ramesh@two95intl.my` (four occurrences) → `recruiter@example.com`
- `katia.panits@cbtalents.de` (one occurrence) → `talent@example.com`

`targets.json` is the target union the e2e test passes to the real pass. The pass keeps 87 of the 300 postings.

## Application forms

`forms/WK-1001.form.json` is the shape of an application form from Workable's public form endpoint,
`GET https://apply.workable.com/api/v1/jobs/{shortcode}/form`, as documented by Workable and by third-party readers
of that endpoint. It is **not a production recording**: it was written from the documented shape while the 20-form
probe waits for the orchestrator's capture (see the ask on issue #235). The fields it carries are the ones a send
must exercise: standard text and email fields, a resume upload, a boolean screening question, a dropdown, and a
consent question.

A `group` control (education, experience) is not in the fixture: the reader skips it whole, because it is a
repeatable compound rather than one answerable control, and a required group stops the send as a form change.

The e2e fixture server renders its page from that same JSON, so the plain read and the page cannot drift apart in a
test; the form-change test omits one field from the rendered page only. When the real recordings arrive, replace this
file with them (and the rendered page with the recorded page) before turning Workable's kill switch off.
