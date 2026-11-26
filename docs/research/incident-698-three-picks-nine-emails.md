# Incident #698 — the three onboarding picks and the nine emails

Read-only trace of the owner's report: three onboarding picks and nine emails to account for, without re-sending
anything or turning an old ambiguous attempt into a new submission. Nothing was sent, forwarded or mutated in
production. No credential value, applicant email, name or resume text is reproduced here.

Investigated 2026-11-26 against `main` at `e2c378f1`.

## Summary

- **Production is not reachable from this box.** `tryoverture.com` is live (`/api/health` returns `status:ok`,
  database `ok`, backups `replication:ok`, `lagSeconds:0`), and CI deploys app `overture-web`, but the local Fly
  token only sees a different, older app (`ai-auto-apply`, suspended since 18 Nov 2026, whose secrets are a Gmail
  stack, not this product's mail stack). There are no R2, Cloudflare Email Sending or Worker credentials on this
  machine. The production application database, its Litestream backups, Fly logs and mail-provider logs are
  therefore all out of reach.
- **The only reachable account with exactly three onboarding picks is the 26 Nov local walk database**, a fake
  `software engineer` walk user. It is not the owner's production account, so the production picks remain unknown.
  What the walk does prove is where three real picks get stuck, and the code paths that hold them.
- **Pick 1** (Lever) was approved, failed its first attempt with `form_changed`, bounced back to Ready with
  `The plan could not be read`, was approved again, and was stopped by the harness's no-submit switch
  (`fh_walk_ready_to_submit`). Final status `skipped`; both credit reservations were released, so it cost nothing.
- **Pick 2** (Greenhouse) prepared and was approved, was booked two seconds later, and never dispatched because the
  walk process stopped. **Pick 3** (Ashby) never prepared: the form reader returned no questions twice and the job
  died, leaving the Application in `preparing` with no event and no user-facing reason.
- **The nine emails cannot be matched to any stored delivery record, because no such record exists.** Outbound mail
  is counted only in a monthly aggregate (`mail_usage`), the Cloudflare adapter discards the provider's
  `message_id`, and `messages.provider_message_id` is never written. The only path in this codebase that sends
  applicant mail to the owner is the inbound Worker's global `OWNER_FORWARD_TO` copy — the #693 privacy bug.
  The walk itself sent nothing real: its harness exports no Cloudflare mail token, so the mail sender was the
  in-memory sink.

## Evidence reachability

| Source | Location | Reachable | What it holds |
|---|---|---|---|
| Production app DB | Fly `overture-web`, volume `data`, `/data/app.sqlite` | **No** — local Fly token sees only `ai-auto-apply` | Applications, events, attempts, ledger, mail counters |
| Litestream backups | R2 bucket `R2_BUCKET_BACKUPS` | **No** — no R2 keys on this box | Restorable copy of the production DB |
| Fly logs | `flyctl logs -a overture-web` | **No** — same token/org gap | Dispatch, gate and mail decisions |
| Cloudflare Email Sending activity | Cloudflare dashboard/API | **No** — no `CLOUDFLARE_EMAIL_API_TOKEN`, no wrangler auth | Provider-side sends, bounces |
| Inbound-mail Worker logs | `wrangler tail overture-inbound-mail` | **No** — no Cloudflare auth | Forwards to `OWNER_FORWARD_TO` |
| GitHub Actions logs | `gh run view` | Yes | Deploy and health only; no message content |
| Local walk DB | `~/.local/share/overture-orchestrator/fh-walk/app/overture.db` | **Yes** (read-only) | Three picks, events, attempts, ledger, mail counters |
| Demo DB | `.../dashboard-ui-iteration/.tmp-dev/app.sqlite` | **Yes** (read-only) | Synthetic `demo` role, 41 seeded Applications, 0 attempts |
| Production health | `https://tryoverture.com/api/health` | Yes, unauthenticated | Liveness only |

Change on this box does not imply production change: the deploy workflow pushes `overture-web` with a repository
secret this machine's CLI does not hold.

## The three picks

Source: the 26 Nov local walk database (1.2 MB, sha256 `238dc226…f70769`, last written 2026-11-26 19:54 UTC).
It contains one onboarded walk user, one trial grant of 3, three Applications created at 19:35:40 UTC, and the
walk ran until 19:54 UTC. Employer names, titles, posting URLs and IDs are omitted on purpose; they are in the local
database and readable by the owner only.

| Pick | System | Final status | Attempts | Ledger | Outcome |
|---|---|---|---|---|---|
| 1 | Lever | `skipped` / `fh_walk_ready_to_submit` | 2 | 2 reserves, 2 releases, 0 commits | Stopped before Submit by the harness, deliberately |
| 2 | Greenhouse | `approved` | 0 | none | Booked for 19:54:17 UTC, never dispatched; the walk stopped |
| 3 | Ashby | `preparing` | 0 | none | Preparation died as `form_unreadable`; stuck with no event |

### Pick 1

- `19:35:40` Application created and prepared (`application.prepare` done on the first attempt).
- `19:41:57` `ready → approved` (user).
- `19:48:31` attempt 1 starts, reserves one Application; Browser Use opens the posting, finds no form and stops with
  `form_missing` (`outcome: form_changed`); the reservation is released at `19:48:52` and the Application returns to
  Ready.
- `19:49:37` a dispatch tick sent it back to Ready again with `changes: ["The plan could not be read"]`
  (`dispatch.ts` `sendBackToReady`). That path clears `approved_at`, `approved_plan_enc` and `approved_plan_sha256`,
  so the ciphertext that failed to open was deleted: **why the sealed plan could not be read is not recoverable from
  the surviving rows.** The audit trail also has no approval event between `19:48:52` and this bounce, even though the
  bounce records `from: approved` — one approval is missing from the events table.
- `19:50:57` approved again by the walk.
- `19:51:12` attempt 2 opens the correct `/apply` page, reaches the Submit button, and the harness's no-submit patch
  stops it (`outcome: blocked`, `error_code: fh_walk_ready_to_submit`); the Application becomes `skipped` with the
  same reason. Ledger: reserve/release again, net zero.

Two facts stand out here: the first attempt's `form_missing` on the posting's base URL (the `/apply` page worked),
and the `The plan could not be read` bounce. The latter is a genuine product failure mode: an approved card can lose
its sealed plan between ticks and silently return to Ready for a new approval.

### Pick 2

- Prepared on the first attempt at `19:35:40`, with no events after creation.
- `19:54:15` approved; `scheduled_for` set to `19:54:17`.
- No attempt exists. The last line of `app.log` is that approval, so the process stopped before the next dispatch
  tick. Whether it would have sent is unknown, but nothing was sent and no Application was charged.

### Pick 3

- `application.prepare` ran twice and died
  (`form_unreadable: ashby <id> returned no questions; the Application stays in preparation`,
  `src/server/pipeline/prepare.ts`).
- The job is `dead` after 2 attempts, the Application stays `preparing`, and **no application event is written**, so
  the Tracker shows a card that never moves and never explains why. This is the "stuck preparing" class of bug the
  rebuild tickets already list (#695, #703).

## Why a Ready pick does not send

These are the product gates that hold a pick, in the order dispatch applies them (`src/server/dispatch/dispatch.ts`):

1. **Paused account.** `profiles.running` defaults to `false` with `pause_reason = "onboarding"`
   (`src/server/platform/db/schema.ts`), and `userGate` blocks every send for that user with
   `{reason: "paused", scope: "user"}`. The account is switched on by `startOnboarding`
   (`src/server/profile/onboarding-start.ts`), which clears the pause only while `pause_reason = 'onboarding'`, or by
   the billing resume path. The 26 Nov epic records that in the production flow "the account stays paused, so
   nothing sends" — this is the ticket-level cause (#681, #687).
2. **Send window.** `limits.send_window` defaults to `08:00–20:00` in the user's timezone
   (`src/server/platform/settings/index.ts`); a pick approved outside it is booked to the next window instead of
   sending. The walk overrode the window to `00:00–24:00`, so it did not block; its dispatch blocks were the account
   gate and one liveness `unknown`.
3. **No resume or no mailbox.** `userGate` pauses with `no_resume` / `no_mailbox` and writes the reason.
4. **No Applications left, daily cap, or already sending.** Trial users start with a grant of 3 and the daily cap is
   10.
5. **Posting liveness `unknown`.** A dispatch tick blocks instead of sending; in the walk one tick blocked here
   after the first failed attempt.
6. **Approved plan unreadable.** `openApprovedPlan` returns `null`, dispatch calls `sendBackToReady` with
   `The plan could not be read`, and the user must approve again.

Item 1 is the one that matches the owner's report; items 5 and 6 fired in the walk's own log, and item 2 did not,
because the harness widened the window.

## The nine emails

### What the system records

| Record | Where | Per message? | Used for |
|---|---|---|---|
| Monthly counter | `mail_usage` (`auth_sends`, `system_sends`, `notice_sends`) | No — one row per month | The 2,700/month cap, warning and refusal flags |
| In-app notifications | `notifications.emailed_at` | Only a timestamp, no provider id | Code-wait, recap and billing emails |
| Inbound messages | `messages` (`rfc_message_id`, `provider_message_id`) | Yes for inbound, but `provider_message_id` is **never written** | Inbox and thread linking |
| Outbound provider id | — | **Dropped.** `src/server/platform/mail/cloudflare.ts` parses `result.message_id` and throws it away | Nothing |
| Worker forwards | — | **Not recorded.** `workers/inbound-mail/src/forward.ts` sends and returns a boolean | Nothing |

Reachable evidence in the walk database for `2026-11`:

- `mail_usage`: **4 auth, 0 system, 0 notice.** The harness exports no Cloudflare mail token and the launching shell
  had none, so `createMailSender` used the in-memory sink (`platform/mail/sink.ts`): four sign-in emails were composed
  and counted, none reached any provider.
- `notifications`: **19 rows, all `review`, all `emailed_at IS NULL`.** Review notices are in-app only by design
  (SPEC: "There is no per-application email").
- `messages`: **0.** No inbound mail in this account.

### Where the nine could have gone

There are exactly three paths that can carry applicant mail:

1. **Overture → the user** through Cloudflare Email Sending (sign-in codes, code-wait, recap, billing, support).
   Each send is counted, never stored; the provider's `message_id` is discarded, so a stored-to-provider comparison
   is impossible.
2. **Employer/ATS → the applicant alias → the owner** through the inbound Worker. Every accepted alias message that
   is ATS mail, a threaded reply, or a Gmail/Outlook forwarding confirmation is copied to the single global
   `OWNER_FORWARD_TO` address (`workers/inbound-mail/src/forward.ts:260`). The copy is not recorded anywhere.
   This is the privacy bug #693 fixes.
3. **Nothing** — the local sink, which is what the walk used.

The number nine does not appear in any reachable record; it was counted in a mailbox or a provider UI. Mapping nine
specific messages therefore cannot be done from this box.

### Per-email outcome

| Email class | What the evidence says | Outcome |
|---|---|---|
| Sign-in codes to the walk users (auth) | 4 counted locally; sink only; no per-message row | **unknown, because** the local counter has no message identity and the production counter is unreachable |
| Code-wait notices (system) | 0 counted locally; production count unpublished | **unknown, because** production `mail_usage` and provider activity are unreachable |
| Ready recap (notice) | 0 counted locally; 19 notifications all unemailed | **unknown, because** production `notifications.emailed_at` and provider activity are unreachable |
| Billing/support notices (system) | 0 counted locally | **unknown, because** production is unreachable |
| Employer/ATS copies forwarded to the owner | Not recorded at all; only path is `OWNER_FORWARD_TO` | **unknown, because** the Worker writes no delivery row and its logs need Cloudflare auth |

If the nine were employer or ATS emails, path 2 is the only way they could have reached the owner: to the owner's own
address, not the applicant's login email. If they were Overture notices, path 1 sent them but no stored record can
name them. Either way the report cannot honestly name nine messages today.

## What would close the gaps (read-only)

With the deploy account's Fly token, the R2 keys and a Cloudflare token:

1. Restore the newest Litestream snapshot to a scratch directory (never over `/data`), then read counts only:
   `select status, count(*) from applications group by status;`,
   `select outcome, count(*) from attempts group by outcome;`,
   `select kind, count(*) from ledger group by kind;`,
   `select * from mail_usage where month = '2026-11';`,
   `select count(*) from notifications where emailed_at is not null;`.
2. `flyctl logs -a overture-web` for the incident window, filtered to dispatch gate reasons, `sendBackToReady` and
   mail refusals. No message bodies.
3. Cloudflare Email Sending activity for the same window, filtered by the sending domain; count only, no recipient
   addresses. Compare total sends with `mail_usage`; the difference is unrecorded sends or provider drops.
4. Cloudflare Email Routing activity and `wrangler tail overture-inbound-mail` for copies to `OWNER_FORWARD_TO`;
   count only.
5. Only then can each of the nine be named and matched to an Application, or marked lost at a specific hop.

## What to change (follow-ups, not part of this read-only ticket)

- Persist one outbound delivery row per send (category, `created_at`, provider `message_id`, status) and keep the
  Cloudflare `result.message_id`; write `messages.provider_message_id` for inbound. Without this, no future incident
  of this class can be traced (#695, #694).
- Make the inbound Worker write a per-copy record and address the user's current verified login email, never a
  global owner address (#693).
- Write an application event and a user-visible reason when preparation dies, instead of leaving `preparing` forever
  (#695, #703).
- Do not clear `approved_plan_enc` on a failed open before the failure is recorded; keep the reason and the plan hash
  so a "plan could not be read" bounce is diagnosable (#695).
- Clear the onboarding pause at card verification, not only at Start (#681, #687).

## Appendix — how the evidence was read

- Read-only SQLite URIs (`mode=ro`) on the walk and demo databases; columns limited to ids, statuses, timestamps,
  counters and error codes. No `*_enc` column, email, name or resume text was selected.
- Production probes were unauthenticated reads of the landing page and `/api/health`, plus the repository's deploy
  and ops workflow logs.
- No `flyctl` command beyond the read-only set (`auth whoami`, `orgs list`, `apps list`, `status`, `volumes list`,
  `secrets list` with names only) was run, and none mutated an app.
- No `gh` secret value was read; the repository's secret list returns names only.
