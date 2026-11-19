---
status: accepted
---

# Only Browser Use browsers reach real application forms

Every request that loads or submits an employer's form comes from a Browser Use browser controlled by `overture-web`. `overture-web` itself calls only the ATSes' public job-feed APIs. The development machine never contacts an ATS, a job site or a Browser Use session: real forms reach development only as fixtures captured by an admin-started job on Fly (never submitting) and pulled from R2.

## Considered Options

- Developer-driven Browser Use sessions for capture and smoke tests: a second path to real forms to keep safe.
