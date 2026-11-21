# Recorded Ashby form fixture

`clera-0a278229-474e-4534-82d0-ebfafe18ad9d.form.json` is the `ApiJobPosting` response for the same
posting whose rendered page is recorded in `clera-0a278229-474e-4534-82d0-ebfafe18ad9d.fixture.html`.
`volta-123e02c6-445b-42bb-893c-addb1f6d4752.form.json` and
`highlightta-1e4f70e2-9d0a-455e-9b08-e84b301e37e6.form.json` do the same for their recorded pages.

The field data (labels, paths, types, required flags and options) is taken from those recordings. The
GraphQL envelope follows Ashby's public `ApiJobPosting` operation, because the development machine never
contacts an ATS (ADR 0016) and the plain-HTTP form read in production is the GraphQL call, not the SPA
shell. Nothing here was submitted, and no personal data is included.
