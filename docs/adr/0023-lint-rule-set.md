---
status: accepted
---

# Every lint rule on, minus a written list of conflicts

Oxlint runs with every category (correctness, suspicious, pedantic, perf, style, restriction) at error, type-aware,
starting from the configuration Landmines' authors use on their own code. The nursery category stays off as a whole;
the nursery rules that configuration enables one by one (`no-unnecessary-condition`, `prefer-optional-chain`,
`no-useless-assignment`, `no-unreachable-loop` and others) stay on.
On top: the Landmines plugins (testing, style, structure, types), Dmitry Mulroy's anti-slop rules (vendored, each
checked against Landmines before it is enabled), every rule of the React, `jsx-a11y` and test plugins, and rules that
enforce this architecture: domain code may not import vendor SDKs, `Date.now` and `Math.random` are banned outside the
clock and random ports, `process.env` is read only in the Zod config module, and JSX holds no literal text (copy comes
from the copy module). `bun fmt` formats, reading `.oxfmtrc.json`; `bun check` type-checks with the same errors as
TypeScript 7. Coding agents run lint and format on every edit (Oxc's Claude Code hook) and finish only at zero
warnings. Landmines wins every conflict.

## Plugins

Oxlint 1.94 ships 872 rules. Every plugin is on except the two for frameworks we do not use: `eslint`, `typescript`,
`unicorn`, `import`, `oxc`, `promise`, `node`, `jsdoc`, `react`, `react_perf` (then off, below), `jsx_a11y` and
`vitest` are on; `vue` and `nextjs` are off; `jest` is replaced by `vitest`. That leaves about 700 rules at error. The
pull request that adds or upgrades Oxlint prints the enabled count from `oxlint --print-config`, and CI fails if a rule
outside the off-list below is not at error.

## Cloudflare preset rules

The rules that `@cloudflare/oxlint-config` adds on top of its inherited base are enabled here with the preset's
options. Every one was already at error through the categories unless the table says otherwise; nothing was loosened
to match it.

| Rule | State | Options |
|---|---|---|
| `eqeqeq` | already on | default |
| `import/no-self-import` | already on | default |
| `no-eval` | already on | default |
| `typescript/unbound-method` | already on | default |
| `import/consistent-type-specifier-style` | added options | `prefer-top-level` |
| `typescript/consistent-type-imports` | already on, options tightened | default (`disallowTypeAnnotations: true`) |
| `typescript/no-confusing-non-null-assertion` | already on | default |
| `typescript/no-non-null-assertion` | already on | default |
| `typescript/no-unnecessary-type-assertion` | added, previously inherited off | default |
| `typescript/no-unsafe-argument` | already on | default |
| `typescript/no-unsafe-assignment` | already on | default |
| `typescript/no-unsafe-call` | already on | default |
| `typescript/no-unsafe-member-access` | already on | default |
| `typescript/no-unsafe-return` | already on | default |
| `typescript/no-unsafe-type-assertion` | already on | default |
| `typescript/switch-exhaustiveness-check` | already on, one option added | `allowDefaultCaseForExhaustiveSwitch: true`, `considerDefaultExhaustiveForUnions: true` |
| `typescript/no-misused-promises` | already on | default |
| `no-promise-executor-return` | already on | default |
| `typescript/no-floating-promises` | already on | default |
| `typescript/use-unknown-in-catch-callback-variable` | already on | default |
| `unicorn/prefer-set-has` | already on | default |

`bun lint` runs Oxlint with this configuration and `--deny-warnings`, so the full rule set is the developer command.
`bun run lint:parity` compares Oxlint's findings with a native `bun lint --no-script` from a canary Bun; on Bun
1.4.6-canary the findings are identical apart from two extra `vitest/prefer-each` findings, and native lint does not
run the `jsdoc` plugin. The parity script is not a CI gate.

## Rules that close the gaps

Landmines alone leaves three ways around these rules, so the architecture rules close them:

- **No disable directives.** Any `oxlint-disable`, `eslint-disable` or `@ts-ignore` comment is an error. `no-comments`
  runs with an empty `allow` list, so `// WARNING:` notes are errors too.
- **Unit test files only beside the ADR 0013 invariants.** A unit test file is allowed only for an invariant ADR 0013
  lists, by an explicit path allowlist in `.oxlintrc.json`. Any other unit test file is an error. Every other test is a
  Playwright end-to-end test.
- **Catalog writes belong to the sweep worker.** A write to `company_boards`, `postings` or `posting_tags` outside the
  Bun Worker is an error. The narrow non-sweep paths that keep a single-row write on the main thread (dispatch closing
  a posting, preparation marking the question cache, tag import, the retag and seed scripts, the test routes) are
  listed in `.oxlintrc.json`; adding one needs a written reason here. A new sweep write goes into
  `src/server/catalog/sweep-worker.ts` and its worker-only modules (`poll-board.ts`, `workable-ingest.ts`).
  `src/server/demo/seed.ts` is also listed there (#278): it writes fictional catalog rows for the demo account's
  sample Applications, never real Postings, and only when `DEMO_LOGIN_ENABLED=true` or the operator runs
  `bun run db:seed-demo`. `src/server/billing/pause.test.ts` is listed for the same reason: its one in-flight fixture
  writes a fictional company, board and posting so a reservation has a sending Application, never a real Posting.
  `src/server/dispatch/outcomes.test.ts` is listed for the same reason: its email-receipt fixture writes fictional
  companies, boards and postings so two Confirming Applications exist at one employer, never a real Posting.
  `src/server/matching/applications.test.ts` is listed for the same reason: its fixture writes one fictional company,
  board and posting so an Application can be created and then watch its catalog rows be deleted, never a real Posting.
  `src/server/platform/db/migration-snapshot.test.ts` is listed for the same reason: it seeds the pre-`0056` catalog
  shape in a scratch database to prove the backfill and the foreign-key decoupling, never a real Posting.
- **The off-list and every scoped override are checked.** CI fails if the rules turned off in the configuration
  differ from the table below, if an override turns a rule down or changes its options without appearing in the
  "Rules off in one folder only" table, or if that table lists an override that does not exist. The same
  `bun run lint:config` gate fails when a file in `src/` or `test/` opens a `new DatabaseSync` without a
  `PRAGMA busy_timeout` and without a documented opt-out, the ADR 0013 invariant that keeps the `SQLITE_BUSY` stall
  from returning.

## Rules turned off, and why

| Rule | Reason |
|---|---|
| `typescript/explicit-function-return-type`, `typescript/explicit-module-boundary-types` | Contradict Landmines `no-explicit-return-types` |
| `import/prefer-default-export`, `import/no-named-export` | Contradict `import/no-default-export` (kept; config files that must default-export are overridden) |
| `eslint/no-ternary`, `unicorn/prefer-ternary`, `unicorn/no-nested-ternary` | Contradictory pair; `eslint/no-nested-ternary` kept |
| `eslint/no-undefined`, `unicorn/no-null` | Together they forbid every absent value; SQLite and React need `null` |
| `node/no-top-level-await` | Contradicts `unicorn/prefer-top-level-await`; Bun supports top-level await |
| `oxc/no-async-await`, `oxc/no-optional-chaining`, `oxc/no-rest-spread-properties` | Ban modern syntax for old runtimes we do not target |
| `eslint/sort-keys`, `eslint/sort-imports` | oxfmt sorts imports; alphabetical keys hurt Zod schemas and config readability |
| `eslint/capitalized-comments` | Moot under Landmines `no-comments` |
| `import/exports-last`, `import/group-exports` | Fight exporting a declaration where it is written |
| `react/react-in-jsx-scope` | Obsolete with React 19's automatic runtime |
| `react/forbid-component-props` | shadcn/ui is built on `className` props |
| `react_perf/*` | The React Compiler memoises; hand-written `useCallback`/`useMemo` is noise |
| `jsdoc/require-param-type`, `jsdoc/require-returns-type` | TypeScript carries the types; JSDoc only on port interfaces |
| `typescript/prefer-readonly-parameter-types` | Fails on most library types (React props, `Request`) |
| `jest/*` that require Jest globals, hooks bans or assertion counts | The seven unit files use `bun:test`; the Vitest rules apply instead |

Everything else in Landmines' configuration's off-list is inherited unchanged; the inherited rules are written out
below so that CI can check the configuration against this file.

## Rules off in one folder only

Every override that turns a rule down or changes its options is listed here, with the exact files it covers; CI
compares this table with `.oxlintrc.json`.

| Rule | Where | Reason |
|---|---|---|
| `import/no-default-export` | `**/*.config.{ts,mts,mjs,js}`, `test/e2e/global-setup.ts`, `tools/oxlint/architecture/index.ts`, `workers/inbound-mail/src/index.ts`, `workers/sentinel/src/index.ts` | Vite, Vitest, Playwright and Drizzle config files, Playwright's global setup hook, the Oxc plugin registration and the Cloudflare Worker entries (the Email Worker and the cron sentinel) all require a default export |
| `node/no-process-env` | `src/server/config/env.ts`, `drizzle.config.ts`, `test/e2e/**` | `src/server/config/env.ts` is the one module that reads the process environment inside the app; the Drizzle CLI config and the e2e harness read it from outside the app |

Two React options are set rather than turned off: `react/jsx-filename-extension` allows `.tsx`, and
`react/jsx-max-depth` allows six levels, because a real screen nests deeper than the default of two. Both stay at
error and both live in the global rules, so the scoped table does not cover them.

## Inherited off-list

These rules are off in Landmines' own configuration. They stay off here unchanged, with the reasons that configuration
gives.

| Rule | Reason |
|---|---|
| `eslint/complexity` | Size and complexity caps that a dense Hono and React codebase cannot meet; Landmines' baseline. |
| `eslint/id-length` | Landmines' baseline; short names are idiomatic in callbacks and SQL mapping. |
| `eslint/init-declarations` | Landmines' baseline; declarations are initialised where they are written. |
| `eslint/max-classes-per-file` | Landmines' baseline. |
| `eslint/max-depth` | Landmines' baseline; Hono route composition nests. |
| `eslint/max-lines` | Landmines' baseline. |
| `eslint/max-lines-per-function` | Landmines' baseline. |
| `eslint/max-nested-callbacks` | Landmines' baseline; Playwright and MSW callbacks nest. |
| `eslint/max-params` | Landmines' baseline; ports and adapters take explicit positional arguments. |
| `eslint/max-statements` | Landmines' baseline. |
| `eslint/no-continue` | Landmines' baseline; queue and migration loops use it. |
| `eslint/no-magic-numbers` | Landmines' baseline; SQL, tokens and test fixtures carry literals. |
| `eslint/require-await` | Landmines' baseline; an adapter keeps an async signature even when it has nothing to await. |
| `import/max-dependencies` | Landmines' baseline. |
| `import/no-nodejs-modules` | Bun serves node: builtins and the server needs node:path and node:fs. |
| `import/no-relative-parent-imports` | The app is one package; relative imports across src are normal. |
| `node/no-sync` | Bun's SQLite and file APIs are synchronous by design. |
| `oxc/no-async-endpoint-handlers` | Hono handlers are async. |
| `promise/avoid-new` | MSW and child_process APIs are callback-shaped. |
| `promise/prefer-await-to-callbacks` | Landmines' baseline; the same callback adapters. |
| `typescript/non-nullable-type-assertion-style` | Landmines' baseline. |
| `typescript/strict-void-return` | Landmines' baseline; `no-confusing-void-expression` covers the risk. |
| `unicorn/max-nested-calls` | Landmines' baseline. |
| `unicorn/no-await-expression-member` | Landmines' baseline. |
| `unicorn/number-literal-case` | Landmines' baseline. |
| `unicorn/prefer-reflect-apply` | Landmines' baseline. |
| `vitest/max-expects` | Landmines' baseline for its colocated tests. |
| `vitest/no-conditional-in-test` | Landmines' baseline. |
| `vitest/no-hooks` | Landmines' baseline. |
| `vitest/no-importing-vitest-globals` | Landmines' baseline. |
| `vitest/prefer-called-once` | Landmines' baseline. |
| `vitest/prefer-to-be-falsy` | Landmines' baseline; strict boolean matchers are kept instead. |
| `vitest/prefer-to-be-truthy` | Landmines' baseline; strict boolean matchers are kept instead. |
| `vitest/require-hook` | Landmines' baseline. |
| `vitest/require-test-timeout` | Landmines' baseline. |
| `vitest/require-top-level-describe` | Landmines' baseline. |

## Secret and personal-file checks

The repository is public, so CI refuses a secret or a personal file before it can land. These checks follow the
same rule as the lint rules above: they are on, and an allowlist entry needs a written reason in `.gitleaks.toml`.

| Check | Where | What it does | Why |
|---|---|---|---|
| gitleaks | `secrets` job in `.github/workflows/ci.yml` | Pinned gitleaks 8.30.1, sha256 verified in the step. Scans the full history of `main` on push (`--log-opts=HEAD`) and the pull request's commit range on pull_request. Fails on any finding; `ci-ok` requires it. | A secret in history stays public after a later commit removes it. Allowlist: `.gitleaks.toml` (default rules plus three narrow allowlists). |
| private-files guard | `secrets` job, `scripts/check-private-files.ts` | Fails when git tracks anything under `profile/` other than `profile/README.md`, any `.env*` file other than `.env.example`, or any `*.pdf`, `*.docx`, `*.tex` outside `test/e2e/fixtures/`. Reads `git ls-files`. | Owner profile files and env files hold personal data and secrets; the guard catches them before a commit reaches main. `profile/*` is ignored in `.gitignore`. |
