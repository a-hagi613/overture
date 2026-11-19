# Overture

A job-search agent that applies to jobs for one person, automatically, and shows its work. It finds
postings from ATS job feeds, scores them against the user's resume, prepares each application from the
user's own facts, writes the cover letter, and submits it through the employer's real ATS form in a
managed cloud browser.

No code exists yet. The repository holds the specification and the owner's seed data.

| Where | What |
|---|---|
| GitHub Issues | Specs and tickets: the source of truth for what is being built |
| `docs/SPEC.md` | Product and architecture reference |
| `DESIGN.md` | Visual design system, with the canvas boards as the wireframe |
| `GLOSSARY.md` | The words, used exactly in code, copy, issues and commits |
| `docs/adr/` | Decisions that are hard to reverse, and why |
| `docs/SALVAGE.md` | The only v1 logic that may be ported, and where it goes |
| `docs/research/` | Evidence behind the browser and tagging choices |
| `docs/agents/` | Configuration for the engineering skills: issue tracker, labels, domain docs |
| `profile/` | The owner's resume, answer bank and cover-letter template, seed data for the importer |
| `AGENTS.md` (`CLAUDE.md` links to it) | The contract for coding agents |

Precedence: the spec beats the code, and `DESIGN.md` beats the code on appearance.
