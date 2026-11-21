# Recorded Ashby form fixture

`clera-0a278229-474e-4534-82d0-ebfafe18ad9d.form.json` is the `ApiJobPosting` response for the same
posting whose rendered page is recorded in `clera-0a278229-474e-4534-82d0-ebfafe18ad9d.fixture.html`.

The field data (labels, paths, types, required flags and options) is taken from that recording. The
GraphQL envelope follows Ashby's public `ApiJobPosting` operation, because the development machine never
contacts an ATS (ADR 0016) and the plain-HTTP form read in production is the GraphQL call, not the SPA
shell. Nothing here was submitted, and no personal data is included.
