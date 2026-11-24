---
status: accepted
---

# Two-stage matching with lazy scoring on Claude Haiku

Code filters and ranks every candidate Posting for free; Claude Haiku 5.5 scores candidates in rank order only until today's remaining slots are filled above the threshold plus a small buffer, and caches each score per resume and targets version. Postings a user opens are scored on open. Haiku is the only production model, behind `LlmPort`, with per-user and global daily budgets that fail closed: a base plus a share for each paying subscriber, so paid growth raises the ceiling instead of halting it (issue #564).

## Considered Options

- Scoring every candidate: about 15 times the cost for no extra sends.
- No LLM in matching: code alone cannot judge fit well enough to send on its own.
