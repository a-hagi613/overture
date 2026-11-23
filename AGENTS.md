# Agent instructions

Overture finds jobs for one person, prepares every application and sends it when you approve, and shows its work.

## The tools are the rules

Lint, format, typecheck and tests define what is allowed. ADR 0023 lists the rules and ADR 0013 the testing rules.

- **Inner loop while editing (seconds, no heavy queue wait):** batch edits, run `bun fmt` (`~0.3s`) and targeted unit tests (`bun test src/...`, `~1s`) as you go. Never run `bun lint --fix`, `bun check`, `bun run build`, or `bun run verify` after every edit.
- **Pre-push gate (once at the end):** run `bun lint --fix`, `bun fmt`, and ONE `bun run verify` (writes the `HEAD+tree` verify stamp so `.githooks/pre-push` validates in `< 0.2s` instead of running `verify` twice).
- **Playwright e2e:** off by default locally (fast delta CI handles browser regression). Backend/API PRs may run targeted non-browser e2e; browser Playwright runs locally ONLY when authoring/editing a browser spec or capturing required `390/1280` UI screenshots, always a single spec file with `--workers=1`. Never use `--no-verify`.
- Done means `bun run verify` passes locally, and you paste its summary in your report; e2e and the container build run in CI.
- The commands are `bun lint`, `bun fmt --check`, `bun check`, `bun test src`, `bun run build`, `bun run lint:config`
  and `bun run db:verify`; `bun run verify` runs them all in parallel. `bun run lint:parity` compares lint findings with
  a canary Bun.
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

### Independent review (Greptile)

Greptile is installed on this repository and runs **on request only** (`.greptile/config.json` sets `autoReview: []`; there are 50 credits a month).

- Ask for a review on anything high-risk or substantial (auth, billing/ledger, migrations, job recovery/shutdown, deploy/CI, shared contracts, cross-cutting refactors over ~300 lines or ~15 files) with `gh pr comment <n> --body "@greptileai review this pull request"`; add `review this at plus` for extra depth. Ask for `apex` only with the orchestrator's approval.
- Skip it for docs, copy, formatting, version bumps and single-file fixes with tests.
- Wait for the review, fix P0/P1 before `worker_done`, reply with reasoning for anything intentionally not fixed, and never weaken a rule or test to satisfy it.
- The full protocol, tiers, waiting times and the spend line are in `docs/agents/greptile-review.md`.
