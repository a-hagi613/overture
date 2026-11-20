# Agent instructions

Overture applies to jobs for one person, automatically, and shows its work.

## The tools are the rules

Lint, format, typecheck and tests define what is allowed. ADR 0023 lists the rules and ADR 0013 the testing rules.

- After every change: `bunx oxlint --fix`, then `bunx oxfmt`.
- Done means `bunx oxlint --deny-warnings --format=agent` reports zero, and format, typecheck, build and tests pass.
- Never disable, weaken or work around a rule. If a rule is wrong, say so on the issue; changing it needs an ADR.

## Read first

The issue you are working on and its parent, `GLOSSARY.md`, `docs/SPEC.md`, `DESIGN.md`, and the ADRs in
`docs/adr/` that touch your area. The issue and the spec beat the code; a gap in the spec is raised on the issue,
not guessed.

## Work

- One issue, one branch from `main`, one pull request with `Closes #<n>`. Merge only on green CI.
- When reality differs from the spec or an ADR, update it in the same pull request.
- Never print or commit secrets or `.env`.

## Agent skills

### Issue tracker

GitHub Issues on `a-hagi613/overture`, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repository root. See `docs/agents/domain.md`.
