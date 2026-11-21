# Architecture and interfaces sweep, 2026-11-21 (issue #302, lane: modules, API, schema)

One-time review of module boundaries, API routes, shared types, the schema and its migrations, and the
docs that describe them. Every finding was read against `origin/main` at `20ba8ca` (M2 in progress) and
is ranked by severity. Behaviour bugs already owned by another sweep (`docs/research/server-logic-sweep-2026-11-21.md`,
`docs/research/security-review-m1-2026-11-21.md`, `docs/research/scalability-m2-2026-11-21.md`) are not
repeated here; where they overlap, this file only records the interface or schema consequence.

Scope: `src/server/routes`, `src/server/*/…` service seams, `src/shared`, `src/server/platform/db/schema.ts`,
`drizzle/`, `docs/SPEC.md`, `docs/adr/`. Not `src/web` visual work and not dispatch/catalog correctness.

## Method

- Read the route table in SPEC §14 and compared it with every handler registered under `/api` and
  `/admin/api`, one by one.
- Compared the SPEC §5 data model, table by table, with `src/server/platform/db/schema.ts` and the
  generated migrations (`drizzle/*.sql`), including indexes, triggers, cascades and CHECK constraints.
- Traced each route handler to the module that owns the rule it applies, looking for rules living only in
  the HTTP layer or duplicated across the server and the web clients.
- Read all 12 colocated unit tests and ADR 0013's claim about which invariants they cover.
- Nothing was run against an ATS, production or hiring.cafe (ADR 0016). No browser e2e was run for this
  document; each fix PR runs its own targeted tests.

## Ranked findings

| # | Severity | Where | Finding | Fix |
|---|---|---|---|---|
| 1 | High | `src/server/routes/applications.ts:30`, `:545-550` | The Board move API accepts `queued` as a target, although the Board contract is a drag between Applied…Closed (SPEC §8.5). A `sent` Application can therefore be dragged back to Queued and then withdrawn (`row.stage === "queued"` qualifies), so a sent Application becomes "withdrawn": the exact "a sent application cannot be un-sent" invariant of SPEC §5.4. A legacy or hand-written request does it without the UI. Fixed in #348. | Restrict targets to Applied…Closed and decide withdrawability from `status`, not from a mutable `stage`. |
| 2 | High | `src/server/platform/db/schema.ts:764-781` (and every enum column), `drizzle/0013_ledger_grants.sql:27`, `drizzle/0015_safe_angel.sql:32` | SPEC §5 promises "enums are `TEXT` with `CHECK`", but the database has exactly two CHECKs (`ledger.amount > 0`, `fx_rates.per_usd > 0`). Drizzle `text(..., { enum })` is a TypeScript type only. Any writer — a script, the test-only routes, a future migration — can store `status='snet'`, `stage='Ready'`, `answer_kind='guess'`, and the read path trusts it. The contract exists in the spec and the type system, not in the data. | Add the CHECK constraints table by table in guarded rebuild migrations (SQLite cannot add a CHECK in place), starting with `applications.status`, `.stage`, `.origin`, `questions.field_type`/`answer_kind`, and extend `scripts/verify-db.ts` to assert them. This needs its own PR and a migration number; #300/#303/#323 hold migrations today. |
| 3 | High | `docs/SPEC.md:1125`, `src/web/lib/home-api.ts:52-89`, `src/server/routes/home.ts:662-704` | SPEC §14 says every route is typed "via Hono RPC", but the web uses hand-written `fetch` + zod clients and no Hono RPC client exists. The copies have already drifted: `/api/home` returns `upNext` (and a duplicate `readyToSend`), which the web schema does not declare, so zod strips both. `upNext` is also the most expensive part of the request (the full candidate scan in scalability finding 2) and no screen renders it. The server cannot see the drift because it types the payload as an object literal. | One `src/shared/api/*.ts` zod schema per response, used as `satisfies` on the server payload (compile-time) and parsed by the web (runtime). Start with Home; then Board and Ready. Update SPEC §14 to say "shared zod contract", not Hono RPC. |
| 4 | Medium | `src/server/routes/api.ts:92-113` | `GET /api/settings`, `GET /api/settings/:key` and `GET /api/kill-switches` have no session check and are mounted on the public app host. Any anonymous caller learns every admin-tunable limit, the provider, and which ATS/employer/provider kill switches are engaged. These three routes are absent from SPEC §14; the tests that use them all hold an owner session, so nothing depends on the public access. | Require `role === "owner"` (401 `sign_in_required`, 403 `owner_required`) or move the reads to `/admin/api`; document them in SPEC §14. Blocked by #335, which edits `routes/api.ts`. |
| 5 | Medium | `src/server/routes/{home,notifications,applications,checkins}.ts` vs `{profile,matching,onboarding,mail}.ts`; `src/server/routes/api.ts:103`, `inbound.ts:178`, `mail.ts:122` | There are two 401 codes for the same condition (`sign_in_required` and `unauthorised`), two 404 spellings (`not_found` and `"not found"`), and mixed 409 codes (`not_queued`, `cannot_undo`, `already resolved`). `zValidator` failures return a ZodError body, while a direct `.parse` throws a 500 (finding 6). A client cannot branch on one contract, and the admin gate client already special-cases one code (`sign_in_required`). | One code set in `src/shared/api-errors.ts` (`sign_in_required`, `forbidden`, `not_found`, `invalid_request`, `conflict`, …), one `zValidator` wrapper that maps issues to `{error:"invalid_request", issues}`, and one `onError` that returns JSON instead of Hono's text 500. Adopt it file by file; document the set in SPEC §14. Most target files are held by #304/#324/#335 today. |
| 6 | Medium | `src/server/routes/profile.ts:172` | `PUT /api/profile/facts` parses the body with `factsSchema.parse(await context.req.json())` instead of `zValidator`. A malformed body throws a ZodError that Hono answers as a 500 text response, not the 400 every other mutation returns. SPEC §14 promises all routes are Zod-validated. | Use `zValidator("json", factsSchema)`; add a test that a bad Fact body is 400. Blocked by #304. |
| 7 | Medium | `src/server/routes/notifications.ts:57-67` | The notification list orders `createdAt` ascending with `LIMIT 100`, so it returns the **oldest** 100 rows. A user with more than 100 notifications never sees a new one, and the in-app bell (SPEC §15.1) silently stops updating. Nothing in the web client asks for a later page. | Query newest-first (keyset on `(created_at, id)`), then reverse for display; add a test that the 101st notification is visible. Blocked by #324. |
| 8 | Medium | `src/server/matching/applications.ts:32-61` | `createApplication` inserts with `onConflictDoNothing()` and returns the freshly generated ULID even when the unique `(user_id, posting_id)` insert conflicted. The caller then enqueues `application.prepare` for an application id that does not exist (`matching/score.ts:405`). The pre-check makes the race unlikely under the single-process sync driver, but the function's contract is "an id for a row I created" and it does not keep it. | `…onConflictDoNothing().returning({id: applications.id}).get()`; return `null` when nothing was inserted. The unit test needs the ADR 0013 allow-list, which #317 holds, so this waits for the next pass. |
| 9 | Medium | `src/server/routes/applications.ts:713-747` | `GET /api/applications/:id` returns the whole `applications` row as `application`, including the sealed `approved_plan_enc`, `score_at_queue`, `attempts`, `origin` and `scheduled_for`, although the card view is a documented subset. The web schema strips the extras, so the response contract is accidental and grows with every schema column. `test/e2e/approval.test.ts:161-165,364` currently reads `approvedPlanEnc` from this response to prove the sealed plan is not plaintext, so narrowing it means moving that assertion to a DB read. | Return an explicit card view (`id`, `status`, `stage`, `stageLocked`, `sentAt`, `createdAt`, `updatedAt`, `closedReason`, `readyAt`, `scheduledFor`, `changes`); adjust the approval test. |
| 10 | Low | `docs/SPEC.md:218,1219`; `docs/adr/0013-real-code-in-tests.md:24-34`; `docs/SPEC.md:1139-1140` | Docs have drifted from the code: SPEC §16.2 says "nine files, Vitest" and there are 12 `bun:test` files; ADR 0013 says thirteen invariants and names `address.test.ts`, which does not exist; SPEC §5 says `REFERENCES user(id)` while the table is `users`; §14 omits `GET /api/health`, `/api/password-reset`, the notification and push routes, `GET /api/profile/resume/:id/file` and the admin suspend/reinstate/live-check routes, and documents `DELETE /api/push/:id` while the code has `POST /api/push/unsubscribe`. §12 omits `limits.send_spacing_minutes`, `jobs.*`, `catalog.*`, `backups.*` and `live_checks.*`. | One docs PR after the open SPEC PRs (#298, #303, #304, #333, #340) merge. Do not hand-edit around them. |
| 11 | Low | `src/server/platform/db/schema.ts:8,16-17` vs `applications` (`created_at` is a bare `integer`) | Timestamps have two runtime representations: the `timestamp()` helper maps an INTEGER to a `Date`, a bare `integer` maps to a number. Every route must remember `.getTime()` (`home.ts:572`, `applications.ts:851`), and one missed conversion serializes an ISO string into a field the web client types as `number`. The database stays INTEGER either way, so the split is invisible in migrations. | Pick one representation. Bare INTEGER milliseconds matches SPEC §5 and the web contracts; converting the `timestamp()` columns is a schema-wide, read-only-mechanical change. Until then, a lint rule or a response-schema test (`satisfies` from finding 3) catches a missed conversion. |
| 12 | Low | `src/server/platform/settings/index.ts:8-51`, `src/server/routes/admin.ts:57,683-701` | Numeric settings are untyped strings: defaults are a `Record<string,string>`, `getSetting` returns `string | null`, and every module parses the value itself (server-logic sweep finding 5, fix in #319). The admin write accepts any key and any non-empty string, so a typo (`limits.dailycap`) is stored and read by nothing, and a bad value silently falls back in some modules and disables the feature in others. `limits.reply_per_day` remains in the defaults although SPEC §11.2 says replies are not built. | Typed setting definitions (key → zod schema + default) with `getSettingNumber` from #319, reject unknown keys on `PUT /admin/api/settings/:key`, delete the unbuilt reply setting. Wait for #319 and #323. |

## Verified sound

- User-owned tables all use the same `cascadeUserId()` FK (`schema.ts:15-20`, 29 tables); the two nullable
  `user_id` columns (`events`, `llm_usage`) are deliberate global rows.
- `scripts/verify-db.ts` really builds every migration and asserts WAL, `synchronous=FULL`,
  `foreign_keys=ON`, STRICT on every table and a strictly increasing journal `when`. Run it after any
  migration rebase.
- The immutability triggers exist and match SPEC §5.4: `application_snapshots_no_update` and
  `…_delete_only_without_user` (`drizzle/0021`), the ledger pair (`drizzle/0013`), `consent_versions`
  (`drizzle/0038`), and the mailbox retirement pair (`drizzle/0031`).
- The FTS triggers keep `postings_fts` in step on insert, update, delete and company rename, and closed
  Postings leave the index (`drizzle/0003:75-91`).
- Route ownership checks are consistent: every mutating handler scopes its query by `user_id` (or by an
  owner gate for `/admin/api`), and the `applications` partial unique index still enforces one `sending`
  row per user.
- Inbound mail, the ledger, the outbound guard and the session cookie settings were checked and found
  sound by the security sweep; this pass found no new exposure beyond finding 4 (operational, not personal
  data).

## Blocked by open PRs

`src/server/routes/{api,profile,notifications,admin,onboarding,matching,test-only,app}.ts`,
`src/server/platform/db/schema.ts`, `src/server/platform/settings/index.ts`, `docs/SPEC.md`,
`docs/adr/0013-*` and `drizzle/` are touched by #300, #303, #304, #311, #319, #323, #324, #325, #326 and
#335. Findings that need those files are recorded above and must be fixed after the owning PR merges
(rebase first). Finding 1 is fixed in #348; finding 8 stays open for the next pass because its unit test needs the ADR 0013 allow-list.
