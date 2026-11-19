---
status: accepted
---

# Fresh repository; port v1 logic, not v1 structure

Overture v2 starts in a new repository so every commit is v2 and no session learns v1's architecture or vocabulary. v1 (`a-hagi613/ai-auto-apply`) stays read-only; only the logic listed in `docs/SALVAGE.md` (ATS feed clients, form-filling engine, per-ATS flows, posting guard, code extractor, envelope encryption) is rewritten into the v2 layout. The v1 database is not migrated: one export of boards and the owner's answers feeds a fresh schema.

## Considered Options

- Burning v1 in place on a `v2` branch: every agent would still have had to be told which half of the tree to ignore.
- Porting v1 modules whole: they carry the runner, Hold and Workspace patterns this repository exists to leave behind.
