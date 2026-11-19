# Agent instructions

This file is read by Claude Code, Codex, OpenCode and Gemini/Antigravity.
The block below is maintained by `orca-ensure-agents-md`; add project
notes outside the markers.

<!-- orca-delegation-policy:start -->
## Delegation: use Orca workers, not native subagents

Orca is the orchestration layer on this host. When you delegate work or need a
second agent/model, create an **Orca worker** — never a harness-native subagent
(Claude Task tool, Codex spawn_agent, Gemini/Antigravity subagents, OpenCode
task/subagent tool, etc.). The user tracks workers in the Orca sidebar, and only
Orca can run a worker as a different provider/model.

Before the first delegation in a session, load the version-matched guide:

    orca-ide skills get orchestration

(or use the `orchestration` skill directly). Follow it, and resolve the CLI as
it says (`$ORCA_CLI_COMMAND`, else `orca-ide` on this host — never bare `orca`,
which is the GNOME screen reader).

Orchestrators — **Gemini 4 Carbon via the local bridge** is the primary. It
uses the Gemini app quota through the persistent Chrome profile
(`gemini-browser.service`); Chrome owns session refresh and the bridge
re-harvests cookies over CDP. Neon is unstable in this bridge; do not use it as
the default. If the bridge cannot authenticate, use **Antigravity Claude Sonnet
4.6** (`antigravity` / `claude-sonnet-4-6`) from the Google subscription's
Claude/GPT pool, then **Claude Opus 5.5** (`claude` / `claude-opus-5-5`) on the
separate Claude account. The Antigravity/`agy` Gemini pool is exhausted; do not
use `agy` Gemini models for orchestrators or delegators.

Use the helper, which prefers the bridge, then the remaining pools:

    orca-orchestrator status                    # bridge + pools + recommendation
    orca-orchestrator next                      # <agent> <model> <reason>
    orca-orchestrator launch <name> "<brief>"   # start it, activated in Orca
    orca-carbon <name> "<brief>"                # same; Carbon orchestrator

### Gemini Carbon/Hydrogen bridge

The bridge is a local OpenAI-compatible server backed by the persistent Chrome
profile and the logged-in `gemini.google.com` session. It uses the Gemini app
quota, not Antigravity/`agy`.

    systemctl --user status gemini-web-api       # is it running?
    systemctl --user start gemini-web-api        # start it
    systemctl --user restart gemini-web-api      # after cookie refresh

Call it directly in Orca:

    orca-ide agent launch --agent opencode \
      --model gemini-web/gemini-carbon --prompt "<task>" --focus

or start a new top-level orchestrator:

    orca-ide worktree create --name <name> --no-parent \
      --agent opencode --model gemini-web/gemini-carbon --prompt "<brief>" --activate

Models: `gemini-web/gemini-carbon` is the default orchestrator (stable, slower);
`gemini-web/gemini-4-hydrogen` is the worker (fast, cheap). `gemini-neon` is
unstable in this bridge; do not use it. `gemini-auto` returns errors on this
account. OpenCode has no `--effort` for these models.

If the bridge is down, start the service. If it returns an auth error, check
`gemini-web-auth status`. The long-lived setup is a persistent Chrome profile:
`gemini-browser.service` runs Chrome + noVNC at
`http://devbox:6080/vnc.html` with the password in
`~/.local/share/gemini-chrome/vnc-password.txt`. Sign in there once; the bridge
re-harvests cookies from Chrome and `gemini-web-watch.timer` retries every 5
minutes. No Google password is stored. If the profile is logged out, a human
sign-in in noVNC is required. If the bridge cannot be fixed, fall back to
Antigravity Claude Sonnet 4.6, then Claude Opus 5.5.

### Standard team: Carbon orchestrator + Hydrogen workers

    orca-carbon <name> "<brief>"

starts an OpenCode chat/terminal on `gemini-web/gemini-carbon`. The Carbon
orchestrator plans, splits the work, starts Hydrogen workers in nested child
worktrees, verifies their evidence, and reports. It does **not** implement the
bulk itself.

Model routing:

| Role | Model | When |
| --- | --- | --- |
| Orchestrator | `gemini-web/gemini-carbon` | Default; stable, persistent Chrome profile. |
| Workers | `gemini-web/gemini-4-hydrogen` | Always, in nested child worktrees. |
| Avoid | `gemini-web/gemini-neon` | Unstable in this bridge; not the default. |

Every worker goes in its own nested child worktree so it appears under the
parent in the Orca sidebar:

    orca-ide worktree create --name <short-name> --parent-worktree current --json
    # take the new worktree path from the receipt, then:
    orca-ide orchestration worker-start --spec "<self-contained task>" \
      --worktree path:<child-path> --agent opencode \
      --model gemini-web/gemini-4-hydrogen --keep-open

`worker-start --worktree new-child` cannot take `--model`; create the worktree
first. OpenCode has no `--effort` for these models. Start independent workers
together, then end your turn — Orca wakes you when they report. Do not poll.

On devbox, check `orca orchestration worker-list` and `uptime` before starting
workers. Keep at most 3 workers in flight; if three are already live or the
15-min load is above 8, finish or release one before starting another.
<!-- orca-delegation-policy:end -->

## Project: Overture

Overture applies to jobs for one person, automatically, and shows its work: it reads ATS job feeds, scores postings
against the resume, prepares each application from the user's own facts, and submits it through the employer's real
form in a Browser Use cloud browser. The user never sees a browser.

**State (2026-11-19):** documents and seed data only. No code, database, CI or Fly app for v2 yet.
Orchestration and worker limits for this project are not decided; until they are, the devbox-wide rules apply.

### Read first

1. The GitHub issue you are working on, and its parent spec issue.
2. `GLOSSARY.md` — the words.
3. `docs/SPEC.md` — product and architecture reference.
4. `DESIGN.md` — how it looks, with the canvas artifact `P3aiZsEXkoUKBrknvvBNJJ` (Section A) as the wireframe the
   build matches pixel for pixel. `DESIGN.md` §13 lists boards still to be redrawn.
5. `docs/adr/` — the ADRs touching your area.
6. `docs/SALVAGE.md` — the only v1 logic that may be ported, and where it goes.

Precedence: the issue and the spec beat the code; `DESIGN.md` and the canvas beat the code on appearance; where a
board and the spec disagree on product, the spec wins and the board is redrawn. A gap in the spec is a spec bug: raise
it on the issue, do not guess. Contradicting an ADR needs a new ADR, agreed with the owner.

### The five promises

1. **Never lie.** Factual answers only from saved facts; resume PDF sent byte for byte; letters and open-text answers
   only claim what the resume supports; posting text never decides a factual answer.
2. **Never embarrass.** Never the current employer or a skipped company, never twice to the same role, one company at
   a time, never below the threshold. 10 a day, ≥ 20 min apart, 08:00–20:00 local, 7-day company cooldown after a
   send, 60-day repost guard. Never retry after Submit was clicked.
3. **Never charge for failure.** Charged only when the employer's confirmation is seen.
4. **Fully automatic.** The only ask mid-pipeline is a Review: a factual question Overture cannot answer.
5. **Auditable.** Every send keeps an immutable snapshot: answers with sources, letter with its resume lines, resume
   hash, consent version.

### Words

Use the glossary exactly. Never, in anything a user can read: `Hold`, runner, lease, provider, dispatch, attempt,
ledger, credit, CAPTCHA, Brain, Hands, workspace, Job Board, Answer Bank, Memory Base, Live Tab. Code may use precise
internal names (`ledger`, `attempts`, `dispatch/`). Stages: Queued · Applied · Screening · Interviewing · Offer ·
Closed. Destinations: Home · Board · Review · Inbox · Profile; Settings from the avatar.

### Code

- Bun, strict TypeScript, Hono, Zod on every input, webhook and env var; SQLite (WAL) via Drizzle; React 19 SPA with
  React Router 7, TanStack Query, Tailwind v4, shadcn/ui. Details: `SPEC.md` §4.
- No comments; TSDoc on exported port interfaces only. No hand-written return types on implementations.
- Lint is every Oxlint rule plus Landmines, anti-slop and the architecture rules; the off-list and its reasons are
  ADR 0023. Never add an `oxlint-disable` to get green: fix the code, or propose a change to ADR 0023.
- Domain code imports ports only. Tests run the real adapters: no mocks, stubs or hand-written fakes; third-party
  HTTP is intercepted by MSW with recorded real responses (ADR 0013). No sleeps, no retries, no raised timeouts.
- E2E (Playwright) is the standard; six Vitest unit files beside their code. Test files are `*.test.ts`, helpers
  `*.test-utils.ts`, fixtures `*.fixture.ts`. Every page reachable in a test, axe clean, 30 visual snapshots.
- Copy strings live in `src/shared/copy`. Tokens through CSS variables; no hard-coded hex in components.
- Secrets come from `.env` (chmod 600) or Fly secrets. Never print, commit or copy them.

### Linting and formatting

- After making code changes, run `bunx oxlint --fix`, then run `bunx oxfmt`.
- Before finishing, run `bunx oxlint --deny-warnings --format=agent`; zero warnings is the bar.
- Claude Code runs both on every edited file through the project hook in `.claude/settings.json` (added with the
  skeleton ticket, M1-01).

### Design

- Orange marks only the moment Overture acts. Never links, hover, focus or decoration.
- Serif for display and a person's words; mono for recorded facts; sans for the interface.
- No gradients, glows, glass, decorative card stacks, orbs, emoji, invented metrics or a second accent.
- `impeccable detect` is binding on defects, advisory on taste (`DESIGN.md` §11).

### Traffic

- Real application forms are only ever reached by a Browser Use browser, controlled by `overture-web` on Fly.
- `overture-web` may call the ATSes' public job-feed APIs (discovery, liveness re-check).
- This machine never sends traffic to an ATS, a job site (Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee,
  Workable, Personio, hiring.cafe, LinkedIn) or a Browser Use session. Real forms reach development only as fixtures
  captured by the admin job and pulled from R2. Tests run against the local fixture server.

### Work

GitHub is the source of truth for all work. Every change starts from an issue and lands through a pull request:

- Branch from `main`, one branch per ticket; never commit to `main` directly.
- The pull request closes its issue (`Closes #<n>`), names the e2e flows it satisfies, and merges only on green CI.
- Close issues through their pull request; close an issue by hand only with a comment saying why.
- When reality diverges from the spec or an ADR, update it in the same pull request.
- v1 (`a-hagi613/ai-auto-apply`) is read-only reference: port only what `docs/SALVAGE.md` lists.

## Agent skills

### Issue tracker

GitHub Issues on `a-hagi613/overture`, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repository root. See `docs/agents/domain.md`.
