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
from the copy module). oxfmt formats; `tsgo --noEmit` type-checks. Coding agents run lint and format on every edit
(Oxc's Claude Code hook) and finish only at zero warnings. Landmines wins every conflict.

## Rules that close the gaps

Landmines alone leaves three ways around these rules, so the architecture rules close them:

- **No disable directives.** Any `oxlint-disable`, `eslint-disable` or `@ts-ignore` comment is an error. `no-comments`
  runs with an empty `allow` list, so `// WARNING:` notes are errors too.
- **Six unit test files only.** A Vitest file is allowed only beside the six invariants in ADR 0013 (ledger, crypto,
  planner, address, tag rules, question normalisation), by an explicit path allowlist. Any other unit test file is an
  error. Every other test is a Playwright end-to-end test.
- **The off-list is checked.** CI fails if the rules turned off in the configuration differ from the table below.

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
| `react/jsx-props-no-spreading`, `react/no-multi-comp` | Off only in the shadcn/ui component folder |
| `react_perf/*` | The React Compiler memoises; hand-written `useCallback`/`useMemo` is noise |
| `jsdoc/require-param-type`, `jsdoc/require-returns-type` | TypeScript carries the types; JSDoc only on port interfaces |
| `typescript/prefer-readonly-parameter-types` | Fails on most library types (React props, `Request`) |
| `jest/*` that require Jest globals, hooks bans or assertion counts | The six unit files use Vitest; the Vitest rules apply instead |

Everything else in Landmines' configuration's off-list is inherited unchanged, with its reasons in that file.
