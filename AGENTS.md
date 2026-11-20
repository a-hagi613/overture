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
