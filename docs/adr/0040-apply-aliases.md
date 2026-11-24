---
status: accepted
---

# Apply aliases return: every account gets a readable address on ALIAS_EMAIL_DOMAIN

Amends ADR 0028 (which superseded the generated `first.last@mail.tryoverture.com` address of ADR 0005) and
ADR 0014 (the alias is stored as plain mail routing data, never sealed). Implements issue #566, part of the owner's
Part 1 architecture revision (issue #560).

ADR 0028 put the person's real email on every application form: the resume goes out byte for byte, so a different
address could look inconsistent, and some ATSes flag synthetic addresses. The owner has since reversed that trade:
a dedicated apply address is the promise of "zero setup", one alias per person also stops one shared domain from
being a single point of failure, and a stealth apex later is a one-line change. This ADR records the new decision,
its limits and how it is rolled out without a second migration.

## Decision

1. **A readable alias at signup.** Each account is assigned `<first.last>@ALIAS_EMAIL_DOMAIN` when its mailbox is
   provisioned, with a short suffix (`alex.chen.4k`) when the base is taken. `ALIAS_EMAIL_DOMAIN` defaults to
   `MAIL_DOMAIN` (`tryoverture.com`). The handle is lowercase ASCII, at most 32 characters before the suffix.
2. **The full address is stored, not derived.** `mailboxes.apply_address` holds the complete string. Changing
   `ALIAS_EMAIL_DOMAIN` changes only future assignments: an existing alias keeps the address employers were given,
   so a stealth apex or a second domain needs no migration and no rewrite.
3. **System local parts are reserved.** `support`, `hello`, `security`, `privacy`, `admin`, `no-reply`, `noreply`,
   `postmaster`, `abuse`, `billing`, `help`, `info`, `legal`, `notify`, `alerts`, `jobs`, `careers`, `apply`,
   `webmaster`, `hostmaster`, `root` and `mailer-daemon` are never a handle and never its first dot-label. A person
   named `support` gets a suffixed handle or the neutral `person` base, never `support@`.
4. **One handle per person, across domains.** A unique index over the alias local part (not only the full address)
   means a domain change can never hand the same handle to a second person.
5. **Aliases are retired like forwarding addresses.** A trigger records the local part in `retired_addresses` when a
   mailbox is deleted, and triggers refuse to insert or update a mailbox onto a retired local part. Mail for a former
   account is therefore never delivered to whoever would have got the handle next.
6. **New applications use the alias by default.** While `profiles.use_personal_email` is false, the plan's `email`
   answers come from the alias, substituted at plan time from the stored Tier 1 email fact. Approve/send snapshots
   keep the address they went out with. Profile → Account carries **"Use my personal email instead"**, which switches
   new applications to the sign-in email and, because those codes arrive in the person's own mailbox, asks for a
   pasted verification code instead of capturing it from the Inbox.
7. **The alias is also the job-search address.** It is shown read-only on Profile → Account and returned by
   `GET /api/profile/apply-email`; the person's own email stays editable in their facts.
8. **The forwarding address is unchanged.** `in-{id}-{mac}@MAIL_DOMAIN`, its HMAC check in the Worker and the
   ATS-domain filter guide keep working for existing accounts, and both the alias and the forwarding address resolve
   to the same mailbox at ingest.
9. **Isolated outbound domain.** `NOTIFY_MAIL_DOMAIN` (`notify.tryoverture.com`) names the sending domain for
   transactional mail, onboarded and verified by `scripts/onboard-email-sending.ts --notify`/`--all`.

## Limits and rollout

- Alias *delivery* is the apex catch-all in the inbound Email Worker (issue #561, merged): any address on
  `ALIAS_EMAIL_DOMAIN` is accepted, an employer reply is forwarded from `notify@notify.tryoverture.com`, and the app
  resolves the full stored alias to its mailbox. The forwarding address and its filter guide stay as a second path.
- The manual-code path's 0-second ask and the email fallback for expiring codes are WS-6a (issue #565); this ADR
  only records the preference they read.
- Existing accounts are backfilled lazily rather than in the migration: `GET /api/profile/apply-email`,
  `GET /api/profile/mailbox` and `scripts/backfill-mailboxes.ts` assign an alias where one is missing. A migration
  cannot invent readable, unique handles from names without app logic, and a rewrite is exactly what this design
  avoids.
- The alias is mail routing data, not personal content: it is stored unsealed so inbound routing and the
  retired-address triggers work without a per-user key, matching the forwarding local part.
- The migration is additive only: `mailboxes.apply_address` is nullable, `profiles.use_personal_email` has a
  default, and no column is renamed or dropped. Old code ignores both, so a rollback is a redeploy with the
  columns left in place, and no batch backfill runs on the hot path.
