# Managed cloud browsers vs. the self-hosted runner

Study for decision S2-00 (feeds S1-03, S1-04, S2-07). Researched 2026-11-19 from vendor pricing pages, vendor docs, GitHub repos, and the few benchmarks that exist. No account was created and no traffic was sent to any ATS. Every price is the vendor's own figure on 2026-11-19 unless marked **unverified**. Per-application costs are my arithmetic on those figures.

Cost scenarios used throughout:

- **Typical:** 3 browser-minutes, 3 MB proxied traffic, 0.2 CAPTCHA solves.
- **Worst:** 10 browser-minutes, 15 MB, 1 CAPTCHA solve.

"Own proxy" means Evomi Core Residential at $0.49/GB (100 GB plan) to $0.99/GB (pay as you go), or DataImpulse at $1/GB.

---

## 1. Bottom line

- **No vendor beats the self-hosted runner on cost per application.** Self-hosted costs about **$0.0024–0.0045** typical and **$0.014–0.021** worst. The cheapest credible managed bundles cost **$0.018** typical (Browser Use Cloud) and **$0.024** (Kernel headful, Bright Data). Using a vendor's browsers with our own proxy costs **$0.007–0.009** (Browserbase, Steel).
- **On CAPTCHA, no vendor publishes a success rate against invisible, score-based reCAPTCHA**, which is the Greenhouse problem. Their solvers target visible challenges. A good reCAPTCHA score still comes from a clean IP plus a coherent fingerprint, so **no vendor lets us skip residential or ISP IPs**.
- **Two vendors include the proxy in their price, so we could drop our proxy contract:** Kernel (ISP, residential and mobile proxies, "unmetered and not billed") and Browser Use Cloud ($5/GB residential, 195+ countries). Neither guarantees one fixed exit IP per user across days. Anchor offers a dedicated sticky IP per profile (price unpublished), and Browserbase (Scale plan only) and Steel offer static or dedicated IPs.
- **The real case for a vendor is engineering effort, not cost.** A vendor gives us live view with input, encrypted per-user profiles, pools and a patched browser. That is roughly 5–8 engineer-weeks plus upkeep on our side. At 30,000 applications a month the vendor premium is about **$400–750/month**.
- **Detection evidence is weak everywhere.** All the stealth benchmarks are run by vendors or affiliate sites, and they test Cloudflare, DataDome and PerimeterX walls rather than reCAPTCHA v3 scores.
- **Recommendation:** keep S1-03 (self-hosted, behind `BrowserProvider`). In M1, bake it off against **Kernel** and **Browser Use Cloud**, with Browserbase plus our own proxy in reserve. Adopt a vendor only if its *completed*-application rate beats ours by a margin worth about $0.015–0.02 per application, or if its live view clearly beats ours on a phone.

---

## 2. Comparison table

CDP means `chromium.connectOverCDP(wsUrl)` from `playwright-core`. Every vendor marked yes documents or shows it. None requires its SDK for the browser itself; SDKs only create sessions. Bun compatibility of `connectOverCDP` against remote endpoints is assumed, not tested (**unverified**).

| Vendor | CDP | Built-in proxy, sticky, geo, BYO | CAPTCHA | Stealth / fingerprint | Profiles | Live view with input | Limits and regions | Price (2026-11-19) | $/app typical | $/app worst | Month at 300 / 3k / 30k | Compliance, ToS, maturity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Self-hosted** (Fly shared-cpu-2x 2 GB, yyz) | native | Evomi / DataImpulse sticky (DataImpulse up to 120 min); country, city and ISP targeting | none now (Review via Live Tab); optional CapSolver | ours: headed Chrome under Xvfb, plus patches we choose | ours (R4-07) | ours to build (CDP screencast) | as we build; yyz | $0.0186/h compute; $0.49–1/GB | **$0.0024–0.0045** | **$0.014–0.021** | ~$2–16 / ~$12–20 / ~$95–135 (see §4) | all ours |
| **Browserbase** | yes | residential in 200+ countries; US state and city; CA supported; sticky within a session not stated; static IPs Scale only; BYO on Developer+ | auto by default; types not listed; 5–30 s; console events | standard sessions report **Linux**; "Verified" custom Chromium (Windows by default) on **Scale only** | Contexts: user-data dir, encrypted at rest, kept indefinitely; 1 writer | iframe, read/write; mobile viewport documented; no virtual keyboard | 6 h sessions; 25/100/250+ concurrent; 25/50/150 creates/min; us-west-2, us-east-1, eu-central-1, ap-southeast-1 | Dev $20 (100 h, 1 GB), Startup $99 (500 h, 5 GB); $0.12/$0.10 per h; $12/$10 per GB; per-minute billing, 1-min and 1-MB minimum | $0.035; **$0.0065–0.008 with own proxy** | $0.167; $0.024–0.032 own | $20 / $122 / $1,049; own proxy: ~$21–35 / ~$35–41 / ~$243–288 | SOC 2 Type II; ToS has no clause on third-party sites or CAPTCHAs; $67.5M raised (Series B Jun 2025, $300M valuation) |
| **Kernel** | yes | **proxies unmetered**: ISP (default in stealth; US/SG/UK/FR/DE), residential (country, US state, city, ZIP, ASN; IP may change per connection), mobile; Canada not documented; BYO on Start-Up+ | stealth mode: "reCAPTCHAs, Cloudflare challenges, and similar"; included | **headful by default**; "anti-detection optimizations" not detailed; Web Bot Auth opt-in | encrypted end to end with a per-org key; 1 writer; retention not stated | iframe; input allowed (`scope`/`readOnly` for view-only); mobile not stated | up to 72 h; 5/10/150 concurrent; us-east, eu-west, ap-southeast | headful $0.48/h, headless $0.06/h, per second; Hobbyist $30 (incl. $10), Start-Up $200 (incl. $50) | **$0.024** headful ($0.003 headless) | $0.080 ($0.010) | ~$30 / ~$92 / ~$870 headful | SOC 2 Type II report on request; AUP bans "bulk unsolicited … form submission" but says "If a person may lawfully browse a site and take an action on it, their agent may too"; $22M seed+A (Accel, Oct 2025) |
| **Browser Use Cloud** | yes (v4 `cdpUrl`) | residential on by default, 195+ countries by code; **no state or city**, no unique IP guaranteed; `rotate` API; BYO **Enterprise only** | auto by default; types not listed; "not guaranteed"; Cloudflare-type walls left to stealth | hardened Chromium fork; fingerprint randomized per session | profiles: cookies, localStorage, login; saved on stop; encryption not stated | iframe, interactive by default, `readOnly=true`; mobile not stated | 4 h hard max; 10 → 1,000 concurrent by lifetime spend; US/EU API | **$0.06/h** per minute (1-min minimum); **$5/GB**; captcha included; pay as you go | **$0.018** | $0.085 | $5 / $54 / $540 | SOC 2 Type II, DPA; ToS bans "robots, scraping" and circumventing "content protections" (ambiguous); $17M seed (Mar 2025) |
| **Anchor** | yes | Anchor proxy: country, region and city (CA as a country only); **dedicated sticky IP per profile**; BYO $0.20/GB | auto; types: cloudflare, recaptcha (invisible/checkbox), hcaptcha, funcaptcha, datadome, kasada, akamai, perimeterx, altcha; CDP `Captcha.lifecycle` events | "Extra Stealth" Chromium on Growth ($2,000/mo) or with sticky-IP profiles; ScrapeOps: Chrome 136, macOS UA on Linux platform | profiles (managed auth) | iframe, interactive (headful default) | idle 5 min, max 180 min by default (no upper limit) | $0.01/browser + $0.05/h (nearest minute) + $8/GB; Starter $50, Growth $2,000 | $0.0365; $0.015–0.016 own | $0.138; $0.029–0.036 own | $50 / $110 / $1,095 | SOC 2 Type 2, ISO 27001 on Growth+; infrastructure in the US |
| **Steel** (cloud) | yes | residential (country, US state, city); new IP each session; dedicated/fixed IPs; BYO free | **reCAPTCHA v2/v3, hCaptcha, Turnstile, image, sliders**; not DataDome, Imperva, AWS WAF, FunCAPTCHA; $3 or $1 per 1k | injected fingerprint; own Chromium fork (Enterprise or by approval); `humanizeInteractions`; ScrapeOps: "CDP automation" detected | profiles ≤300 MB, deleted after 30 days unused | iframe `debugUrl`, interactive by default | 15 min (Launch), 1 h (Scale), 24 h (Enterprise); 10/100/1,000+ concurrent | Launch $0 + $0.10/h, $10/GB; Scale $250/mo + $0.08/h, $6/GB; per second | $0.036 (Scale $0.022); **$0.007–0.009 own** | $0.170 (Scale $0.104) | $11 / $107 / $816–1,068 | ToS §8 forbids using it "to violate any website's terms of service" and "to bypass security measures … without authorization"; SOC 2 not found |
| **Steel self-host** | yes | BYO only | none in repo | "stealth plugins and fingerprint management" | yes | session viewer UI | ours | Apache-2.0, free; 8.0k stars | = self-hosted | = self-hosted | = self-hosted | could replace our pool and live-view code |
| **Hyperbrowser** | yes | residential, 100+ countries incl. CA, US state or city; static IPs; BYO Enterprise only | paid plans; manual targets: Turnstile, Cloudflare, reCAPTCHA (visual); "some sites require proxies" | `useStealth`; Ultra Stealth Enterprise only | profiles: cookies, local/session storage, cache; encryption not stated | iframe, interactive by default | not stated | $0.10/h, $10/GB; Startup $30, Scale $100 | $0.035 | $0.167 | $30 / $105 / $1,050 | SOC 2 claims only on its own SEO blog (**unverified**); last in two Browser Use benchmarks |
| **Browserless** (cloud) | yes | residential (6 units/MB), datacenter; BYO | `solveCaptchas=true`; 10 units per successful solve; reCAPTCHA, hCaptcha, Cloudflare, DataDome | `/stealth` routes; ScrapeOps: `webdriver=true`, HeadlessChrome UA, SwiftShader | 1–90 day persistence by plan | Hybrid automation (paid) | 15/30/60 min max; 10/40/100 concurrent | 1 unit per 30 s; $0.0007–0.002/unit (Scale incl. → Prototyping overage); annual prices | $0.018–0.052 | $0.084–0.24 | $25 / $140 / ~$770 | self-host is SSPL or commercial; stealth and CAPTCHA are premium only |
| **Bright Data Browser API** | yes | residential auto-selected; country flag; IP reused across sessions via a custom CDP call | included; `Captcha.solve` CDP | managed fingerprint; ScrapeOps 97 | not documented (**unverified**) | DevTools debugger (`Page.inspect`); not an embeddable end-user view (**unverified**) | 60 min max, 5 min idle; **one domain per session**; password entry off without KYC | **$8/GB**, no time charge; Scale $499 (71 GB) | $0.024 | $0.120 | ~$0–7 / $72 / ~$651–720 | AUP bans "fake accounts"; KYC for some domains |
| **Oxylabs Agent/Unblocking Browser** | yes | residential, "country, city, and state" (not confirmed for the browser) | "dynamic CAPTCHA management" | "pre-patched" | "persistent profile management" | recording / inspect | not stated | $8 → $4/GB by tier; Starter $15, Basic $100, Flexible $500 | $0.016–0.024 | $0.083–0.12 | ~$15 / ~$100 / ~$500 (tier fit inferred) | thin docs; not evaluated further |
| **Scrapeless Scraping Browser** | yes | residential, $1.80/GB | included: reCAPTCHA, Turnstile, CF 5s; claims "98%+" (**unverified**) | ScrapeOps 79: always America/New_York, Chrome 140 | encrypted, with a profile pool | "DOM streaming" live view (input **unverified**) | `sessionTTL`; KYC for higher concurrency | $0.09/h + $1.80/GB (base rate); prepaid packages, unused funds forfeited | $0.0099 | $0.042 | $3 / $30 / $297 | cheapest bundle; maturity and fingerprint quality are the risks |
| **Scrapfly Cloud Browser** (discovered) | yes | residential $6.05–7.99/GB | not stated | ScrapeOps 96 | not stated | VNC/RTC add-on, 5 credits each | not stated | 1 credit per 30 s (min 5); residential 52–78 credits/MB; Pro $100 = 1M credits | ~$0.024 | ~$0.12 | $30 / $100 / ~$704 | ScrapeOps (which ranked it) is affiliate-linked |
| **Notte** | yes | residential $10/GB; BYO $0.20/GB on Startup ($100) | included | included | "Personas" | not checked | 15/120/300 min max; 5/25/100 concurrent | **$0.01/h** browser (rounding policy **unverified**), $10/GB | $0.031; $0.003–0.004 own | $0.152 | $20 / $92 / $915; own proxy ~$177–222 at 30k | young; the browser rate looks like a loss leader |
| **Rebrowser** | not stated on the pricing page (**unverified**) | BYO free on all plans | detection on Starter, solver on Business+ | "unique device fingerprints" | 5–500 persistent profiles | not checked | **1 / 5 / 20 / 100 concurrent** | $0.17–0.50/h; plans $49–999 | ~$0.009–0.025 + own proxy | ~$0.03–0.08 + own | concurrency forces Business ($499) at 30k | concurrency tiers make it expensive |
| **Airtop** | yes (default context only) | integrated proxy; custom on Professional | not stated | not stated | yes | yes | 3/30/100 concurrent | credits; CPU-time and proxy rates unpublished | not computable | – | – | agent-first; dropped |
| **Cloudflare Browser Run** | Browser Sessions (CDP); Live View and Human in the Loop | **none listed** (no proxy page in the docs index; all egress is Cloudflare IPs, no rotation) | none listed | – | – | – | 10 concurrent incl., then $2 each; 60 s idle close, `keep_alive` up to 20 min | $0.09/h after 10 h | $0.0164 with no proxy; $0.0319 with a $5/GB proxy (see #288) | – | – | always identified as bot traffic; dropped in #288 |
| **Zyte API** | **no** (actions API) | – | – | – | – | – | – | $1.01–16.08 per 1k rendered responses | – | – | – | dropped: no CDP, no uploads |
| **Decodo (Smartproxy)** | **no CDP browser product found** | proxies only | – | – | – | – | – | – | – | – | – | dropped as a browser; usable as a proxy |

Notes on the arithmetic:

- Monthly figures use the cheapest plan that fits plus overage at the listed rate. Browserbase at 3,000 applications: Developer $20 + 50 h × $0.12 + 8 GB × $12 = $122. At 30,000: Startup $99 + 1,000 h × $0.10 + 85 GB × $10 = $1,049.
- "Own proxy" variants assume the vendor does not meter BYO-proxy bandwidth. Steel says so explicitly ("no Steel bandwidth charge"). Anchor and Notte charge $0.20/GB. For Browserbase it is **unverified**.
- Kernel's monthly figures assume headful at $0.48/h. Headless at $0.06/h would be about $90 at 30,000 applications, but Kernel itself warns that "Some bot detectors may detect headless mode", and live view and replays are unavailable headless.

**Cloudflare Browser Run, re-checked and dropped (2026-11-22, issue #288).** Browser Run's Sessions (CDP) can be driven by
`chromium.connectOverCDP` from any machine, and it now documents Live View and Human in the Loop, so the human-takeover
gap is narrower than the row first recorded. The row is still a drop: the documentation index has no proxy page, the FAQ
says every request leaves from Cloudflare IP ranges with no rotation, and the automatic headers
(`cf-biso-devtools`, `cf-brapi-devtools`, `Signature*`) cannot be removed, so the vendor itself says the traffic is always
identified as bot traffic. At the recorded 9 min 16 s and 2.71 MB (`docs/research/cost-m1.md` §2.1) that is $0.0164 per
completed application with no proxy and $0.0319 with a proxy at Browser Use's $5/GB, and it has no solver for the visible
challenges the send path turns into `captcha_blocked`. The lab probe, the header identity and the arithmetic are in
`docs/research/cloudflare-paid-plan.md` §6 and reproducible with `bun run scripts/measure-browser-run-lab.ts`.

---

## 3. Top 3 managed candidates in depth

### 3.1 Kernel: the best fit if we want to drop our own proxy

- **Why it fits:**
  - Headful by default, which matches our headed-Chrome bet.
  - Raw CDP.
  - `setInputFiles` with a buffer is shown in the docs.
  - Live view is embeddable with input; view-only is a URL scope.
  - Profiles are encrypted end to end with a per-org key.
  - Billing is per second, and nothing is charged during standby.
  - **Proxies are included**: ISP, residential and mobile.
  - A CAPTCHA solver comes with stealth mode.
  - 72 h max sessions are far above our need.
- **Plan:**
  - **Hobbyist ($30/mo, 10 concurrent)** for M1.
  - **Start-Up ($200/mo, 150 concurrent, BYO proxy)** once volume needs more than 10 concurrent browsers or a Canadian exit.
  - Expected cost is ~$0.024 typical and $0.08 worst per application, all-in.
- **Risks:**
  - Canada is not documented for any Kernel proxy type. ISP countries are US, SG, UK, FR and DE. Canadian users may need BYO (Start-Up) or a US exit.
  - Residential "exit IPs may change per connection", which could hurt a reCAPTCHA score mid-form. ISP is the stable option, but it is a shared pool.
  - The docs conflict on ISP IPs. One page says they "stay the same across sessions", another says "a new session may get a different IP".
  - The proxy is "subject to fair use"; at tens of GB a month we should get the threshold in writing.
  - Kernel has the lowest published price for *headless* browsers, but the headful price (8 GB VM) is 8× higher.
  - The AUP's ban on bulk unsolicited form submission needs a written OK. Job applications are solicited by the employer, but we submit at volume on behalf of users.
  - Third-party benchmarks place Kernel mid-pack: 67% and 80.5% on Browser Use's own tests.
  - Browsers run in us-east only for North America, which is fine from yyz.

### 3.2 Browser Use Cloud: the cheapest credible all-in bundle

- **Why it fits:**
  - **$0.06/h + $5/GB, CAPTCHA included**, on pay as you go with no plan minimum.
  - Raw CDP via the v4 `cdpUrl`.
  - Residential is on by default in 195+ countries, including CA by country code.
  - Interactive iframe live view, with view-only as a UI flag.
  - Profiles ("one profile per end user") persist cookies and localStorage.
  - SOC 2 Type II and a signed DPA on pay as you go.
  - Best scores in every benchmark found, though all are its own except ScrapeOps (98/100).
- **Plan:**
  - Pay as you go, with a $100 top-up to unlock 50 concurrent browsers.
  - Expected cost is ~$0.018 typical and $0.085 worst; ~$540/month at 30,000 applications.
- **Risks:**
  - **No state or city targeting, and no sticky or per-user IP guarantee** ("does not guarantee a unique proxy IP or particular city"). That weakens R4-07 (same identity and region).
  - BYO proxy is Enterprise only, so we cannot fix the identity problem ourselves.
  - The company is agent-first, and the raw-browser API is the secondary product. Its fast-moving v2 → v4 APIs are a churn risk.
  - Benchmarks are self-run on sites "picked because our browser historically got through".
  - ToS conduct items ("robots, scraping", circumventing "content protections") are ambiguous for automated form submission and need a written reading.
  - Profile encryption and retention are not documented.
  - Closing a CDP connection does not stop the browser, so we must call `PATCH …/browsers/{id} {"action":"stop"}` or keep paying.

### 3.3 Browserbase with our own proxy: the most mature, cheapest "managed browser, our IP"

- **Why it fits:**
  - Most funded and most mature ($67.5M raised; SOC 2 Type II; HIPAA; 4 regions).
  - Raw CDP.
  - Contexts persist the full user-data dir (cookies, localStorage, IndexedDB), encrypted at rest, kept indefinitely. This matches R4-07 cleanly.
  - Live view is an iframe with input, and the docs explain mobile viewports.
  - Session Uploads API for files up to 100 MB, plus `setInputFiles` for small files.
  - BYO proxy from the $20 Developer plan, which keeps our Evomi or DataImpulse sticky-session logic and per-user city targeting.
- **Plan:**
  - **Developer ($20/mo, 100 h, 25 concurrent)** for M1.
  - **Startup ($99/mo, 500 h, 100 concurrent)** after that.
  - Expected cost with our own proxy is **$0.0065–0.008 typical** and $0.024–0.032 worst; ~$243–288/month at 30,000 applications. That is the closest any vendor gets to self-hosted cost.
- **Risks:**
  - **Non-Verified sessions "always use linux" fingerprints**, and the custom "Verified" Chromium is Scale only (custom pricing). At our tier we get a Linux Chrome, which is what our self-hosted runner gives us anyway.
  - Weakest stealth scores among the big three: 42% and 78.5% on Browser Use's tests.
  - Its built-in proxy ($10–12/GB) is the most expensive here.
  - The billing treatment of BYO-proxy traffic is unverified.
  - No Canadian browser region; us-east-1 is the closest.

### Runners-up

- **Anchor:** the only vendor with a **dedicated sticky IP per profile** (exactly R4-07) and the broadest documented CAPTCHA list, with CDP lifecycle events. However, Extra Stealth sits behind a $2,000/mo plan (or the sticky-IP option, price unpublished), and it scored worst on ScrapeOps' fingerprint test (Chrome 136, platform mismatch). Ask for sticky-IP pricing before M1.
- **Steel:** the most transparent CAPTCHA list and per-solve price, a $0 plan, BYO proxy free, and an Apache-2.0 self-host image. However, its **ToS is the most restrictive** ("violate any website's terms of service", "bypass security measures … without authorization"), and "CDP automation" was detected in all ScrapeOps sessions.
- **Scrapeless:** the cheapest bundle ($0.0099 typical). However, the timezone was pinned to New York in every session, it ships an old Chrome, it uses prepaid packages that forfeit unused funds, and its track record is thin.

---

## 4. The self-hosted path: what it really takes

### Running cost

| Item | Typical | Worst | Source |
|---|---|---|---|
| Fly shared-cpu-2x 2 GB at $13.39/mo (≈ $0.0186/h) | $0.00093 | $0.0031 | Fly pricing |
| Residential proxy at $0.49–0.99/GB (Evomi) or $1/GB (DataImpulse) | $0.0015–0.003 | $0.0074–0.015 | vendor pricing |
| CAPTCHA via CapSolver (only if S2-07 is reopened): reCAPTCHA v2 $0.80/1k, v3 $1/1k, v3 Enterprise $3/1k, Turnstile $1.20/1k | $0–0.0006 | $0.003 | CapSolver |
| **Total** | **$0.0024–0.0045** | **$0.014–0.021** | |

Monthly totals:

- **300 applications:** about $2–16. Evomi pay as you go needs a 15 GB purchase.
- **3,000 applications:** about $12–20.
- **30,000 applications:** about $95–135 (Evomi 100 GB plan $49 + compute ~$28 + solver ~$18).

These exclude the always-on web machine, which we run either way, and any warm-pool machines (a 4-machine warm pool adds ~$54/month).

### Stealth stack options (Chromium, because our executor is CDP and ARIA based)

- **Headed Chrome under Xvfb.** Kernel's choice and Browser Use's control both show headful matters. Browser Use measured headless Chromium at 2% and headful at 50% on its datacenter-IP control.
- **A patched Playwright client.** Stock Playwright sends `Runtime.enable`, a known CDP tell that ScrapeOps flagged on two vendors. This matters equally if we drive a vendor's browser.
  - **rebrowser-patches:** drop-in `playwright-core` builds, tested on Playwright 1.64.1. Last release 2026-10-22, community maintained.
  - **patchright-nodejs:** removes the `Runtime.enable` and `Console.enable` leaks and automation flags. Its "undetectable" claims are self-reported.
  - Bun compatibility of either is **unverified** and must be tested first.
- **Source-patched Chromium.** CloakBrowser (C++ patches; claims reCAPTCHA v3 0.9 against 0.1 for stock Playwright) is **self-reported**, and its license terms are unchecked.
- **Not suitable:** Camoufox is Firefox over Juggler, not CDP, and says it "may not be suitable for stable production use". It would mean a second executor.
- **Coherence work, which is our job and the main failure mode seen in vendor fingerprints:** timezone, locale, `Accept-Language` and geolocation must match the proxy exit city. We also need a real GPU-like WebGL string rather than SwiftShader, sane core and memory counts, and fonts that match the claimed OS.
- **CAPTCHA solver APIs, if we add one:**
  - CapSolver lists reCAPTCHA v2/v3/Enterprise, Turnstile and AWS WAF, but **no hCaptcha**.
  - Anti-Captcha charges $0.95–2 (v2), $1–2 (v3) and $5 (Enterprise) per 1k, and $2 for Turnstile, with no hCaptcha in its price table.
  - 2Captcha charges $1–2.99 (v2) and $1.45–2.99 (v3, by score) per 1k, and $1.45 for Turnstile. It removed hCaptcha from its docs around early 2025 (secondary sources).
  - NopeCHA sells subscriptions ($4.99–99.99/mo) that work out below $0.10 per 1k, but it is a recognition extension rather than a token API.
  - **hCaptcha coverage is the weak spot across all solvers.**
  - Token-injected reCAPTCHA v3 scores come from the solver's environment, so they do not fix a low Greenhouse score. Only IP plus fingerprint does.

### Honest effort estimate (one engineer, on top of what exists)

The repo already has `proxy-provider.ts`, `live-view.ts`, `captcha-solver.ts` and the `BrowserProvider` port.

| Work | Effort |
|---|---|
| Patched client on Bun, headed Chrome image, geo-coherent fingerprint (timezone, locale, WebGL, fonts) from the proxy city | 1–2 weeks |
| Live view with input that works on a phone: screencast, pointer and touch mapping, virtual keyboard, reconnect, auth | 1–2 weeks |
| Encrypted per-user profile persistence (user-data-dir snapshot to object storage, a lease so there is 1 writer, size caps) | ~1 week |
| On-demand Fly machine pool: start/stop, warm pool, crash cleanup, quotas | 1–2 weeks |
| Detection regression suite (fixture forms plus own-sitekey reCAPTCHA/hCaptcha/Turnstile pages, CreepJS-style checks) | ~1 week |
| **Total** | **≈ 5–8 engineer-weeks**, then **~2–4 days/month** for Chrome updates and detection regressions |

Alternatives that cut this:

- The **Steel self-host** image (Apache-2.0) could replace most of the pool and live-view work.
- **Browserless self-host** does not help commercially: it is SSPL or a paid licence, and stealth and CAPTCHA are premium only.

---

## 5. Proposed M1 bake-off

### Arms

All arms go behind `BrowserProvider`, with the same executor, the same blocked resource types and the same Resume PDF.

- **A. Self-hosted (control):**
  - Headed Chrome under Xvfb on Fly yyz.
  - rebrowser-patched `playwright-core`.
  - Evomi and DataImpulse sticky residential, one session ID per application, city matched to the user (this is also the R5-02 proxy bake-off).
  - No solver; visible CAPTCHA goes to Review.
- **B. Kernel Hobbyist:**
  - Headful plus stealth, using Kernel's included ISP proxy (or residential in the user's state).
  - This tests whether we can drop our proxy.
- **C. Browser Use Cloud, pay as you go:**
  - Residential, country = user.
  - One profile per user.
- **Reserve D:** Browserbase Developer with our own Evomi proxy. Run it if B or C fails CDP or upload fidelity. It isolates "their browser" from "our IP".

### Phases

Traffic to ATSes leaves only from the runner or the vendor clouds, never from devbox (R4-09). No fake applications are sent to employers.

1. **Synthetic phase.** Measure scores at volume without touching employers:
   - Put a **reCAPTCHA v3 / Enterprise site key**, an **hCaptcha** and a **Turnstile** widget on our own domain.
   - Add Greenhouse, Lever and Ashby fixture forms captured per R4-09.
   - Run about 200 sessions per arm.
   - Record the score distribution, challenge rate, and fingerprint coherence (timezone, locale and IP agree; WebGL is not SwiftShader; `webdriver` is false; no `Runtime.enable` tell).
2. **Live phase.** Run the owner's genuine M1 applications (per S1-01), randomly assigned to an arm per application, stratified by ATS. Target ≥ 60 per arm (20 per ATS, as in R5-02). Extend toward ~200 per arm before declaring a winner on a difference under 15 points: a 10-point difference at about 85% needs roughly 200 per arm for 80% power.

### Metrics and decision rule

| Metric | Definition |
|---|---|
| **Submit success rate** | confirmation page or ATS email received, ÷ attempts (primary) |
| **Code/CAPTCHA rate** | emailed security code or visible challenge ÷ attempts, per ATS |
| **Human takeover rate** and **takeover usability** | can the owner solve a visible challenge from a phone through the embedded view: yes/no, input lag in seconds |
| **Cost per completed application** | (browser + proxy + solver + plan share) ÷ successful submits |
| **p50 and p95 duration** | job dispatch → submit confirmed, including cold start; plus cold-start p95 alone |
| **Profile fidelity** | the second session for a user restores cookies and localStorage; same exit city |

- **A vendor wins only if** its success rate is at least the control's, its code/CAPTCHA rate is lower, and its cost per *completed* application is within the owner's per-application tolerance (proposed: ≤ $0.03).
- **Otherwise the self-hosted arm wins.** Either way, the loser's adapter can stay behind `BrowserProvider` as a per-ATS fallback, using the per-ATS kill switches from S1-04.

### Before the bake-off, get in writing

1. Kernel: the fair-use threshold for proxies, Canadian exits, and an AUP OK for user-initiated job applications.
2. Browser Use: a reading of its ToS conduct items, and whether IP or city can be pinned per profile.
3. Anchor: the price of dedicated sticky IPs (it would be a fourth arm if cheap).
4. Browserbase: whether BYO-proxy bytes are billed.

---

## 6. Sources (all accessed 2026-11-19)

### Vendors: pricing and docs

- Browserbase:
  - pricing: https://www.browserbase.com/pricing
  - plans and billing granularity: https://docs.browserbase.com/account/billing/plans.md
  - stealth and Verified: https://docs.browserbase.com/features/stealth-mode
  - advanced stealth changelog: https://www.browserbase.com/changelog/advanced-stealth
  - proxies: https://docs.browserbase.com/platform/identity/proxies.md
  - CAPTCHA: https://docs.browserbase.com/platform/identity/captcha-solving.md
  - regions: https://docs.browserbase.com/optimizations/latency/multi-region.md
  - contexts: https://docs.browserbase.com/platform/browser/core-features/contexts.md
  - live view: https://docs.browserbase.com/platform/browser/observability/session-live-view.md
  - timeouts: https://docs.browserbase.com/platform/browser/long-sessions/timeouts.md
  - uploads: https://docs.browserbase.com/platform/browser/files/uploads.md
  - doc index: https://docs.browserbase.com/llms.txt
  - ToS: https://www.browserbase.com/terms-of-service
  - status: https://status.browserbase.com/
- Kernel:
  - pricing: https://www.kernel.sh/pricing
  - pricing docs: https://www.kernel.sh/docs/info/pricing
  - stealth: https://kernel.sh/docs/browsers/bot-detection/stealth
  - proxies: https://www.kernel.sh/docs/proxies/overview.md
  - residential proxies: https://www.kernel.sh/docs/proxies/residential.md
  - headless: https://www.kernel.sh/docs/browsers/headless.md
  - live view: https://www.kernel.sh/docs/browsers/live-view.md
  - profiles: https://www.kernel.sh/docs/browsers/profiles.md
  - file I/O: https://www.kernel.sh/docs/browsers/file-io.md
  - limits: https://www.kernel.sh/docs/browsers/concurrency-and-limits.md
  - regions: https://www.kernel.sh/docs/browsers/regions.md
  - trust center: https://www.kernel.sh/docs/info/trust-center.md
  - AUP (modified 2026-09-15): https://www.kernel.sh/docs/acceptable-use.md
  - doc index: https://www.kernel.sh/docs/llms.txt
  - status: https://status.kernel.sh/
  - funding: https://blog.onkernel.com/series-a-announcement/
- Browser Use:
  - pricing: https://browser-use.com/pricing
  - stealth: https://docs.browser-use.com/cloud/browser/stealth
  - proxies: https://docs.browser-use.com/cloud/browser/proxies.md
  - limits: https://docs.browser-use.com/cloud/guides/concurrency.md
  - CDP: https://docs.browser-use.com/cloud/browser/playwright-puppeteer-selenium.md
  - live preview: https://docs.browser-use.com/cloud/browser/live-preview.md
  - CAPTCHA: https://docs.browser-use.com/cloud/browser/captcha-handling.md
  - profiles: https://docs.browser-use.com/cloud/guides/authentication.md
  - doc index: https://docs.browser-use.com/llms.txt
  - ToS (revised 2026-10-15): https://browser-use.com/legal/terms-of-service
  - status: https://status.browser-use.com/
  - seed round: https://browser-use.com/posts/seed-round
- Anchor:
  - pricing: https://anchorbrowser.io/pricing
  - pricing docs: https://docs.anchorbrowser.io/pricing
  - stealth: https://docs.anchorbrowser.io/essentials/stealth
  - proxy: https://docs.anchorbrowser.io/advanced/proxy.md
  - dedicated sticky IP: https://docs.anchorbrowser.io/advanced/dedicated-sticky-ip.md
  - session timeout: https://docs.anchorbrowser.io/advanced/session-timeout.md
  - live view: https://docs.anchorbrowser.io/advanced/browser-live-view.md
  - doc index: https://docs.anchorbrowser.io/llms.txt
  - SaaS terms (2026-03-24): https://anchorbrowser.io/saas-terms-03-24-2026
- Steel:
  - pricing: https://steel.dev/pricing
  - pricing docs: https://steel.dev/docs/platform/pricing
  - limits: https://steel.dev/docs/platform/limits
  - stealth: https://steel.dev/docs/llms-full/stealth.txt
  - live view: https://steel.dev/docs/llms-full/watch-and-debug.txt
  - doc index: https://steel.dev/docs/llms.txt
  - ToS (2025-02-05): https://steel.dev/terms
  - self-host repo: https://github.com/steel-dev/steel-browser
- Hyperbrowser:
  - pricing: https://www.hyperbrowser.ai/pricing
  - pricing docs: https://hyperbrowser.ai/docs/pricing.md
  - CAPTCHA: https://hyperbrowser.ai/docs/sessions/captcha-solving.md
  - proxy: https://hyperbrowser.ai/docs/sessions/proxy.md
  - stealth: https://hyperbrowser.ai/docs/sessions/stealth.md
  - live view: https://hyperbrowser.ai/docs/sessions/live-view.md
  - profiles: https://hyperbrowser.ai/docs/sessions/profiles.md
  - doc index: https://hyperbrowser.ai/docs/llms.txt
- Browserless:
  - pricing: https://www.browserless.io/pricing
  - unit consumption: https://docs.browserless.io/overview/unit-consumption
  - bot detection: https://docs.browserless.io/baas/bot-detection/overview
  - CAPTCHA: https://docs.browserless.io/baas/bot-detection/captchas
  - self-host repo and licence: https://github.com/browserless/browserless
- Bright Data:
  - pricing: https://brightdata.com/pricing/scraping-browser
  - FAQ: https://docs.brightdata.com/scraping-automation/scraping-browser/faqs
  - error codes (60 min / 5 min timeouts): https://docs.brightdata.com/scraping-automation/scraping-browser/error-codes
  - AUP: https://brightdata.com/acceptable-use-policy
- Oxylabs: https://oxylabs.io/products/unblocking-browser
- Scrapeless:
  - product page: https://www.scrapeless.com/en/product/scraping-browser
  - pricing (figures did not render): https://www.scrapeless.com/en/pricing
- Scrapfly:
  - pricing: https://scrapfly.io/pricing
  - Cloud Browser billing: https://scrapfly.io/docs/cloud-browser-api/billing
- Notte:
  - pricing: https://www.notte.cc/pricing
  - Playwright: https://docs.notte.cc/features/sessions/playwright
- Rebrowser: https://rebrowser.net/pricing
- Airtop:
  - pricing: https://www.airtop.ai/pricing
  - Playwright: https://docs.airtop.ai/guides/how-to/automation-frameworks/playwright
- Cloudflare Browser Run: https://developers.cloudflare.com/browser-run/pricing/
- Zyte: https://www.zyte.com/pricing/
- Decodo: no browser product page found. Search of decodo.com returned blog and glossary pages only, for example https://decodo.com/glossary/cdp

### Self-hosted inputs

- Fly pricing: https://docs.fly.io/about/pricing
- Evomi pricing: https://evomi.com/pricing
- DataImpulse: https://dataimpulse.com/
- CapSolver pricing: https://docs.capsolver.com/en/pricing/
- 2Captcha pricing: https://2captcha.com/pricing
- Anti-Captcha price table: https://anti-captcha.com/
- NopeCHA pricing: https://nopecha.com/pricing
- Camoufox: https://github.com/daijro/camoufox
- patchright: https://github.com/Kaliiiiiiiiii-Vinyzu/patchright
- rebrowser-patches: https://github.com/rebrowser/rebrowser-patches
- CloakBrowser: https://pypi.org/project/cloakbrowser/ (claims are self-reported)
- Playwright `connectOverCDP` and `isLocal`: https://playwright.dev/docs/api/class-browsertype
- Playwright remote upload limit: https://github.com/microsoft/playwright/issues/39383

### Benchmarks and maturity (not independent; treat as directional)

- Browser Use stealth benchmark (2026-03-21, vendor-run): https://browser-use.com/posts/stealth-benchmark
- Browser Use Stealth Bench V2 (2026-09-25, vendor-run, sample "favors us"): https://browser-use.com/posts/best-browser-infrastructure-for-ai-agents
- ScrapeOps fingerprint benchmark (Nov 2026; affiliate links, scoring weights undisclosed): https://scrapeops.io/proxy-providers/stealth-browser-fingerprint-benchmark/
- Proof of Human bot-detection benchmark (vendor; seen in search results only, **unverified**): https://research.poh.org/bot-benchmarking-2026/
- Browserbase funding (aggregators; the Series B is widely reported): https://dealroom.co/companies/browserbase-/ and https://www.upstartsmedia.com/p/browserbase-raises-40m-and-launches-director

### Unverified items

- Browserbase BYO-proxy billing.
- Notte billing rounding.
- Rebrowser CDP support.
- Bright Data persistent profiles, embeddable interactive view and image blocking.
- Oxylabs geo and plan fit.
- Scrapeless solve-rate claim and live-view input.
- Hyperbrowser SOC 2.
- Bun compatibility of the patched Playwright clients.
- 2Captcha hCaptcha status.
- Browserless monthly-billed prices (only annual prices were shown).

---

## 7. Browser Use Cloud, re-checked on its own pages (2026-11-19)

- Pricing (https://browser-use.com/pricing): $0.06 per browser-hour, billed by the minute, 1-minute minimum; home-IP (residential) proxy traffic $5/GB; own-proxy or direct traffic $0.20/GB; CAPTCHA solving "Included"; pay as you go $0/month, credits from $5, non-expiring; SOC 2 Type II and signed DPA on pay as you go. Concurrency by lifetime spend: 10 at $0, 50 at $100, 250 at $1,000, 500 at $5,000, 1,000 at $25,000. Enterprise: >1,000 concurrent, SLAs, HIPAA, zero data retention, EU data residency, on-prem.
- Proxies (https://docs.browser-use.com/cloud/browser/proxies.md): US residential by default; country chosen per browser with `proxyCountryCode` (195+ countries per the docs; full code list only in the API reference); `rotate` gives a new IP in the same country; "does not guarantee a unique proxy IP or particular city"; custom proxies are Enterprise-only for projects created after 13 November 2026.
- CAPTCHA (https://docs.browser-use.com/cloud/browser/captcha-handling.md): automatic by default for standalone browsers (`solveCaptchas` can be turned off); types not listed; "not guaranteed"; no solve events: wait ~10 s and re-inspect; Cloudflare-type walls handled by stealth + residential proxy.
- Profiles (https://docs.browser-use.com/cloud/guides/authentication.md): cookies, local storage and login state; "Use one profile per end user"; passed as `profileId`; encryption, retention, deletion API and per-profile concurrency not documented.
- ToS (revised 2026-10-15, https://browser-use.com/legal/terms-of-service): no clause on automated form submission or CAPTCHA solving; closest are item 10 (no circumventing "content protections" or geographic restrictions) and item 11 (no "data mining, robots, scraping"); customer must obtain end-user consents and comply with third-party terms; California law.
