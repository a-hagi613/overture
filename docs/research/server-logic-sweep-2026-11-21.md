# Server and shared logic sweep (#302), 2026-11-21

One-time review of `src/server` and `src/shared` (not `src/web`): correctness bugs, dead code,
duplication, names, error handling and missing tests. Every finding below was reproduced against
`origin/main` at `7f62ff5` before it was written down; the fix PRs are listed with each row.

## Ranked findings

| # | Severity | Where | Finding | Fix |
|---|---|---|---|---|
| 1 | High | `src/server/catalog/geo.ts:114-121`, `:246-258` | The city lookup indexes every alias as a city name, and an alias may shadow a real city name. The dataset gives Concord, NC the alias `USA`, so `resolveLocation("New York, USA")` returns `{city: "Concord", region: "NC"}`, `resolveLocation("Remote, USA")` does the same, and `resolveLocation("TX, USA")` returns Concord. `payload.city` feeds `dedupeKeyFor`, so different US postings phrased with `, USA` collapse into one posting and city matching points at the wrong place. | Insert primary names first, then aliases, and never index an alias that is a country name, country alias, country code or remote keyword. |
| 2 | High | `src/server/platform/jobs/scheduler.ts:41-55` | `sleep()` adds an `abort` listener to the process-wide shutdown signal on every poll and never removes it when the timer wins. At the default 15 s poll that is 5 760 retained listeners and closures per day on a signal that lives for the whole process, so the loop leaks memory and eventually hits `MaxListenersExceededWarning`. | Remove the listener when the timer resolves, and resolve immediately when the signal is already aborted. |
| 3 | Medium | `src/server/catalog/geo.ts:185-196` | When the city is looked up, its `admin1` code is returned as the region: `Toronto, ON, Canada` → `region: "08"`, `Paris, France` → `"11"`, `Warsaw, Poland` → `"78"`, while the US path returns `"Texas"`/`"New York"`. Region-level targets resolve to names (`Ontario`), so `locationCondition` (`src/server/profile/targets.ts:56`) never matches a Toronto posting, and any surface that displays `region` prints a numeric code. | Return the region name for every country, and compare both the name and the legacy code in `locationCondition`. |
| 4 | Medium | `src/server/pipeline/answer-value.ts:74-84`, `:231-257` | `SALARY_RANGE` does not allow a currency token before the right-hand number, so `£50,000 - £60,000 per annum` and `$120,000 - $150,000` parse as a single amount and lose the upper bound. The catalog has a second, more capable range parser (`src/server/catalog/salary.ts:8-19`) and the two disagree. The truncated range then drives `optionContainsSalary` and number-field answers. | Accept an optional currency token on both sides of the range, and test the forms that currently lose the maximum. |
| 5 | Medium | `src/server/auth/invites.ts:84`, `src/server/dispatch/dispatch.ts:78`, `src/server/dispatch/executor.ts:162`, `src/server/dispatch/planner.ts:40`, `src/server/matching/candidates.ts:211`, `src/server/matching/score.ts:79` | Six copies of `settingNumber` with three different contracts: some require `> 0`, some `>= 0`, some truncate, some accept fractions, and one takes `keyof typeof SETTING_DEFAULTS` while the others take `string`. A bad setting silently means "off" in one module and "default" in another. | One `getSettingNumber` in `src/server/platform/settings/index.ts` with an explicit contract, adopted module by module (`dispatch/*` waits for #304). |
| 6 | Low | `src/server/platform/sse/stream.ts:31`, `src/server/profile/target-choices.ts:150`, `src/server/platform/audit/index.ts:74` | Dead exports: `purgeOldEvents`, `mergeSelected` and `listAdminAuditForActor` have no caller anywhere in `src`, `scripts`, `workers` or `test`. | Delete them. |
| 7 | Low | `src/server/pipeline/reviews.ts:76-89` | `closedApplicationIds()` returns the ids of applications whose posting is *still open*; the sweep then treats the result as `open`. The behaviour is right, the name inverts it. | Rename to `openApplicationIds`. |
| 8 | Low | `src/server/routes/profile.ts:134-158` | `GET /profile/resume/:id/file` accepts an id and ignores it: every id returns the current resume's bytes. A stale id from the UI downloads the wrong document instead of 404. | Look the resume up by id scoped to the user, and 404 when it is not theirs or gone. |
| 9 | Low | `src/server/app.ts:203-208` | `new URL(\`http://${hostHeader}\`)` throws on a missing or malformed `Host`, which turns every such request into a 500 (and skips the static route). | Parse defensively; an unusable host is the app host, not an admin host. |
| 10 | Low | `src/server/platform/llm/usage.ts:128-143` | `readLlmUsage().totals` sums only the rows of the requested page, but the name and the admin endpoint present it as the query total. | Either count over the filter or rename to `pageTotals`; the admin page only shows rows today. |
| 11 | Low | `src/server/catalog/geo.ts:163-200` | `resolveLocation("Anywhere in the US")` returns `countryCode: null` even though `countryCodesNamedIn` finds `US`, because the country is only matched against whole segments. Remote postings phrased this way lose their country. | Fall back to `countryCodesNamedIn` when no segment is a country. |
| 12 | Nit | `src/server/platform/settings/index.ts:68-73` | `getSetting` builds a `Map` from all defaults on every call; it is called in hot paths (matching, dispatch, jobs). | Build the defaults map once at module scope. |

## Verified behaviour, not fixed here

- `verifyInbound` (`src/shared/inbound-mail.ts`) and the inbound route enforce the replay window,
  the body limit and HMAC comparison correctly; no timing comparison on raw strings.
- The `retired_addresses` trigger (`drizzle/0031_left_shape.sql`) plus `mailboxes.retireFor` really
  does keep a forwarding address from being reassigned; the earlier worry was unfounded.
- `normalizeApplyUrl` strips `utm_*`, `gh_src` and `ref` and normalises the host; the dedupe key is stable.
- FTS query tokens such as `""*` do not raise in SQLite; probing `postings_fts match` found no crash.

## Blocked by open PRs

`src/server/dispatch/*`, `src/server/inbox/*`, `src/server/export/*`, `src/server/account/*`,
`src/server/routes/{admin,test-only,app,main}.ts`, `src/server/platform/db/schema.ts`,
`src/server/pipeline/{prepare,checkins,daily-prep}.ts` and `src/server/profile/onboarding-step.ts`
are touched by #298, #300, #301, #303, #304 and #311. Findings that need those files (the
`settingNumber` copies in `dispatch/*` and the `app.ts` host parse) are fixed only after the
owning PRs merge, or are left to a follow-up sweep.
