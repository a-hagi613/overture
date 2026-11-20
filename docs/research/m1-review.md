# M1 architecture review (issue #5), 2026-11-19

Verdict: **approved with conditions.** The architecture is sound. Fix four things in the spec before the tickets they touch start.

> Owner rulings (ADR 0024–0026): SES receiving adopted; early cloud probe adopted (#39); Kernel kept behind the port; M1 sign-in is Google, LinkedIn and magic link. Verified again independently: MSW 3.0.7 intercepts nothing under Bun while 2.15.0 does (probed with `.invalid` hosts); Cloudflare catch-all is apex-only; SES receiving in ca-central-1 matches a whole subdomain and carries SPF/DKIM/DMARC verdicts.

## Verified on devbox (Bun 1.4.5)

| Probe | Result |
|---|---|
| MSW 3.0.7 `setupServer` under Bun | **Broken, fails open**: fetch, Anthropic SDK, AWS SDK and node:https are not intercepted, and `onUnhandledRequest: "error"` never fires. Real requests went out. |
| MSW 2.10.4 / 2.7.0 under Bun | Works: fetch, Anthropic SDK, AWS SDK v3 (default handler), node:https; unhandled requests are rejected |
| playwright-core 1.65.1 `connectOverCDP` under Bun, local Chromium | Works: label fill and `setInputFiles` with a buffer, connect in 370 ms |
| Snapshot triggers (BEFORE UPDATE raise; BEFORE DELETE WHEN EXISTS user) | Works: update, direct delete and application-cascade delete are blocked; deleting the user cascades. Needs a `user_id` column on `application_snapshots`, which the spec omits. |

## Must fix before the related tickets

1. **MSW version (#9).** Pin `msw@^2`, and add a CI canary test that fails if a request to an unmocked host gets through. On MSW 3 the safety net in ADR 0013 silently does nothing.
2. **Inbound mail (#22).** Cloudflare's docs say catch-all rules work on the apex domain only. A subdomain gets literal rules, at most 200 per domain. Email Workers also get no SPF/DKIM/DMARC verdicts (workerd issue 6740: `arc=none` only). Routing rejects mail that fails both SPF and DKIM, or fails DMARC policy, so "nothing is dropped" is not fully achievable. Options:
   - (a) **SES inbound in ca-central-1** (supported since 2023): a receipt rule for the whole subdomain, delivering to S3 and SNS with SPF/DKIM/DMARC/spam verdicts. No Worker, no rule limit. This is my pick.
   - (b) Keep Cloudflare with one literal rule per mailbox, created by API. That is fine up to about 200 users. SPF would be computed at ingest from the envelope sender plus the connecting IP in Cloudflare's own Received header.
3. **Where "Submit" counts (#28, #30).** Greenhouse's invisible reCAPTCHA Enterprise answers a low score with HTTP 428 `captcha-failed` and a `security_code_recipient`. An 8-character emailed code then needs a second Submit, and one 2026 implementation reports that every production click hit this. Under the spec, a code timeout after the first click becomes `unconfirmed`: never retried, and the role is blocked for 60 days, even though nothing was submitted. Classify outcomes from the server's response to the application request (`page.on('response')`):
   - a 4xx such as 428 means nothing was submitted, so the attempt can be retried;
   - a 2xx means submitted;
   - set `submit_clicked_at` only on the click whose request may have been accepted.
4. **Spec bugs.**
   - `application_snapshots` needs `user_id`.
   - §17 slices (M1-00..M1-16) don't match the GitHub tickets (M1-01..M1-31).
   - §17 M1-02 says "ports + fakes", which contradicts ADR 0013.
   - §3.3 says to "confirm at setup that the catch-all covers the subdomain". It does not.

## Should fix (cheap, high value)

- **Browser Use session hygiene.** The default timeout is 60 minutes and a dead process cannot run `finally`. Pass `timeout: 15` and `metadata: {attempt_id}`. On boot and in the recovery sweep, list active browsers and stop any orphans.
- **Deploys during a send.** Set `kill_timeout = 300`, the Fly maximum. On SIGTERM:
  - if Submit has not been pressed, abort and reschedule to the next slot without using up one of the two tries;
  - if it has, wait for confirmation.

  Today every deploy during a send either burns a retry or creates a Confirming.
- **Scheduler testability.** Moving the clock does not fire `setInterval`. Add a test-only "run due jobs" route, and make code polling wake on mail ingest instead of polling every 5 s. Without both, the no-sleep rule and the 2-minute CI target conflict.
- **Greenhouse polling.** Fetch the light job list, then fetch `content=true` or the single job only when `updated_at` changes. This cuts bandwidth and CPU on a shared-cpu-2x machine, whose baseline CPU quota is small; watch `fly_instance_cpu_throttle`.
- **Grounding check.** A cited resume line is not proof that the line supports the sentence. Add a deterministic check: every number, date, employer and technology named in a sentence must appear in the lines it cites. Anthropic Citations can't be combined with structured outputs; the API returns a 400.
- **Define the gate metrics.**
  - Does "attempted" count Applications or tries?
  - Does cost include failed tries, live checks, lab sessions and fixed infrastructure?

## Cost check

- **LLM.** Haiku 5.5 costs $0.10 / $0.50 per MTok, so LLM is about $0.002 per Application. The spec's estimates hold.
- **Browser and proxy.** $0.06/h plus $5/GB residential (current pricing). A 4-minute session with 3 MB of proxied traffic costs about $0.019, or about $0.024 per completed Application at 85 % success.
- **Total.** About $0.026, under the $0.03 gate.
- **What decides it.** Proxy bytes: every extra MB adds $0.005, and 5 MB fails the gate. Measure MB per form during the first capture run.

## Scope and order

- **Move the first real send earlier.** The gate's risk is cloud submission, yet the first real send is ticket 21. After the deploy ticket, run a send spike from `overture-web`: about 5 real Greenhouse applications for the owner on Browser Use, measuring MB, code rate, confirmation signal and duration. Then build tagging, census and admin on measured numbers.
- **Drop Kernel from M1.** Its AUP bans the actual use, so it is not a fallback. Keep the port; Browserbase or Anchor is the real fallback if one is needed. The Browser Use-only lab becomes optional.
- **Optional:** four sign-in methods for an allowlist of one. Ship Google plus a passkey, and add the rest in M2.

## Strategic risks (honest)

- ATS vendors are actively building against mass applying:
  - Greenhouse Real Talent does fraud detection (IP, email, phone, location) and CLEAR identity checks, and employers can blocklist IPs, emails and email domains;
  - Ashby flags device, IP, email and phone signals for manual review;
  - Greenhouse's CEO publicly criticised mass auto-apply in July 2026.
- At 10 a day, owner-only, with true facts, M1 is the lowest-risk posture.
- For M2 and M3, a shared `mail.tryoverture.com` is a single domain-blocklist target across all users. Monitor it per employer, as the spec plans.
- Browser Use ToS (2026-10-15) bans "robots, scraping" and circumventing "content protections". That is ambiguous for this use; the spec's "handle if they raise it" stance is reasonable at M1 scale.

## Sources

- Greenhouse invisible reCAPTCHA: https://support.greenhouse.io/hc/en-us/articles/115005448066-Invisible-reCAPTCHA
- Greenhouse 428 security-code flow (third party): https://github.com/CryptoJones/OSApplyTrack/pull/165
- Greenhouse Real Talent: https://www.greenhouse.com/product-features/greenhouse-real-talent
- Greenhouse CEO on mass apply: https://fortune.com/2026/07/27/greenhouse-ceo-daniel-chait-ai-doom-loop-job-seekers-spam-interview-applications-unemployment/
- Ashby fraud detection: https://docs.ashbyhq.com/candidate-fraud-detection
- Cloudflare subdomains (catch-all apex only): https://developers.cloudflare.com/email-routing/setup/subdomains/
- Cloudflare limits (200 rules per domain, 25 MiB): https://developers.cloudflare.com/email-routing/limits/
- Cloudflare postmaster (SPF/DKIM/DMARC rejection): https://developers.cloudflare.com/email-routing/postmaster/
- Worker gets no auth verdicts (issue report): https://github.com/cloudflare/workerd/issues/6740
- SES receiving in Canada (Central): https://aws.amazon.com/about-aws/whats-new/2023/09/amazon-ses-email-service-7-regions
- Browser Use v4 create browser: https://docs.browser-use.com/cloud/api-v4/browsers/create-browser-session
- Browser Use pricing: https://browser-use.com/pricing
- Browser Use ToS: https://browser-use.com/legal/terms-of-service
- Fly kill_timeout: https://fly.io/docs/reference/configuration/
- Fly CPU quotas: https://fly.io/docs/machines/cpu-performance
- Bun MSW issue history: https://github.com/oven-sh/bun/issues/2297
