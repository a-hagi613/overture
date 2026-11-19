# Overture

A job-search agent that applies to jobs for one person, automatically, and shows its work. It finds
postings from ATS job feeds, scores them against the user's resume, prepares each application from the
user's own facts, writes the cover letter, and submits it through the employer's real ATS form in a
managed cloud browser.

No code exists yet. The repository holds the specification and the owner's seed data.

| File | What it is |
|---|---|
| `DESIGN.md` | Visual design system. Authority on appearance |
| `docs/v2/SPEC.md` | Product and architecture specification. Authority on what exists |
| `docs/v2/DECISIONS.md` | Why, with the rejected alternative for each decision |
| `docs/v2/GLOSSARY.md` | The words, used exactly in code and copy |
| `docs/v2/GRILL-BRIEF.md`, `docs/v2/research/` | The question set behind the spec, and the evidence |
| `profile/` | The owner's resume, answer bank and cover-letter template, seed data for the importer |
| `AGENTS.md`, `CLAUDE.md` | Instructions for coding agents |

Precedence: the spec beats the code, and `DESIGN.md` beats the code on appearance.
