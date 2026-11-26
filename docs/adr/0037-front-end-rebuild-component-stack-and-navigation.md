---
status: proposed
---

# The front-end rebuild: component stack, navigation and Board lanes

The 2026-11-23 front-end rebuild (worktree `bonefish`, branch `a-hagi613/canvas-design-implementation-agents`)
changed the app's shell, routes and component library without an ADR. This records what it decided, so the next
change has something to amend. It is `proposed` until the rebuild merges; the open items below must be closed or
accepted first. The audit of the rebuild against the back end is `docs/research/backend-audit-2026-11-23.md`.

## Decision

**Component stack.** Screens are composed from shared primitives in `src/web/components/ui/*` (shadcn on Radix), not
hand-rolled. New runtime dependencies on the rebuild branch, all imported by its shipped code:

| Package | Used for |
|---|---|
| `@radix-ui/react-{dialog,popover,scroll-area,separator,slot,switch,tabs,tooltip}` | the `ui/*` primitives |
| `class-variance-authority`, `clsx`, `tailwind-merge` | variant classes (`cn`) |
| `cmdk` | the ⌘K workspace search dialog |
| `sonner` | toasts, including every Undo |
| `@dnd-kit/core` | dragging cards between Board lanes |
| `recharts` | the Home applications chart |
| `react-day-picker` | the Calendar's month grid and day picker |
| `motion` | the landing's hero stack and section animations |

This supersedes ADR 0034's rejection of `react-day-picker` (it is now used without `date-fns`).

**Routes.** The public landing is `/`; a signed-in visitor at `/` sees the landing, and the app's Home is `/home`.
`/signup` is a page (production sign-up is still owner-only while `PUBLIC_SIGNUP_ENABLED=false`). The `/settings/*`,
`/pricing`, `/search` and `/inbox/address` pages are removed. The marketing Worker serves only `/`
(`src/shared/marketing-paths.ts`).

**Navigation.** Six sidebar destinations, in order: Home, Tracker, Ready, Review, Inbox, Calendar. Profile opens a menu
of five pages (Resume, Details, Preferences, Account, Billing, under `/profile/*`); Support (`/support`) and
Notifications sit below it. Settings is not a destination: account controls are Profile → Account and billing is
Profile → Billing (`/profile/billing`, which Stripe Checkout and the portal return to). A ⌘K workspace search
(`GET /api/workspace/search`) and the theme toggle sit in the sidebar. The sidebar collapses to a 76px rail on demand
and under 1280px; under 768px a tab bar shows Home, Board, Search, Profile and More.

**Board lanes.** The Board shows three columns that group the seven Stages: Queue (Queued and Ready), Applied and
Interviews (Screening, Interviewing, Offer); Closed, Cancelled and Not sent sit behind "Show closed". The Stage
model, the API and `canMoveApplicationToStage` are unchanged; a drop on Interviews writes `screening`, and
Interviewing and Offer stay settable from the card's Move menu. The card's URL parameter is `?application=<id>`
(the `#688` amendment, 2026-11-26, below).

**2026-11-26 amendment (#688).** The Tracker board is now three visible columns (Queue · Applied · Interviews)
with Closed / Cancelled / Not sent behind an explicit "Show closed" filter, so the page never scrolls sideways.
Each card opens the job drawer at `?application=<id>`: opening pushes a history entry so Back closes it, closing
replaces, and a shared deep link opens the drawer directly. ⌘K searches jobs and applications and navigates to
the selected application's page with the drawer open. The sidebar puts Tracker above Ready and Review; Ready and
Review remain pages.

**Page titles.** Each page title's final emphasis word is italic serif in `text-signal` (DESIGN §3).

## Considered options

The rebuild did not record its reasons; these are the shapes it replaced.

- **Settings as a seventh destination** (ADR 0029, DESIGN §13 before this): replaced by Profile → Account and
  Profile → Billing.
- **Seven Board columns, one per Stage** (DESIGN §2 before this): replaced by five lanes. At 1280px the five lanes
  (`minmax(264px, 1fr)` each) are still wider than the main column, so the Board scrolls sideways in its own box.
- **A prerendered `/pricing` page** (#239, #284): replaced by the landing's Pricing section, which reads the same
  numbers from `src/shared/plans.ts`.

## Open items (close before this is accepted)

- **Removed routes need redirects** (audit H5): `/settings/*` → the matching Profile page, `/pricing` → `/#pricing`,
  `/search` → `/home`, `/inbox/address` → `/profile/details#profile-address` (the job-search address card). Links, push and email URLs, the PWA `start_url`
  and the Stripe portal's default return URL (`scripts/setup-stripe.ts`) still point at `/` or `/settings/billing`.
- **The e2e suite still targets the removed routes and Home at `/`** (audit H8).
- **Support access lost its screen** (audit H7): ADR 0015 requires the user to see support access and the Reveal log.
- **Words and colour.** The first lane is labelled "On hold" (banned, ADR 0020) and, with the nav count badges and the
  active nav marker, uses orange where DESIGN §2 reserves orange for the moment Overture acts. Either DESIGN §2 widens
  or the build changes.
- **The canvas is behind the build.** The boards in DESIGN §13 must be redrawn for the new shell, the three Tracker columns, the
  Profile pages and Support.

## Consequences

- `docs/SPEC.md` §15, `DESIGN.md` (§2, §3, §4, §8, §13), `GLOSSARY.md` (**Board lane**), `docs/DEPLOY.md` and
  `workers/marketing/README.md` describe the new shell.
- A server response that only removed screens read (`upNext` and `readyToSend` on `GET /api/home`, the signed-out
  `GET /api/search`) is dead weight until a screen uses it or it is removed.
- About 29 web files have no importer after the rebuild and should be deleted with it.
