# Independent Greptile review (on demand)

Greptile is installed on `a-hagi613/overture` as a second pair of eyes. It is **manual only**: `.greptile/config.json` sets `autoReview: []`, so no review runs until someone asks for one on the pull request. The budget is **50 credits a month** and reviews cost **1 (base), 3 (plus) or 10 (apex)**; spend them where a missed defect would cost more than the credits.

Greptile is not a replacement for the repository's own gates. Every worker still runs `bun run verify`, the named skills in its spec (`code-review-and-quality`, `test-driven-development`, `security-and-hardening`, and so on), watches CI to green and posts its Verification block. Greptile is an extra, independent review on top.

## When to ask for one

Ask when a **missed defect would be expensive, hard to see, or irreversible**:

| Ask | Examples |
|---|---|
| **Always** | auth, sessions, permissions, crypto, Stripe and the ledger, migrations, job recovery/shutdown, deploy and CI workflows, anything that can double-charge or lose data, deletes, a change to a shared contract |
| **Usually** | cross-cutting refactors, more than ~300 changed lines or ~15 files, a new subsystem, a fix where two agents disagreed, a second attempt at a bug that already shipped once |
| **Skip** | docs and copy, formatting, version bumps, a single-file fix with a test, test-only changes, anything the CI gates and a named skill already cover exhaustively |

Never ask twice for the same shape of change: one review, fix the findings, then a single re-review **only if the fixes were substantial** (new transactions, new endpoints, changed schema).

## How to ask

Comment on the pull request with the worker's own `gh` auth:

```bash
# default tier from .greptile/config.json ("auto")
gh pr comment <n> --body "@greptileai review this pull request"

# a substantial or high-risk change
gh pr comment <n> --body "@greptileai review this at plus"

# the highest risk only: auth, billing/ledger, migrations, launch checks
gh pr comment <n> --body "@greptileai review this at apex"

# a targeted second opinion, cheaper and faster than a full pass
gh pr comment <n> --body "@greptileai focus on the transaction boundaries in src/server/dispatch"
```

A request in the comment can raise the tier above the configured one but never lower it. Credits are charged for the tier that runs.

**Apex needs the orchestrator's approval.** Workers may ask for `base` or `plus` themselves (the config default is `auto`, which usually picks base); `apex` costs 10 of the 50 monthly credits and is reserved for the highest-risk changes (auth, billing/ledger, migrations, launch checks) unless the orchestrator says otherwise in the task.

## Waiting for the review

Greptile replies as a comment (and, because `statusCheck` is off, no required check is created). Read it with:

```bash
gh pr view <n> --json comments \
  --jq '.comments[] | select(.author.login | test("greptile")) | .body'
```

Give it 10 minutes for a base/plus review and up to 25 for apex; a `push` does not re-trigger anything, because automatic reviews are off. If nothing appears at all, the installation is missing or the repository is not in its access list; say so in the task report instead of retrying.

## Handling the findings

- Treat **P0/P1** findings as work to fix before `worker_done`; a P0 that contradicts the spec or an ADR is raised, not silently obeyed.
- **P2/style** findings are judgement calls: fix cheap ones, reply with the reason for the rest.
- Reply on the thread (or in the task report) for anything intentionally not fixed, so the next reviewer does not re-open it.
- Never suppress a rule, skip a test or weaken a check to make Greptile happy. If Greptile is wrong, say why on the pull request.

## Recording the spend

Put one line in the PR body or the task report when a review ran, so the monthly budget is auditable:

```text
Greptile: plus review requested on <sha>, <k> findings (P0 <n>, P1 <n>, P2 <n>), <fixed / replied>
```
