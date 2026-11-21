---
status: accepted
---

# M2 scope and the owner's decisions of 2026-11-20 and 2026-11-21

M2 is an invite-only beta for the owner's friends and family. The owner keeps testing on a burner account, and M1 closes
when its planned tickets are done. This ADR restates M2 after ADRs 0026, 0028 and 0029 and the owner's later rulings; the
M2 row in SPEC §2 and spec #6 carry the details.

## Decisions

- **Invites replace the owner allowlist.** The admin creates an invite for an email; the first verified sign-in with it,
  by any method, accepts it and issues one admin grant of 300 applications over 30 days, with no card.
- **Real email, forwarded ATS mail** (ADR 0028). Onboarding guides one Gmail or Outlook filter to the user's forwarding
  address; the 10-minute code paste is a first-class path for users who skip it. No Gmail API.
- **The user approves every send** (ADR 0029): the Ready destination, the daily 07:00 preparation run and one recap
  email are M1; M2 adds push for the recap and approval from the phone, inside the app. There is no separate digest.
- **Cloudflare for all mail.** Sending to anyone but the owner needs Workers Paid ($5 a month, paid by the owner) and
  `tryoverture.com` onboarded as a sending domain. One ticket builds an idempotent operator script and a deploy and
  live-check guard so the switch is one command once the plan is paid.
- **No replies from Overture.** The reply composer (SPEC §11.2) is not built: a reply would come from an address the
  employer never saw, and users reply from their own mailbox. The Inbox is read-only.
- **ATSes:** Recruitee and SmartRecruiters are dropped. Personio is read from its per-company XML; Workable from its bulk
  XML feed keyed by `referencenumber`, with a measured choice between a streamed daily pass on the machine and an
  off-box pass. Each 20-form probe reads forms by plain HTTP first and uses a Browser Use session only for the few forms
  where a fill must be proven, so the testing phase spends little.
- **Per-user notification preferences wait in `settings`.** Each user's push kinds and the recap-email switch are one
  JSON row under the `notify.preferences.<userId>` key, which the global settings readers skip and account erasure
  deletes, because every migration slot up to 0042 is held by in-flight work. They move to their own table once a
  slot frees.
- **Legal:** business name "Overture", contact `admin@tryoverture.com`, postal address the placeholder
  `[POSTAL ADDRESS]` until the owner supplies one.
- **Moved into M2:** adopting the Browser Use SDK and the proxy-cost levers (#180), and the synthetic lab and provider
  report (#36). The security, scalability and cost reviews (#182, #183, #184) run near the end of M2, before the beta
  wave, on Sonnet 5.5.
- **The gate:** 10 beta users for 14 days, submit rate holding at 85 % or more, no P1 privacy or security finding. The
  last M2 ticket onboards the first wave.

## Considered Options

- **Keep the reply composer by sending from a per-user address.** It reopens the shared-domain blocklisting risk that
  ADR 0028 removed.
- **A separate 08:00 digest next to the recap email.** Two daily emails for one purpose; the recap already lists what
  happened.
- **Keep four new ATSes.** Two of them are barred by their own terms or need per-company tokens (ADR 0028).
