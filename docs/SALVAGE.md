# What v2 takes from v1

v1 is `a-hagi613/ai-auto-apply` (default branch, commit `f7ef53f`, 2026-11-18). It is read-only reference.
v2 is a fresh start that **ports logic, not structure**: each item below is rewritten into the v2 layout
(`SPEC.md` §4), with v2 types and the glossary's words, behind v2 ports, with comments and tests stripped.
Nothing is copied whole. Nothing outside this list is ported. v1 patterns (stores built on `bun:sqlite`
handles, `Workspace`, `Hold`, `Answer Bank`, `Memory Base`, `Standby`, `Rehearsal`) are never carried over.

## Port

| v1 path (lines) | What is worth keeping | v2 home | Notes |
|---|---|---|---|
| `src/brain/sources/{greenhouse,lever,ashby}.ts` (~315) | Feed URLs, field mapping, pay-range and workplace extraction | `server/catalog/sources/` | M1. Already free of the database; adapt to `fetchBoard(token, {etag, lastModified})` |
| `src/brain/sources/{smartrecruiters,recruitee}.ts` (~240) | Same | `server/catalog/sources/` | M2, after the 20-form probe |
| `src/brain/sources/{shared,types,html-to-text}.ts` (~210) | Fetch helper, entity decoding, HTML → text | `server/catalog/sources/` | |
| `src/brain/directory/{board-urls,loader,seed-boards}.ts` (~670) | Apply-URL → board parsing, the curated SmartRecruiters/Recruitee seed list | `server/catalog/boards/` | Loader rewritten on Drizzle; the 22,800-board seed comes from the v1 database export, not this code |
| `src/brain/matching/posting-guard.ts` (354) | Prompt-injection guard on posting text | `server/pipeline/guard/` | Promise 1: posting text never decides a factual answer |
| `src/brain/matching/liveness.ts` (27) | Closed-posting detection | `server/catalog/` | Used by the dispatcher re-check |
| `src/brain/inbox/codes.ts` (48) | Verification-code extraction from ATS mail | `server/inbox/codes/` | Input becomes a v2 `messages` row |
| `src/brain/secrets/index.ts` (81) | AES-256-GCM envelope encryption | `server/platform/crypto/` | Add the v2 ciphertext format and associated data (`SPEC.md` §13.2) |
| `src/brain/onboarding/memory-base.ts` | The v1 fact keys | `shared/facts.ts` | Seed of the fact catalog only |
| `src/hands/agent/{executor,snapshot,match,plan-cache}.ts` (~2,350) | ARIA-tree form reading, label → answer matching, option matching, date formats, form signatures and cached plans | `server/dispatch/executor/` | The core of form filling. Plan cache moves from files to the `plan_cache` table. Drop debug file writes |
| `src/hands/ats/{flow,fill-loop,check-option}.ts` (~335) | Shared fill loop and checkbox/radio handling | `server/dispatch/executor/` | Strip the live-view, solver and Standby hooks |
| `src/hands/greenhouse/{apply,fill,detect,late-fields}.ts` (~900) | Greenhouse form specifics, fields that appear after earlier answers | `server/dispatch/ats/greenhouse/` | Strip Xvfb/Rehearsal/Shadow branches |
| `src/hands/{lever,ashby}/*.ts` (~330) | Lever and Ashby form reading and flows | `server/dispatch/ats/{lever,ashby}/` | |
| `src/hands/submit-guard.ts` (26) | The last check before Submit | `server/dispatch/executor/` | Becomes the point that sets `attempts.submit_clicked_at` (`SPEC.md` §9.4) |

About 5,900 lines of v1 logic are in scope, before rewriting.

## Do not port

Workday (`sources/workday.ts`, `hands/workday*`: a non-goal); hiring.cafe; Gmail and IMAP mail
(`inbox/gmail.ts`, `mailbox.ts`, `mail-api.ts`); v1 scoring (`matching/index.ts`, DeepSeek); the
runner and everything about local Chrome (`browser.ts`, `lazy-browser.ts`, `proxy-*`, `live-view.ts`,
`captcha-solver.ts`, `worker.ts`, `brain-client.ts`, `status-file.ts`, `exit-policy.ts`, `outcome-queue.ts`);
board discovery by search terms (`directory/discovery.ts`, `search-terms.ts`); the v1 web layer, setup,
Telegram, BYOK; every test file.

## Data, not code

From the v1 production database on Fly app `ai-auto-apply` (volume `data`, yyz), exported once by
`scripts/import-v1.ts` before v1 is stopped:

| v1 table | v2 destination |
|---|---|
| `company_boards` | `company_boards` (`source='v1_seed'`), about 22,800 rows |
| `answer_entries`, `answer_years`, `answer_achievements`, `answer_aliases` | the owner's `facts` |
| `learned_answers` (449) | the owner's Tier 3 facts `q:<question_id>`, via the question catalog |

`scripts/export-v1-facts.ts` reads the v1 SQLite file read-only and writes one JSON export (answer-bank entries, years,
achievements, aliases, settings and learned answers). `scripts/import-v1-facts.ts` maps that export into a v2 user's
Facts. The export holds the owner's answers, so it is encrypted and kept off the repository (`SPEC.md` §18).

The answer bank's "Email on application forms" row **is** imported as the `email` Fact: the user's real email goes on
forms (ADR 0028), and the forwarding address is never a Fact.
