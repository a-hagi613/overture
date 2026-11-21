# The Browser Use SDK (v4) and where the proxy bill goes

Spike #180, for the owner's "adopt Browser Use's recommended path and cut every cost" ruling (parent #6). Researched
on 2026-11-21 from the published npm package, the docs site, the OpenAPI reference and the pricing page, plus a
throwaway prototype run against the local provider fixtures. No Browser Use session, no paid API call and no ATS
contact was made (ADR 0016): the prototype talked only to `test/e2e/browser-use-server.fixture.ts`, which serves
`127.0.0.1` and speaks the same `/api/v4` shapes.

Two answers, up front.

- **SDK: adopt, but not as a standalone swap.** `browser-use-sdk/v4` covers all five calls we make and passed our whole
  provider e2e, but it only replaces our six HTTP method bodies: our retry/requeue and provider-error policy stays in
  the adapter, and it has no methods for the endpoints the cost work needs (network policies, proxy switching). Do
  it inside the first PR that adds those endpoints, not on its own.
- **Cost: proxy bytes are no longer the whole story; browser minutes are now the second half.** At the recorded session
  usage (2.71 MB, 9 min 16 s) proxy is **59 %** of the bill, not 90 %. The 90 % figure only holds when a form both
  carries 10 MB or so and finishes in minutes. Two levers dominate: buying egress at $0.20/GB instead of $5/GB (saves
  56 % of the bill, needs a sales conversation or a detection experiment) and holding a form to about 9 minutes instead
  of 19 (a human code wait at $0.001/minute is what pushes a typical form from $0.0225 to $0.0325, over the $0.03 gate).

---

## 1. What "browser-use-sdk v4" actually is

The npm package is **not** at version 4. `browser-use-sdk` latest is **3.12.1**, published 2026-10-17, the 58th
version since 2025-08-09 (<https://registry.npmjs.org/browser-use-sdk>). "V4" is the API surface exposed as a subpath
export inside 3.x:

```
browser-use-sdk          → v2 API surface (legacy)
browser-use-sdk/v3       → v3
browser-use-sdk/v4       → v4 (the one the docs tell new integrations to use)
```

So `bun add browser-use-sdk@^4` fails, and a lockfile pin of `3.12.1` is a pin of the v4 API. The docs' own wording is
"Install or upgrade browser-use-sdk and use its explicit v4 import for V4"
(<https://docs.browser-use.com/llms.txt>). Anyone reading the issue title as "package version 4" will be surprised;
this note uses "the SDK (v4)" to mean the subpath.

Package facts that matter for a procurement decision:

| Fact | Value | Source |
|---|---|---|
| Latest version, publish date | `3.12.1`, 2026-10-17 | npm registry |
| Published files | 30, `932,468 B` unpacked, **`dist/` only** | tarball `package.json` `files: ["dist"]` |
| Licence | `"MIT"` in `package.json`; **no `LICENSE` file ships**, and GitHub reports no detected licence | tarball; `api.github.com/repos/browser-use/sdk` |
| Runtime dependencies | `zod ^4.4.3`, `dotenv 17.4.2` | tarball `package.json` |
| `dotenv` actually imported by the shipped bundle | **no** (no `dotenv` reference in any `dist/*.js`) | grep of the tarball |
| Optional peers | `@x402/fetch`, `@x402/evm`, `viem`, lazy-loaded | `dist/errors-*.d.ts` |
| Upstream repo | 29 stars, **88 open issues**, last push 2026-11-21T02:24Z, not archived | GitHub API |
| Known advisories | none for `browser-use-sdk` or `dotenv`; `zod` resolves to our 4.6.7 | OSV, <https://api.osv.dev/v1/query> |

Two wrinkles worth recording. The package declares `dotenv` but never imports it, which is one more install-time
dependency for nothing. And an open issue (#385, 2026-11-05) asks the maintainers to confirm the licence and copyright
notice for 2.0.15 versus 3.12.1; the npm metadata says MIT for both, and the absence of a `LICENSE` file in the
tarball is a compliance detail, not a blocker.

On vulnerabilities: the SDK's `zod ^4.4.3` range includes versions below the 4.6.6 fix for
GHSA-mrhx-c7xc-m3w5 (high: memory exhaustion while validating oversized constrained collections). Bun dedupes it onto
our pinned 4.6.7, so adopting is clean *today*; a lockfile pin and keeping zod ours is what keeps it clean.

## 2. Our five calls, mapped

Everything Overture does with Browser Use goes through `BrowserUseClient` in
`src/server/dispatch/browser/browser-use.ts` (225 lines, of which ~140 are the client and ~85 the zod schemas). The SDK
has a direct equivalent for each:

| Ours (REST) | SDK (v4) | Notes |
|---|---|---|
| `POST /api/v4/browsers` | `client.browsers.create(body)` | `body` is `Partial<CreateBrowserSessionRequest>`; the SDK throws `RangeError` client-side above 10 metadata pairs (we send 2). `timeout` defaults to 60 minutes and is capped at 240. |
| `GET /api/v4/browsers/{id}` | `client.browsers.get(id)` | Same fields. The SDK type marks `proxyUsedMb`, `proxyCost`, `browserCost` as **required strings**; our zod marks them optional and defaults to `"0"`. |
| `GET /api/v4/browsers?filterBy=&pageNumber=&pageSize=` | `client.browsers.list({ filterBy, pageNumber, pageSize })` | Returns `BrowserSessionItemView[]`, which is *not* the same type as `get`: no `recordingAvailable`, `recordingUrl` always `null`. |
| `PATCH /api/v4/browsers/{id}` `{"action":"stop"}` | `client.browsers.stop(id)` | Returns the session view; a `204` comes back as `undefined`. Docs: "Stop a browser session and refund its unused time." |
| `POST /api/v4/profiles` | `client.profiles.create({ name, userId })` | Identical. |
| `DELETE /api/v4/profiles/{id}` | `client.profiles.delete(id)` | Returns `void`. |

What the SDK does **not** cover, and we will want:

- **Network policies** (`POST/PATCH /api/v4/network-policies`): the docs say plainly "The SDKs do not have methods for
  them yet, so the examples use REST" (<https://docs.browser-use.com/cloud/browser/network-policies.md>).
- **Proxy switching** (`PATCH /api/v4/browsers/{id}/proxy`, modes `managed`/`rotate`/`target`/`direct`/`custom`). Not a
  resource on `client.browsers`, and `client.http` is `private` in the types.
- **Session cost** (`GET /api/v4/sessions/{id}/cost`) is modelled as `client.sessions.cost(id)`, but sessions are the
  *agent* concept; for a standalone browser we keep reading `GET /browsers/{id}`, as today.

So the SDK covers the part we already have and not the parts the cost work needs. That matters for the recommendation.

## 3. Behaviour we would inherit

Read from the shipped `HttpClient` (`dist/chunk-KGKGYVLJ.js`) rather than from prose, because the docs do not describe
retries at all.

| Behaviour | SDK 3.12.1 | Our client today | Consequence |
|---|---|---|---|
| Request timeout | **30 s per HTTP call**, `AbortController`, configurable | no explicit timeout (whatever `fetch` defaults to) | Strictly better: a hung create cannot pin a worker forever. But a create that times out may still have created the session, which then waits for the sweep. |
| Retry on 429 | Any method, up to `maxRetries` (default 3), backoff `min(1s·2ⁿ, 10s)+jitter`, **only when `Retry-After` ≤ 10 s** | Up to 6 retries, same backoff, `Retry-After` honoured at any length, long delays become `RetryLaterError` | Different policy. A 300 s `Retry-After` is not retried by the SDK; it throws with `retryAfter: 300`. A short 5 s 429 *is* swallowed by the SDK, so our requeue path sees fewer of them. |
| Retry on network errors | **GET only**, and not when a custom `fetch` is injected | none | Safer defaults than a blind retry; POST is never duplicated. |
| Retry on 502/503/504 | **GET only** | none | Fine for `get`/`list`. |
| Redirects | Never followed (`redirect: "manual"`), so the API key cannot leak to another origin | fetch default (follow) | Small hardening win. |
| Error shape | `BrowserUseError { statusCode, detail, retryAfter? }`; 402 with `detail.code === "api_key_monthly_spend_limit_reached"` becomes `APIKeySpendLimitError { cap, spent }` | `BrowserUseApiError { status, retryAfterMs }`; 402/403 already mapped to `ProviderUnavailableError` | The SDK's `APIKeySpendLimitError` is a better signal for the owner's "cap reached" alert than a bare 402. |
| Base URL | `https://api.browser-use.com/api/v4` — **includes `/api/v4`** | `BROWSER_USE_API_BASE_URL` is `https://api.browser-use.com`, paths add `/api/v4` | Adapter must append `/api/v4` when it maps our env var, or every call 404s. A footgun worth a comment in code. |

Two policies stay ours in either world: **429 → `RetryLaterError` with the exact delay** (so the job is requeued
without spending an attempt, SPEC §10.1) and **402/403 → `ProviderUnavailableError` + kill switch**. The first one is
*inside* our client today, so adopting the SDK means moving it into the adapter; the second is a three-line mapping on
`statusCode` because the SDK makes a plain 402 (insufficient credit) a generic `BrowserUseError`.

## 4. Typing findings

- **`exactOptionalPropertyTypes` fights the SDK.** `browsers.list` takes `filterBy?: "active" | "stopped" | null`, and
  our repo compiles with `exactOptionalPropertyTypes: true`, so passing `filterBy: undefined` is a type error
  (`TS2379`). The adapter has to spread conditionally. This is the only friction the typecheck surfaced, but every
  optional SDK parameter has the same shape.
- **`proxyCountryCode` is a 248-value union, not a string.** Our port passes `string` (from
  `BROWSER_PROXY_COUNTRY`, `z.string().length(2)`). The adapter needs a cast or a country-code validator; casting
  throws away exactly the check the SDK's types were generated to give us, so a zod country enum at the port is the
  better answer.
- **`browserSettings.proxyCountryCode` is required whenever `browserSettings` is present** (agent runs only; the docs
  call this out as a current TypeScript gap). Our standalone browsers pass `proxyCountryCode` at the top level, so this
  does not bite us today.
- **Cost fields are strings and required.** The SDK matches the API (`proxyUsedMb`/`proxyCost`/`browserCost` are
  decimal strings). Our zod makes them optional and tolerant, which is why a hollow or older response still records
  zero cost instead of crashing — keep that boundary and parse the SDK's response with our schema.
- **Known upstream bug (#371/#370, open since 2026-10-23):** the v4 layer does not lowercase `proxyCountryCode` while
  v2 and v3 do, and the API only accepts lowercase. Our send path is safe (`src/server/config/env.ts` lowercases
  `BROWSER_PROXY_COUNTRY`), but **`src/server/probe/run-file.ts` validates `country` as `z.string().length(2)` without
  lowercasing**, so a capture file written as `"CA"` fails either way. Not a regression from the SDK; worth a
  one-line fix.
- **The generated types lag the spec.** The published `CreateBrowserSessionRequest` still says browser time is
  "$0.02/hour" while the live reference says "at your account rate" and pricing says $0.06 (§6), and the docs
  themselves warn to "use the public REST schema when installed SDK types lag new fields". Treat the SDK types as a
  convenience, not the contract; our zod schema at the boundary stays.

## 5. The prototype, and what it proved

Run on 2026-11-21 on the dev box, against the local fixtures only:

1. `bun add -d browser-use-sdk@3.12.1` (installed cleanly; one postinstall was blocked by Bun's default policy).
2. Wrote a 146-line adapter (`BrowserUseClient(apiKey, baseUrl, clock)`) that returns the *same* object shape as
   `browser-use.ts`, backed by `new BrowserUse({ apiKey, baseUrl, maxRetries: 0 })`, mapping the SDK's errors onto our
   `BrowserUseApiError` / `ProviderUnavailableError`, and re-implementing the 429 → `RetryLaterError` policy.
3. Pointed `src/server/dispatch/browser/index.ts` and `test/e2e/browser-providers.test.ts` at it.
4. `bun check` → `✓ No type errors in 731 files`.
5. `bun node_modules/playwright/cli.js test test/e2e/browser-providers.test.ts --workers=1`:
   - first run **8 passed, 1 failed** — "a 429 with a long Retry-After moves the retry to that delay" got
     `BrowserUseApiError` instead of `RetryLaterError`, because that policy lives in our client, not in the SDK;
   - after porting the policy into the adapter, **9 passed (9.2 s)**.
6. Reverted everything. `git status` is clean and the branch's only change is this file.

What that establishes:

- The swap is mechanically safe: every behaviour our provider port is tested for (create → CDP → stop → usage, failed
  stop falling back to `GET`, unsettled usage, 429 requeue, 402/403 kill switch, per-user profiles, sweep listing,
  proxy trim during a real send) survives with the SDK behind the port.
- The SDK does **not** remove the policies we care about. The adapter came out at 146 lines against a ~140-line client
  that already includes its zod schemas; about 30 of those adapter lines are our own 402/403 mapping and 429 requeue.
  **The saving is typing effort and a maintained contract, not code volume.**
- The real gain is the generated types plus a 30 s request timeout and a typed spend-limit error. That is worth having
  in the PR that also adds network policies, because that PR will write REST calls the SDK cannot make and will benefit
  from keeping one HTTP layer.

**Recommendation: adopt the SDK (v4) — yes, when the cost-lever endpoints land.** Concretely: keep the hand-written
client until the PR that adds network policies and/or proxy switching; in *that* PR, put `browser-use-sdk/v4` behind
the existing port for the five covered calls, keep the zod boundary, keep our 429/402/403 policy in the adapter, and
document the `/api/v4` base-URL mapping. A standalone SDK-only PR is churn: it buys no cost saving and no new
capability, and it adds a dependency we then have to upgrade on our own schedule. Do not migrate the Kernel adapter.

---

## 6. The bill, as Browser Use describes it

| Item | Rate (2026-11-21) | Source |
|---|---|---|
| Browser time | **$0.06 per browser-hour**, billed by the minute, **1-minute minimum**, 4-hour session cap | <https://browser-use.com/pricing>, `POST /browsers` reference |
| Home-IP (residential) proxy | **$5/GB** | pricing page |
| Direct egress, or your own proxy (enterprise) | **$0.20/GB** | pricing page ("Proxy off: $0.20 / GB") |
| CAPTCHA solving | included | pricing page |
| Charging model | **Full rate charged upfront at session start; unused time refunded proportionally on stop** | `POST /browsers` reference |
| Unit conversion | MB→GB by **/1024** (`74.13 MB → 74.13/1024 × $0.20 = $0.01448`) | <https://docs.browser-use.com/cloud/guides/billing.md> |
| Settlement | browser and proxy cost keep growing **until the browser stops**; LLM settles up to ~90 s after a run | billing guide |

Three consequences that change design decisions:

1. **Stopping is the refund.** The upfront charge is the full `timeout` (15 minutes for us). A crashed process that
   never stops its session costs the full 15 minutes — **$0.015** — unless the recovery sweep releases it. Our sweep
   (every minute, SPEC §9.4) is therefore a direct cost control, not just hygiene.
2. **A zombie is cheaper at a shorter timeout.** Dropping `timeoutMinutes` from 15 to 12 caps a lost session at $0.012
   without touching the 10-minute code-paste path. Small, free, safe.
3. **The 1-minute minimum makes fast failures nearly free** ($0.001 plus whatever proxy bytes were spent), so retrying an
   attempt that dies early is cheap; retrying one that dies at minute 9 is not.

One inconsistency to be aware of: the **published SDK's generated types** document the timeout field as "Browser sessions are
charged **$0.02/hour**", while the current `POST /browsers` reference says "per browser-hour at your account rate" and the
pricing page says **$0.06/hour**. The SDK types are stale here — the docs warn that installed SDK types can lag the
spec. If $0.02 were the real rate, proxy would be 80–90 % of the bill again. The owner should confirm the rate on the
project's billing page before the cost gate is finalised; this note uses $0.06, the number on the pricing page.

## 7. Where the money goes on one application

Using the usage the fixture records for one send (2.71 MB proxied, 556 s = 9 min 16 s), at $0.06/h and $5/GB:

| Line | Arithmetic | Cost |
|---|---|---|
| Browser | 9.27 min × $0.001 | **$0.00927** |
| Proxy | 2.71/1024 × $5 | **$0.01323** |
| **Total** | | **$0.0225** |

That is 59 % proxy, 41 % browser. "Proxy is about 90 % of the bill" is only true when a form is heavy *and* fast:

| MB per form ↓ / minutes → | 4 | 6 | 9.3 | 12 | 15 |
|---|---|---|---|---|---|
| 1.0 | 55 % | 45 % | 34 % | 29 % | 25 % |
| 2.0 | 71 % | 62 % | 51 % | 45 % | 39 % |
| 2.71 | 77 % | 69 % | **59 %** | 52 % | 47 % |
| 4.0 | 83 % | 76 % | 68 % | 62 % | 57 % |
| 6.0 | 88 % | 83 % | 76 % | 71 % | 66 % |
| 8.0 | 91 % | 87 % | 81 % | 76 % | 72 % |
| 12.0 | 94 % | 91 % | 86 % | 83 % | 80 % |

So the two levers compete for the same gate:

- **A human code wait doubles the browser line.** The same form with a 10-minute paste wait is 19.3 minutes:
  $0.0193 + $0.0132 = **$0.0325**, over the $0.03 gate on its own. Every minute of waiting is $0.001.
- **At 85 % completion** (ADR 0026's gate definition divides spend by *sent*, not attempted) the same numbers become
  $0.0265 and $0.0383. The typical form passes; the typical form *with* a code wait fails.
- **Proxy trim at the fixture's ratio** cuts 2.71 MB to 1.04 MB: $0.0143 total, i.e. **$0.0168 per completed
  application** — comfortably under the gate. Real ATS pages carry fewer fonts/video than the synthetic page, so the
  realistic saving is smaller (see §8).

## 8. Measured: what the trim actually saves

Measured on the local fixture (`test/e2e/proxy-weight.fixture.ts`) through a real local Chromium driven exactly like a
send (`applySendProxyTrim` then one navigation), the same measurement `test/e2e/browser-providers.test.ts` asserts:

| Resources | Without trim | With trim | Difference |
|---|---|---|---|
| Body bytes served by the fixture | 1,275,563 B | 490,563 B | −785,000 B |
| Share of body bytes | 100 % | 38.5 % | **−61.5 %** |
| Paths in the fixture's request log | all 8 resources + the page | `/`, `/app.js`, `/data.json`, `/image.png`, `/turnstile.js` | `/font.woff2`, `/media.mp4`, `/analytics.js`, `/pixel.gif` never appear in the log at all |
| Trimmer-blocked bytes billed by a proxy | 785,000 B | **0 B** | `route.abort()` runs before the request leaves, so these bytes are not proxied |

Assumptions, stated plainly:

- The fixture is a synthetic worst case built to assert behaviour, not a model of an ATS. Its weights are 512 KB video,
  240 KB image, 180 KB font, 90 KB "analytics", and 490 KB of app/data/turnstile; the page itself is about 0.5 KB. Real
  apply pages ship little or no video, so 61.5 % is an upper bound.
- With a plausible per-ATS profile (300 KB HTML, 0.7–1.4 MB JS, 90–150 KB CSS, 300–500 KB images, 200–320 KB fonts,
  150–260 KB trackers, ~100 KB captcha), the trim removes **16–22 %** of bytes, i.e. **$0.002–0.003 per form** at
  $5/GB. That is the number to carry into the gate, not 61.5 %.
- Body bytes only: HTTP headers are excluded, and a proxy bills those too. Headers are a few hundred bytes per request
  and change none of the conclusions.
- Every byte counted here is a byte the *page* asked for. Blocks are skipped entirely, so no request is sent and no
  response is billed. Verified by the fixture's request log, which never sees the blocked paths.

**The trim lever is already banked** (#179 shipped it). What remains is tuning it per ATS from measurements on the real
early-probe forms, because the ratio — not the mechanism — decides the saving.

## 9. Ranked cost levers

Savings are per *attempt* against the §7 baseline (2.71 MB, 9 min 16 s, $0.0225) unless stated; "per completed" divides
by 0.85.

| # | Lever | What changes | Saving per attempt | Confidence | Cost / risk | Follow-up |
|---|---|---|---|---|---|---|
| 1 | **Buy egress at $0.20/GB** | Bring our own proxy (`customProxy`, enterprise) or run the session direct (`proxyCountryCode: null`). Proxy line falls 25×. | **−$0.0127 (−56 %)** → $0.0098 total | High on price, **low on stealth** | Custom proxies are enterprise-only (sales, or projects created before 2026-11-13); a direct exit is a datacentre IP and will lose some reCAPTCHA scores. Needs a lab A/B per ATS before real sends. | Trial direct/BYO egress and measure detection per ATS |
| 2 | **Hold the form under ~10 minutes** | The code wait is the difference between $0.0225 and $0.0325. Shorten the paste expiry (10 → 5 minutes), or make the expiry per user a setting. | **−$0.005 per avoided 5 minutes** (and it is what keeps the gate) | High on arithmetic, product call on UX | Shorter paste window means more `code_timeout` attempts, which still cost their minutes. A stop-and-resume would re-fill the form and risk a fresh challenge — do not. | Cap the code-paste window, or report p95 minutes against the gate |
| 3 | **Proxy trim per ATS** | Extend `proxy-trim.ts` with the tracker hosts each ATS actually loads, from the probe capture. | −$0.002–0.003 realistic (banked: #179) | High | None; the blocklist is inert on sites that do not use it. Never block images, scripts, XHR or captcha hosts (SPEC §10.3). | Per-ATS tracker list from the first five real sends |
| 4 | **Cheaper zombie sessions** | `timeoutMinutes` 15 → 12, and keep the sweep. | −$0.003 per lost session | High | A code wait that starts at minute 9 has 3 minutes left instead of 6. | Lower the vendor timeout |
| 5 | **Proxy-level network policy** | `networkPolicyId` on create, blocking the same hosts at the proxy (REST; no SDK method). | ~$0 on the fixture (the trim already sends 0 bytes) | Medium | Defence in depth: catches service-worker, prefetch, iframe and CSS loads that a Playwright router can miss, and applies before our code runs. Blocked requests get a proxy 403. | Add a network policy behind the trim |

### The ledger: what we are not doing, and why

Rejected and unavailable levers are recorded so nobody re-runs the experiment. Every row was checked against the
docs, not assumed.

| Lever | Verdict | Why | What would change it |
|---|---|---|---|
| Cached assets through the profile | **Not available** | Profiles persist "cookies, local storage, and login state"; the docs state cookie sync "does not import saved passwords or promise a persistent HTTP disk cache", and `POST /browsers` has no cache knob. The EU page lists "browser response caching" as disabled there, so if caching exists it is on the *agent* path, not standalone browsers. | A `cache`/`persistAssets` field appearing in `CreateBrowserSessionRequest`. |
| Headless browsers | **Not available** | `CreateBrowserSessionRequest` has no headless flag; every cloud browser is the stealth build. | Nothing on our side; Kernel is the headless fallback and ADR 0026 already prices that trade-off. |
| A cheaper proxy *type* | **Not available** | The only managed choice is a country code; no datacentre/mobile/residential tier, no city or state, and "a new managed browser does not guarantee a unique proxy IP or particular city". Buying a *type* means bringing our own proxy (lever 1). | A type field in the API. |
| Batch several sends into one session | **Rejected** | Browser time is billed by the minute per session, so a second send in the same session saves its one-minute rounding, not its minutes. One-in-flight is a spec rule and coupling two employers to one failure is worse than the saving. | A per-session minute cap that rounds down across sends (it does not). |
| Stop the browser at the code prompt and reopen on paste | **Rejected** | It would save the idle minutes but lose the filled form; re-filling costs more minutes than it saves and risks a fresh challenge on a new exit IP. | A vendor feature to suspend rather than stop a session. |
| Block images as well as fonts/media | **Rejected for now** | Contradicts SPEC §10.3, can break image-rendered captchas and employer logos, and a page with no images is itself a signal. Worth ~19 % of the synthetic page's bytes, less in reality. | A lab run showing no change in completion or challenge rate. |
| Drive the form with an agent run instead of CDP | **Out of scope** | We already read each ATS over plain HTTP and fill deterministically; an agent run would add LLM tokens on top of the same browser and proxy bill. | Never, for a form whose answers are already approved. |

## 10. What to measure next, and how

The arithmetic above rests on one recorded usage figure. ADR 0026 already schedules the measurement: about five real
Greenhouse applications from `overture-web`, approved by the owner, through the existing `attempts.proxy_bytes` /
`browser_ms` / `cost_micros` columns. To make those five answer this note's questions, record per attempt:

1. `proxyUsedMb` and `browserCost`/`proxyCost` from `GET /browsers/{id}` **after** stop (the settle loop already does
   this, #179), plus the wall-clock split: navigate → form filled → preflight → submit → confirmation.
2. The same, minus the code-wait minutes, so lever 2's saving is measured rather than inferred.
3. `Request`/`response` byte counts per resource type during one send (a CDP `Network.dataReceived` sum grouped by
   `resourceType`), to replace §8's plausible-profile estimate with per-ATS truth. This is local instrumentation of a
   production session the owner already runs — no extra traffic.
4. Whether the trimmed requests were fonts/media/trackers or something an ATS actually needed (a `form_changed` or a
   missing-logo report is a signal the trim went too far).

Change **one lever at a time**. The egress trial must hold the blocklist and the minutes constant, or the number
answers nothing; the trim tuning must hold the route constant. The fixture makes that cheap locally, and the five real
sends are the check.

The $0.03-per-completed-application gate is the budget; the regression guard is the existing `browser.proxy_trend`
alert (latest 20 completed applications above 1.2× the previous 20). One gap: that alert watches **proxy bytes only**,
and §7 puts browser minutes at 41 % of the bill, so a rising `browser_ms` per completed application would not alert
today. Add a minutes trend beside it (follow-up 8).

## 11. Limits of this note

- **No real session, by design.** Prices, refunds, settlement and blocking behaviour are read from Browser Use's own
  docs and OpenAPI, not observed. Where a doc is stale (the $0.02/hour comment) both numbers are quoted.
- **The trim ratio is synthetic.** 61.5 % comes from a fixture built to assert aborts, not to model an ATS; §8's
  16–22 % estimate is labelled as an estimate.
- **The prototype was reverted**, so the SDK is not in the tree and its numbers are not reproducible from `origin/main`;
  §5 records the exact steps and outputs. Anyone re-running it should expect the same 8-then-9 test result unless
  upstream ships the 429 policy or fixes #371.
- **Enterprise terms are unknown.** Custom proxies and cheaper prices are sales conversations; nothing here assumes a
  quote.
- **Nothing is decided here.** The recommendation is a proposal; ADR 0028's "Browser Use Cloud stays the browser"
  stands until the owner rules, and SPEC §10.3's "proxy traffic is about 90 % of Browser Use's bill" is qualified, not
  corrected, until real numbers replace the fixture's. Both get their edit in the PR that acts on this note.
- **The 90 % proxy claim is not wrong, it is conditional.** It is true at roughly 10 MB or more per form, or on a form
  that finishes in 4–6 minutes (§7). Whether real forms are that heavy is the first thing the five-send probe answers.

## 12. Follow-up tickets

1. **Egress trial: direct vs BYO proxy, measured per ATS** (biggest lever, needs the owner or a sales conversation).
2. **Cap the code-paste window** (or report p95 minutes against the $0.03 gate) — the second-biggest lever.
3. **Per-ATS tracker hosts for `proxy-trim.ts`**, from the five-send probe.
4. **Network policy behind the trim** (REST; also the natural home for the SDK swap).
5. **SDK adoption inside the network-policy/proxy PR**, plus lowercasing `country` in `src/server/probe/run-file.ts`.
6. **Lower `SESSION_TIMEOUT_MINUTES` to 12** and keep the sweep as the refund control.
7. **Amend SPEC §10.3 and ADR 0028** with the measured proxy/browser split once the five-send probe replaces the
   fixture's numbers (and add an ADR line if the owner rules to adopt the SDK).
8. **Trend browser minutes, not just proxy bytes**, in the admin report (`browser.proxy_trend` has no minutes twin).

## Sources

All read on 2026-11-21.

- npm registry metadata and tarball `browser-use-sdk@3.12.1` (types `dist/v4.d.ts`, client `dist/v4.js`, HTTP layer
  `dist/chunk-KGKGYVLJ.js`): <https://registry.npmjs.org/browser-use-sdk>
- Docs index and agent instructions: <https://docs.browser-use.com/llms.txt>, full bundle
  <https://docs.browser-use.com/.well-known/llms-full.txt>
- Pricing: <https://browser-use.com/pricing>
- Billing, refunds and settlement: <https://docs.browser-use.com/cloud/guides/billing.md>
- Create browser session (fields, upfront charge and refund, 4-hour cap):
  <https://docs.browser-use.com/cloud/api-v4/browsers/create-browser-session.md>
- Proxies (country codes, `null` to disable, `customProxy`, `PATCH /browsers/{id}/proxy` modes, enterprise gate):
  <https://docs.browser-use.com/cloud/browser/proxies.md>
- Network policies (proxy-level allow/block, REST only, "the SDKs do not have methods for them yet"):
  <https://docs.browser-use.com/cloud/browser/network-policies.md>
- Browser quickstart (CDP pattern, profiles are not an HTTP cache):
  <https://docs.browser-use.com/cloud/browser/quickstart.md>, <https://docs.browser-use.com/cloud/guides/authentication.md>
- EU deployment differences (no response caching, no proxy endpoint):
  <https://docs.browser-use.com/cloud/eu-deployment.md>
- Upstream repo state and issue #371/#370 (v4 does not lowercase `proxyCountryCode`):
  <https://github.com/browser-use/sdk/issues/371>
- Local evidence: `test/e2e/browser-providers.test.ts`, `test/e2e/proxy-weight.fixture.ts`,
  `test/e2e/browser-use-server.fixture.ts`, `src/server/dispatch/browser/{browser-use,browser-use-provider,proxy-trim}.ts`.
