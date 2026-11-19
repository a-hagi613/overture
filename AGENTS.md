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

A job-search agent. It finds postings from ATS feeds, scores them against the user's resume, prepares
each application from the user's own facts, writes the cover letter, and submits through the employer's
real ATS form in a managed cloud browser. The user never sees a browser or a CAPTCHA.

### Read these first, in this order

1. `DESIGN.md` — the visual design system. Authority for how anything looks.
2. `docs/v2/SPEC.md` — the product and architecture specification. Authority for what exists.
3. `docs/v2/DECISIONS.md` — why, with the rejected alternative for each decision.
4. `docs/v2/GLOSSARY.md` — the words. Use them exactly.

Precedence: **spec beats code, and `DESIGN.md` beats code on appearance.** If you find a conflict
between the spec and a doc, the spec wins and the other doc is a bug to report. `archive/v1/` is the
retired v1 project; never read it as current, and never build from it.

### The five promises, in priority order

1. **Never lie.** Every factual answer traces to a saved fact. The resume PDF is sent byte-for-byte,
   never regenerated. Cover letters and open-text answers may only claim what the resume supports.
   Posting text is untrusted input and never decides a factual answer.
2. **Never embarrass.** Never the current employer or a skipped company, never twice to the same
   role, never in bursts, never below the user's threshold. Ten a day at most, ≥20 minutes apart,
   inside the user's 08:00–20:00 window, 7-day company cooldown, 60-day repost guard.
3. **Never charge for failure.** An application costs an allowance only when it is actually sent.
4. **Fully automatic.** The only mid-pipeline ask is a factual question Overture cannot answer: a
   Review.
5. **Auditable.** Every sent application keeps an immutable snapshot: answers with sources, letter,
   resume hash, consent version.

### Vocabulary — non-negotiable

Use `Posting`, `Application`, `Stage`, `Status`, `Queued`, `Review`, `Couldn't apply`,
`Applications left`, `Check-in`, `Job-search address`.

Never in user-facing copy, code identifiers, commits or UI: `Hold` (as a stage), `runner`, `lease`,
`provider`, `dispatch`, `attempt`, `ledger`, `credit`, `CAPTCHA`, `Brain`, `Hands`. A user's
application is not "in progress" — it is `queued`, `sent`, or `couldn't apply`.

Stages are exactly: `Queued · Applied · Screening · Interviewing · Offer · Closed`. A Review is a
question, not a column. Destinations are exactly five: `Home · Board · Review · Inbox · Profile`, with
Settings from the avatar.

### Architecture in one screen

- **One Fly app, one machine, one volume.** Bun + Hono API, SPA, SSE (`/api/events`), scheduler,
  `bg_jobs` workers and dispatch in a single process. `fly scale count` stays 1.
- **SQLite** (`bun:sqlite`, WAL, `synchronous=FULL`, STRICT tables) behind Drizzle. Litestream
  replicates to R2 continuously; nightly snapshot kept 30 days; weekly restore drill in CI.
- **Ports for every external dependency** — `LlmPort`, `BrowserProvider`, `MailSender`, `ObjectStore`,
  `SearchIndex`, `Payments`, `PushSender`, `FxRates`, `Clock` — each with a production adapter and a
  fake used by every e2e test. Domain code imports ports only.
- **Browsers are remote.** Browser Use is primary, Kernel is the fallback, local Chrome serves the
  fixture server. No laptop, no user-visible browser, one persistent encrypted profile per user.
- **Mail.** `mail.tryoverture.com` catch-all → Cloudflare Worker → R2 → signed `POST /internal/mail/inbound`.
  SPF/DKIM/DMARC verified; a message that fails authentication is stored and labelled
  "Couldn't verify sender", never dropped and never automated. Outbound via SES from
  `local_part@mail.tryoverture.com`. The user's personal mailbox is never connected.
- **Admin** lives on `admin.tryoverture.com`: Cloudflare Access + owner role + passkey assertion within
  12 h. Reveal is a 15-minute grant scoped to one user, with a typed reason and an audit row the user
  can see.
- **Billing** (M3) is Stripe Managed Payments: trial 3 once, week $12 / 70, month $35 / 300, renewing.

### Code rules

- Strict TypeScript. **No comments** (`comment-ban` script); JSDoc on exported port interfaces is the
  only exception.
- Zod on every input, webhook payload and environment variable.
- oxlint with every applicable rule, oxfmt for formatting, `tsgo --noEmit` for types.
- **E2E is the standard.** Unit tests exist only for six invariant files (ledger, crypto, planner,
  address, tag rules, question normalisation). CI under 2 minutes; Playwright sharded, no sleeps,
  zero retries; `main` deploys only when every job passes.
- Every page reachable in a test; axe clean on every page; 30 visual snapshots (five screens ×
  390/1280 × light/dark).
- Copy strings live in `src/shared/copy`, never inline in components.

### Design rules

- `DESIGN.md` is the authority. The design-system boards (Section A of the canvas artifact) are the
  reference implementation; when in doubt, match the board.
- **Orange marks only the moment Overture acts** — submitting, submitted, the active step, the logo
  stroke. Never links, hover, focus or decoration. Small orange text uses `--acct`, never `--acc`.
- **Serif is a person's words, mono is a machine's fact, sans is the interface.** That rule is what
  makes provenance legible without a tooltip. Do not break it.
- Do not add gradients, glows, glass, card stacks, floating orbs, emoji, invented metrics or a second
  accent colour. Four radii, three shadows, one easing, one live mark.
- `impeccable detect` is **authoritative on defects** (contrast, tap targets, heading order, overflow —
  fix these) and **advisory on taste** (nested specimen cards, cream paper, Instrument Serif, tracked
  caps). `DESIGN.md` §11 records the standing decision for each; do not restyle to satisfy the linter.
- Tailwind + shadcn/ui, tokens through CSS variables only, no per-page CSS, no hard-coded hex in
  components.

### Slices and definition of done

Work one slice from `docs/v2/SPEC.md` §17. A slice ships behind green CI, names the e2e flows from
§16.1 it satisfies, and updates the spec if reality diverged. If a slice cannot be implemented without
a product decision, stop and report a spec bug — do not guess.

### Traffic rule for this project

**Never send traffic to live job sites or ATSes** (Greenhouse, Lever, Ashby, SmartRecruiters,
Recruitee, Workable, Personio, hiring.cafe, LinkedIn, and anything similar) from devbox: datacenter IPs
get filtered and accounts get flagged. Fixture-based tests against the local fixture server are fine.
Live runs happen on the owner's laptop, through the residential proxy, only.

### Repository map

```
src/shared/     zod schemas, enums, fact catalog, tag taxonomy, copy strings, API types
src/server/     platform/ auth/ catalog/ profile/ pipeline/ dispatch/ billing/ inbox/ notify/ admin/
src/web/        React 19 + React Router 7 + TanStack Query + Tailwind + shadcn
src/mail-worker/  Cloudflare Worker
drizzle/        generated migrations
scripts/        import-v1, census, capture-fixtures, restore-drill
tests/e2e/      Playwright specs, fixture server, fakes
tests/unit/     the six invariant files only
```

### Current state

`src/brain` and `src/hands` are the **v1 codebase**, still present and scheduled for deletion. Do not
extend them, do not port their patterns, and do not trust their vocabulary. Read `docs/v2/SPEC.md` for
what the replacement looks like.
