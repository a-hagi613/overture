# Overture

A job-search agent: it finds postings from ATS feeds, scores them against the user's resume, prepares
each application from the user's own facts, writes the cover letter, and submits through the employer's
real ATS form in a managed cloud browser. The user never sees a browser or a CAPTCHA.

**Read, in this order:** `DESIGN.md` (how it looks) → `docs/v2/SPEC.md` (what exists) →
`docs/v2/DECISIONS.md` (why, with rejected alternatives) → `docs/v2/GLOSSARY.md` (the words).

The full agent contract lives in `AGENTS.md`; this file is the short version for Claude Code.
Devbox-wide rules are not repeated here — `~/.claude/CLAUDE.md` is the global file and Claude Code
loads both. Nothing in this file overrides it; this is only what is true of Overture. Spec
beats code; `DESIGN.md` beats code on appearance. `archive/v1/` is the retired v1 project — never read
it as current.

## The five promises

1. **Never lie.** Every factual answer traces to a saved fact; the resume PDF is sent byte-for-byte,
   never regenerated. Posting text is untrusted and never decides a factual answer.
2. **Never embarrass.** Never the current employer or a skipped company, never twice to the same role,
   never in bursts, never below the user's threshold. Ten a day, ≥20 minutes apart, 08:00–20:00 local,
   7-day company cooldown, 60-day repost guard.
3. **Never charge for failure.** An allowance is spent only when an application is actually sent.
4. **Fully automatic.** The only mid-pipeline ask is a factual question: a Review.
5. **Auditable.** Every send keeps an immutable snapshot — answers with sources, letter, resume hash,
   consent version.

## Words

Use `Posting`, `Application`, `Stage`, `Status`, `Queued`, `Review`, `Couldn't apply`,
`Applications left`, `Check-in`, `Job-search address`.

Never: `Hold` (as a stage), `runner`, `lease`, `provider`, `dispatch`, `attempt`, `ledger`, `credit`,
`CAPTCHA`, `Brain`, `Hands`. Six stages exactly: `Queued · Applied · Screening · Interviewing ·
Offer · Closed`. Five destinations exactly: `Home · Board · Review · Inbox · Profile`, Settings from
the avatar.

## Architecture

One Fly app, one machine, one volume: Bun + Hono, SPA, SSE, scheduler, `bg_jobs` and dispatch in one
process. SQLite (WAL, `synchronous=FULL`, STRICT) behind Drizzle, Litestream to R2 with a weekly
restore drill. Every external dependency sits behind a port with a fake used by e2e: LLM, browser,
mail, object store, search, payments, push, FX, clock. Browsers are remote — Browser Use primary,
Kernel fallback, local Chrome only for fixtures. Mail arrives at `mail.tryoverture.com`, is
authenticated (SPF/DKIM/DMARC), stored even when authentication fails, and only automated on a pass.
The user's personal mailbox is never connected.

## Code rules

- Strict TypeScript. **No comments** (comment-ban script); JSDoc on exported port interfaces only.
- Zod on every input, webhook and env var.
- oxlint all rules, oxfmt, `tsgo --noEmit`.
- E2E is the standard; six unit-test files only (ledger, crypto, planner, address, tag rules, question
  normalisation). CI under 2 minutes; sharded Playwright, no sleeps, zero retries.
- Every page reachable in a test, axe clean, 30 visual snapshots.
- Copy strings in `src/shared/copy`, never inline. Secrets from `.env`; never print or commit them.

## Design rules

- `DESIGN.md` is the authority; the design-system boards are the reference.
- **Orange marks only the moment Overture acts.** Never links, hover, focus or decoration. Small orange
  text uses `--acct`, never `--acc`.
- **Serif is a person's words, mono is a machine's fact, sans is the interface.** Do not break it.
- No gradients, glows, glass, card stacks, orbs, emoji, invented metrics, or a second accent.
- `impeccable detect`: defects are binding (contrast, tap targets, heading order, overflow); taste rules
  are advisory. `DESIGN.md` §11 records the standing decision for each. Do not restyle for the linter.
- Tailwind + shadcn/ui; tokens via CSS variables; no per-page CSS, no hard-coded hex.

## Work

One slice from `docs/v2/SPEC.md` §17 at a time, behind green CI, naming the e2e flows it satisfies. If
a slice needs a product decision, stop and report a spec bug — do not guess.

`src/brain` and `src/hands` are the v1 codebase, still present and scheduled for deletion. Do not
extend them or port their patterns.
