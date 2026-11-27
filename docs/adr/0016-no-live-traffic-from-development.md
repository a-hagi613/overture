---
status: accepted
---

# Only Browser Use browsers reach real application forms

Every request that submits an employer's form comes from a Browser Use browser controlled by `overture-web`.
`overture-web` itself may also *read* a form without a browser to prepare an approval card (ADR 0029, #193):
Lever's server-rendered apply page, Ashby's public `ApiJobPosting` GraphQL operation, Workable's public
`/api/v1/jobs/{shortcode}/form` endpoint, and the ATSes' public job-feed APIs. Those reads never fill a field or
Submit. The development machine never contacts an ATS, a job site or a Browser Use session: real forms reach
development only as fixtures captured by an admin-started job on Fly (never submitting) and pulled from R2. Probes
run on the development machine use `.invalid` hosts only. The synthetic lab's challenge pages (`/lab/*`)
load their vendor scripts and post their reCAPTCHA score to URLs that environment variables override; tests and
development point them at same-origin stubs and a local recorded siteverify, so a lab run contacts no challenge
host either (issue #36).
Outside production, the app installs an outbound guard (#261): any request to an ATS or paid-service host that is
not a local fixture throws `LiveServiceRequestError` instead of leaving the machine.

## Considered Options

- Developer-driven Browser Use sessions for capture and smoke tests: a second path to real forms to keep safe.
- Reading Lever and Ashby forms only through a browser session (the first ruling): correct, but it spends a
  Browser Use session on every new form; a plain read is free and still leaves the browser only the Submit.
  Amended by #193.

*Amendment of 2026-11-26 (#695, #706): the synthetic lab and its `/lab/*` challenge pages are removed with the daily
live checks. The rule is unchanged: development reaches no real form, and tests replay fixtures through the same
capture-and-pull path. The outbound guard and the fail-closed test interceptor are the enforcement.*
