# Agent instructions

Overture finds jobs for one person, prepares every application and sends it when you approve, and shows its work.

## The tools are the rules

Lint, format, typecheck and tests define what is allowed. ADR 0023 lists the rules and ADR 0013 the testing rules.

- **Local inner loop (seconds, zero heavy queue):** batch edits, run ONLY fast `bun fmt` (`~0.3s`) and targeted unit tests (`bun test src/...`, `~1–2s`) locally. Do **not** run local `bun lint`, `bun check`, `bun run build`, or `bun run verify` during parallel build waves.
- **Instant pre-push (`~0.3s`) + authoritative CI `gate`:** `.githooks/pre-push` runs `bun fmt --check` (`0.3s`) and defers full 7-check `verify` (`scripts/verify.ts` runs `lint`, `format`, `typecheck`, `unit`, `build`, `lint-config`, `db` in parallel) to GitHub Actions `gate` (set `OVERTURE_LOCAL_VERIFY=1` if opting into local pre-push verify + stamp). Never use `--no-verify`.
- **Single-sweep CI fix:** watch `gh pr checks <n> --watch --fail-fast`. If `gate` fails, fetch the **full** failed log (`gh run view <id> --log-failed` — NEVER truncate with `tail`), read EVERY error across all 7 parallel checks at once, fix EVERY error in ONE edit batch + ONE commit, run `bun fmt` + targeted `bun test`, and push once so Push #2 is 100% green. CI fails fast across e2e shards: one failing shard cancels the rest.
- **Box resource queue (`heavy`):** heavy commands (`tsgolint` ~1.5 GB / 150%+ CPU, `vite build`, Playwright, `bun run verify`) route through `~/.local/bin/heavy` via the box `bun`/`bunx` shims — never invoke `~/.bun/bin/bun` directly or set `HEAVY_HELD=1` manually.
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

### Front-end review gate

Any PR that touches the web UI (`src/web`, styles, copy) must pass three gates before merging:

1. **CI layout & accessibility guards:** no horizontal overflow or sway across `390–2560`, no stray scrollbars, fixed sidebar, pointer/hover/focus states on every control, zero canvas annotation text (`"Fig N"`, `"Folio NN"`), and zero axe violations.
2. **Real-UI end-to-end flow:** every changed user flow (sign-up, sign-in, onboarding with a mock PDF to the end, Ready/approve/send, Board, Inbox, Profile, Settings) has a Playwright e2e test walking the real UI from a fresh user, not seeded shortcuts.
3. **Screenshots & self-review:** capture `390px` and `1280px` light + dark screenshots (single spec, `--workers=1`), attach links on the PR, and run `design:design-critique` and `design:accessibility-review` (or documented installed equivalents when the `design:*` pack is absent) against canvas boards for orchestrator Yes/No sign-off.
4. **Canvas discipline:** visual changes go on the canvas first (by a draw worker), then in code; canvas boards are references for design and product copy only — never copy board labels, captions, or section numbers.

## Work

- One issue, one branch from `main`, one pull request with `Closes #<n>`. Merge only on green CI.
- When reality differs from the spec or an ADR, update it in the same pull request.
- Never print or commit secrets or `.env`.

### Parallel wave & merge specifics

- **No concurrent `docs/SPEC.md` edits:** feature PRs in parallel waves must NOT edit `docs/SPEC.md` (prevents `DIRTY` rebase storms); sync `docs/SPEC.md` in one clean wave-end PR per wave.
- **High-risk PRs require orchestrator `YES, MERGE NOW`:** auth/sessions, billing/Stripe/ledger, database splits or destructive migrations / backups / Litestream, security boundaries / secrets / encryption, deploy/infra workflows, breaking core user flows (`apply`, onboarding, sign-in/up), and Canvas Parity / `DO NOT AUTO-MERGE` PRs never self-merge.
- **Sequential migrations:** only one open PR may hold the next migration number in `drizzle/` or `drizzle-catalog/` at a time; subsequent PRs renumber on rebase.

## Agent skills

### Issue tracker

GitHub Issues on `a-hagi613/overture`, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repository root. See `docs/agents/domain.md`.

### Independent review (Greptile & CodeQL)

Greptile is **OFF during active build waves** (neither workers nor the orchestrator post `@greptileai`; reserve remaining monthly credits for an optional pre-launch audit). Automatic GitHub **CodeQL** (`.github/workflows/codeql.yml`) covers security scanning on every PR in parallel with CI: fix real High/Medium security findings, and push back with clear reasoning on verifiable false positives or low-impact test-only warnings.
