# Front-end sweep: pages and components (#302)

Scope: `src/web` routes and components. Builds on `docs/research/qa-layout-2026-11-21.md` (the measured audit); this
file ranks what to fix and in which PR. Each item below was re-checked against `origin/main` 7f62ff5 in the source.
Items owned by other work (#306 app shell/CSS baseline, #307 annotations and nav badges, open PRs #298 #300 #301
#303 #304 #311) are listed as **deferred** and picked up after those merge (#308 and #309 scope included).

## Ranked findings

| # | Sev | Finding | Where | Fix | PR |
|---|---|---|---|---|---|
| 1 | High | Primary buttons render with no ink colour: `text-btn-ink` is not a theme token (only `--color-primary-ink` exists), so the label inherits the dark body colour on a dark fill. | `components/strengthen-facts.tsx:11`, `components/targets-section.tsx:56` | Use `text-primary-ink`; add a unit test that every `text-*/bg-*/border-*` colour token used in `src/web` is defined in `styles.css` (G6). | A |
| 2 | High | No error state on the main data pages. `useHomeData`, `useReady`, `useBoard`, `useReviews`, `useNotifications` are read as `{ data }` only, so a failed request looks like an empty account ("0 queued", empty board) instead of an error with a retry. Only the onboarding pages handle failure. | `routes/home.tsx:54`, `routes/ready.tsx:31`, `routes/board.tsx:62`, `routes/review.tsx:15`, `routes/notifications.tsx:36` | One shared `LoadFailed` block (message plus Try again, `role="alert"`) rendered when the query errors and has no data; new copy keys only (no edits to existing copy blocks owned by #307). | B |
| 3 | High | Sidebar is not fixed, usage card and avatar sit at the end of the page. | `app.tsx:62-86` | **Deferred to #306** (app shell). | - |
| 4 | High | Canvas annotations ship (`fig. N`, `folio NN`, `§2`, tab ordinals) and nav badges are hardcoded 2/4/3 for every user. | `copy.ts` and render sites listed in qa-layout §3 | **Deferred to #307**. | - |
| 5 | Med | Profile tab bar gets its own vertical scrollbar at 390 (`overflow-x-auto` plus `-mb-px` makes it 1 px taller than its box). | `routes/profile.tsx:30,34` | `overflow-y-hidden`, mark `data-scroll-region`. Touches the tab row that #307 edits (ordinals), so rebase after #307. | C |
| 6 | Med | Buttons have `cursor: default` (Tailwind v4 preflight), no shared disabled style. | `styles.css` | **Deferred to #306** (baseline). Per-component hover gaps (89 sites in qa-layout §2) are #308, taken after #306. | D |
| 7 | Med | Touch targets under 44 px at 390: rail/theme/bell icon buttons, range tabs, "Open Inbox/Ready", Mark all as read, stage pills, Search submit, admin sub-nav, onboarding brand link. | see qa-layout §2 | #308 scope; components in my lane, `app.tsx` and `page-header.tsx` parts wait for #306 and the open PRs. | D |
| 8 | Med | Headings and landmarks: `/admin*` has no `h1`; `/board` has two (page and sheet); no skip link; `/search`, `/admin*` have no `header`. | `routes/admin/page-heading.tsx`, `components/board-sheet-header.tsx`, `routes/search.tsx` | Admin `h1`, sheet title to `h2`. `board-*` and `inbox` files are touched by #301, so the Board part waits for it. Skip link goes with the shell (#306). | E |
| 9 | Med | Admin has no navigation under 1024 (no rail or top nav that fits) and 36 px sub-nav targets. | `routes/admin/shell.tsx`, `admin-chip-nav.tsx` | #309 scope. | F |
| 10 | Med | Page header wraps to three rows at 390 on Home. | `components/page-header.tsx` | Two rows max. File is touched by #300 and #301: after both merge. | G |
| 11 | Low | Settings has no sub-pages or pill sub-nav that the boards draw. | `routes/settings.tsx` | Being built by #300 and #303; re-check after. | - |
| 12 | Low | `/board`, `/review`, `/inbox` timed out at 768 dark in the audit sweep; unconfirmed. | - | Re-test after the guards exist; no change until reproduced. | - |
| 13 | Low | No board-match baselines for Settings, Inbox, Search, admin, or at 768/1024/1440/1920. | `test/e2e` | Add as screens settle (after the open PRs). | - |

Loading and empty states: not re-audited per page in this pass beyond finding 2; Ready, Notifications and Search have
explicit empty states, Home and Board render zeros as the boards do. A per-route pass for loading skeletons is queued
with PR D once the shell lands.

## Order of work

1. **A** tokens (finding 1) with the guard test.
2. **B** error states (finding 2).
3. After #306/#307 merge: **C** (5), **D** (6-7), **E** (8), **F** (9); after #300/#301 merge: **G** (10).
4. Findings 11-13 are tracked here and revisited once their owners merge.

Every PR: "Refs #302", tests with the change, 390/1280 light and dark screenshots of touched routes, `bun run verify`
through `heavy`.
