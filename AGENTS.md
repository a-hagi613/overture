# Agent instructions

Overture finds jobs for one person, prepares every application and sends it when you approve, and shows its work.

## The tools are the rules

Lint, format, typecheck and tests define what is allowed. ADR 0023 lists the rules and ADR 0013 the testing rules.

- **Local inner loop (seconds, zero heavy queue):** batch edits, run ONLY fast `bun fmt` (`~0.3s`) and targeted unit tests (`bun test src/...`, `~1–2s`) locally. Do **not** run local `bun lint`, `bun check`, `bun run build`, or `bun run verify` during parallel build waves.
- **Instant pre-push (`~0.3s`) + authoritative CI `gate`:** `.githooks/pre-push` runs `bun fmt --check` (`0.3s`) and defers full 7-check `verify` (`scripts/verify.ts` runs `lint`, `format`, `typecheck`, `unit`, `build`, `lint-config`, `db` in parallel) to GitHub Actions `gate` (set `OVERTURE_LOCAL_VERIFY=1` if opting into local pre-push verify + stamp). Never use `--no-verify`.
- **Single-sweep CI fix:** watch `gh pr checks <n> --watch --fail-fast`. If `gate` fails, fetch the **full** failed log (`gh run view <id> --log-failed` — NEVER truncate with `tail`), read EVERY error across all 7 parallel checks at once, fix EVERY error in ONE edit batch + ONE commit, run `bun fmt` + targeted `bun test`, and push once so Push #2 is 100% green.
- **Playwright e2e:** off locally during parallel build waves (fast delta CI handles browser regression). Run local browser Playwright ONLY when authoring/editing a browser spec or capturing required `390/1280` UI screenshots, always a single spec file with `--workers=1`.
- Done means CI `gate` (`verify` 7/7 checks), required CI shards, and CodeQL are 100% green, and you paste the CI verification summary in your report; e2e and the container build run in CI.
- The commands are `bun lint`, `bun fmt --check`, `bun check`, `bun test src`, `bun run build`, `bun run lint:config`
  and `bun run db:verify`; `bun run verify` runs them all in parallel. `bun run lint:parity` compares lint findings with
  a canary Bun.
- Never disable, weaken or work around a rule. If a rule is wrong, say so on the issue; changing it needs an ADR.

## Read first

The issue you are working on and its parent, `GLOSSARY.md`, `docs/SPEC.md`, `DESIGN.md`, and the ADRs in
`docs/adr/` that touch your area. The issue and the spec beat the code; a gap in the spec is raised on the issue,
not guessed.

## UI work

`DESIGN.md` is the single source of truth for visual identity, and `.claude/rules/ui.md` records the order of
authority: `docs/SPEC.md` for product, `DESIGN.md` for look, installed skills as guardrails that never override a
token or identity rule. Every text element uses one of the nine typography tokens; the lint rule enforces it across
`src/web`.

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

### Independent review (Greptile & CodeQL)

Greptile is **OFF during active build waves** (neither workers nor the orchestrator post `@greptileai`; reserve remaining monthly credits for an optional pre-launch audit). Automatic GitHub **CodeQL** (`.github/workflows/codeql.yml`) covers security scanning on every PR in parallel with CI: fix real High/Medium security findings, and push back with clear reasoning on verifiable false positives or low-impact test-only warnings.
