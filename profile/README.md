# Owner profile

Everything the owner keeps here (the probe run file, the resume, the answer bank,
the cover letter template) is personal data. Per the SPEC, personal data is never
committed to this repository: these files live privately in `~/overture-private/`
on the owner's machine (and are uploaded to the Fly volume only for a probe run,
then deleted — see `docs/DEPLOY.md`).

Test code uses the fake run file at `test/e2e/fixtures/probe-run.fixture.json`
(Jane Doe / jane.doe@example.com) instead of any real identity.
