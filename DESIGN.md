---
name: Overture
description: A job-search agent that applies to roles for you, and shows its work.
colors:
  background: "#F3EEE4"
  sidebar: "#ECE6DA"
  card: "#FBF8F2"
  well: "#E9E3D8"
  foreground: "#151311"
  muted-foreground: "#5E5850"
  signal: "#D2561F"
  signal-text: "#933712"
  signal-soft: "rgba(210,86,31,0.10)"
  need: "#8E3A2C"
  need-soft: "#EFD9D3"
  ok: "#3F6B52"
  ok-soft: "#DDE7DE"
  border: "rgba(21,19,17,0.14)"
  input: "rgba(21,19,17,0.45)"
  dark-input: "rgba(242,237,228,0.36)"
  overlay: "rgba(21,19,17,0.16)"
  dark-background: "#191714"
  dark-sidebar: "#1E1C19"
  dark-card: "#221F1C"
  dark-well: "#2A2723"
  dark-foreground: "#F2EDE4"
  dark-muted-foreground: "#ADA69B"
  dark-signal: "#F0743A"
  dark-signal-text: "#FB9462"
  dark-need: "#E58A78"
  dark-need-soft: "#40261F"
  dark-ok: "#8DBFA2"
  dark-ok-soft: "#25352B"
typography:
  display:
    family: "Instrument Serif"
    weights: [400]
    fallback: "Newsreader, Georgia"
    use: "display, page and card titles, big numerals, scores, the owner's words"
  ui:
    family: "Plus Jakarta Sans"
    weights: [400, 500, 600, 700]
    fallback: "system-ui"
    use: "all interface text: body, buttons, labels, tables"
  mono:
    family: "IBM Plex Mono"
    weights: [400]
    fallback: "ui-monospace"
    use: "timestamps, counts, file names, 'via Greenhouse' — never paragraphs"
---

# Overture design system — Ember

The contract for every screen and every build on Ember v0.2: the palette, the nine typography tokens, the
components and the rules that make a screen look like Overture. **DESIGN.md is the single source of truth for
visual identity.** `docs/SPEC.md` is the source of truth for product — words, screens and behaviour. The installed
agent skills are engineering and UX guardrails; they never override this file's tokens or identity. Where a skill
and this file disagree on look, this file wins.

Per ADR 0037, PR #501's Tailwind v4 + Radix/shadcn rebuild supersedes pixel-for-pixel diffing against retired
pre-Ember PNGs in `design/reference/`; UI fidelity is enforced through tokens (`overture/no-raw-design-styles`),
`layout-guards-*`, `interactive-*`, `axe`, and seeded screen E2E tests.

Section B of that artifact — the later restatement with neutral paper, Newsreader and Archivo — was an
experiment that has been **removed**. There is one design, and this is it.

Product vocabulary, screens and behaviour come from `docs/SPEC.md`. The working list of boards still to draw or
redraw is `docs/research/boards-status.md`; boards that still say `Hold`, show the old nav (Job Board, Holds,
Answer Bank) or a Live Tab are read as `Queued`/`Review` and the destinations in `docs/SPEC.md` §15 (six in the
sidebar since ADR 0037: Home, Board, Ready, Review, Inbox, Calendar; Profile and Support open from the profile
menu); their *visual treatment* is what is fixed here.

---

## 1. Brand

The mark is an ink square holding a ring, with one orange stroke through it. It appears beside or above
the Overture wordmark, set in Instrument Serif. Nothing else in the product carries an orange stroke.

| Part | Construction |
|---|---|
| Square | 32 × 32, radius 7, ink |
| Ring | r 8.5, 1.5 stroke, paper |
| Stroke | x 16, y 5.5 → 26.5, 1.5, round cap, orange |
| Clear space | ½ mark on every side |
| Gap, beside | 0.34 × mark; wordmark 0.9 × mark |
| Minimum | mark 16px · lockup 96px wide |

Wordmark size: 32px in the landing nav, 30px in the app sidebar, 28px on a phone, 26px in the footer,
34px on the icon rail.

**The O is the opening. The orange stroke is the one move Overture makes for you.** That sentence is
the whole brand, and it is never explained inside the product.

Never: recolour the stroke (it is always orange), rotate or tilt the mark, stretch or squash it, add
glow or gradient or shadow, place it on a busy or coloured ground, or change the wordmark typeface.

## 2. Colour

Ink, paper and one orange. Greys are warm neutrals, not brown. The palette is called Ember and is the
only palette. Dark mode is its inverse — ink ground, paper text — lifted one step in v0.2 (page
`#191714`, card `#221F1C`, well `#2A2723`, muted text `#ADA69B`) so it reads softer without losing the
ink feel.

| CSS variable | shadcn | Light | Dark | Role |
|---|---|---|---|---|
| `--bg` | `--background` | `#F3EEE4` | `#191714` | Page ground |
| `--bg2` | `--sidebar` | `#ECE6DA` | `#1E1C19` | Sidebar, alternate bands |
| `--card` | `--card, --popover` | `#FBF8F2` | `#221F1C` | Cards, sheets, fields |
| `--well` | `--muted, --secondary, --accent` | `#E9E3D8` | `#2A2723` | Wells, hover and selected surfaces |
| `--ink` | `--foreground, --primary, --ring` | `#151311` | `#F2EDE4` | Text, primary button, focus ring |
| `--mut` | `--muted-foreground` | `#5E5850` | `#ADA69B` | Secondary text |
| `--acc` | `--signal` | `#D2561F` | `#F0743A` | Orange: fills, strokes, large text |
| `--acct` | `--signal-text` | `#933712` | `#FB9462` | Orange for small text |
| `--need` | `--destructive` | `#8E3A2C` | `#E58A78` | Needs you: a Review |
| `--ok` | — | `#3F6B52` | `#8DBFA2` | Screening, Interviewing, Offer |
| `--line` | `--border` | `rgba(21,19,17,.14)` | `rgba(242,237,228,.14)` | Hairline, default |
| `--line2` | `--input` | `rgba(21,19,17,.45)` | `rgba(242,237,228,.36)` | Control outline, 3:1 on the card |
| `--hl` | — | `rgba(255,255,255,.55)` | `rgba(255,255,255,.04)` | Letterpress highlight under rules |
| `--accbg` | `--signal-soft` | `rgba(210,86,31,.10)` | `rgba(240,116,58,.16)` | Tinted chip and tray |
| `--needbg` | `--need-soft` | `#EFD9D3` | `#40261F` | "Needs you" pill background |
| `--okbg` | `--ok-soft` | `#DDE7DE` | `#25352B` | Status pill background |
| `--btn` / `--btnink` | `--primary` / `--primary-foreground` | `#151311` / `#FBF8F2` | `#F2EDE4` / `#191714` | Primary button fill and label (`--btnh`: `#3A3631` light, `#FFFBF2` dark) |
| `--scrim` | `--overlay` | `rgba(21,19,17,.16)` | `rgba(0,0,0,.38)` | Behind sheets |

**Orange marks only live, current or in-flight state.** It is the moment Overture acts — Applying,
Submitted, the travelling dot, the Applied tray, the logo stroke. In app chrome it has exactly four
standing exceptions: nav count badges, the active nav marker, the one italic emphasis word of an app page
title, and the Applied lane. Transient indicators — an unread dot, the current onboarding step, a running
meter, a drop target, today in the Calendar — use the same orange while they are live. Orange is never a
hover colour, never a link colour and never a focus ring. Small orange text uses `--acct`, never `--acc`,
because `--acc` is 3.6:1 on paper.

The Board's first lane is **Queued**, with the ink rule (decided 2026-11-23, audit M6). The five lanes and
their rules are Queued `ink`, Ready `ok`, Applied `acc`, Waiting (Screening · Interviewing · Offer) `ok`,
Closed `mut`. Queued is ink because most of it needs nothing from the user; a Queued card waiting on a
Review carries the red "Needs you" pill instead. App chrome — selected cards, active tabs, meters, KPI
numerals — uses ink, never orange.

Statuses differ in lightness as well as hue. "Needs you" (a Review) is the only red. Applied and Submitted
are the only orange states.

Measured on the shipped hexes (text needs 4.5:1, 3:1 at ≥24px):

Control edges meet WCAG 2.2 1.4.11: raising `--input` to `rgba(21,19,17,.45)` light and
`rgba(242,237,228,.36)` dark takes the edge on the card from 1.9:1 / 2.2:1 to **3.0:1** in both modes.
That is the one colour change in this rollout. `--line` hairlines stay at `.14` (1.34:1 on the card) on
purpose: they are decoration and dividers, not the boundary of a control.

| Pair | Light | Dark |
|---|---|---|
| ink on bg | 16.0:1 | 15.3:1 |
| ink on card | 17.5:1 | 14.1:1 |
| mut on bg | 6.1:1 | 7.4:1 |
| mut on card | 6.6:1 | 6.8:1 |
| mut on well | 5.5:1 | 6.2:1 |
| acct on bg (small text) | 6.5:1 | 8.1:1 |
| acct on card | 7.1:1 | 7.4:1 |
| acc on bg (large text, strokes) | 3.6:1 | 6.2:1 |
| need on card | 7.1:1 | 6.4:1 |
| ok on card | 5.8:1 | 7.9:1 |
| card on ink (primary button) | 17.5:1 | 15.3:1 |
| input edge on card (1.4.11) | 3.0:1 | 3.0:1 |

Charts have no separate palette: the series is `signal`, the grid is `border`, the axis labels are
`muted-foreground`, and the tooltip is a card. The primary button is ink with paper text in both modes.

### Sign-in dark ground

The sign-in surfaces in dark mode use their own scoped token set, `.dark .signin-surface` in
`src/web/styles.css`, rather than the Ember dark above (ADR 0027). Every other screen keeps the dark column
of the table. Light mode is unchanged. Read the shipped values from that block; it is the only copy.

## 3. Typography

Three families, each with one job. Sizes are px at desktop; the phone column is what changes.

| Family | Weights | Job | Fallback |
|---|---|---|---|
| Instrument Serif | 400, italic | Display, headings, big numerals, scores. High-contrast editorial serif carrying the human, written-by-hand side | Newsreader, Georgia |
| Plus Jakarta Sans | 400 500 600 700 | All UI: body, buttons, labels, tables. Clean and round, reads at 12px. The precise, automated side | system-ui |
| IBM Plex Mono | 400 | Timestamps, counts, "via Greenhouse" only. A typewriter note, used sparingly, never for paragraphs | ui-monospace |

**The rule that makes provenance legible without a tooltip:** serif is what a person said, mono is what
the machine recorded, sans is the interface around it. Serif also sets display type — page and card titles,
big numerals, the Match score — because those are the editorial voice of the page, not data. Inside a
provenance context (an answer, a letter, the proof tab, a Review) the rule is strict: serif only for the
person's words, mono for every recorded fact (timestamps, file names, hashes, counts, "via Greenhouse").
Inline numbers in tables and metadata are mono and tabular. `Yes` in serif beside
`Saved answer · Used in 23 applications` in sans/mono *is* the product's promise, rendered.

**Nine tokens. Every text element uses one of them.**

| Role | Token | Size (Desktop) | Size (390px Mobile) | Line height | Tracking | Italic |
|---|---|---|---|---|---|---|
| Hero display (serif) | `text-hero` | clamp(44px, 6vw, 88px) | 44 | 1.06 | -.02em | Final emphasis word only |
| Section heading (serif) | `text-section` | clamp(32px, 4.2vw, 56px) | 32 | 1.08 | -.015em | Final emphasis word only |
| Page title (serif) | `text-page-title` | clamp(32px, 3vw, 42px) | 32 | 1.08 | -.01em | Final emphasis word only, `text-signal` |
| Card / item title (serif) | `text-card-title` | clamp(22px, 1.8vw, 26px) | 22 | 1.20 | — | Never |
| Metric numeral (serif) | `text-metric` | clamp(40px, 3.5vw, 52px) | 40 | 1.00 | — | Never (tabular upright) |
| Lead / Intro (sans) | `text-base` | 16 | 16 | 1.50 | — | Never |
| Body (sans) | `text-sm` | 14 | 14 | 1.43 | — | Never |
| Small / Mono metadata | `text-xs` | 12 | 12 | 1.33 | — | Never |
| Eyebrow / Micro-label (caps) | `text-eyebrow` | 11 | 11 | 1.20 | .14em | Never |

`text-page-title` is the app page-title token: `dsPageTitle` in `src/web/components/ui/ds.ts` uses it, and
every app route heading uses `dsPageTitle` or `PageHeader`. `text-section` is only for landing and marketing
surfaces. `text-hero` is only for the landing hero.

**Strict typography, component library & mobile rules (enforced by `overture/no-raw-design-styles`):**
- Every text element uses one of the 9 tokens above — never arbitrary `text-[...px]` or `text-[...rem]`, and never un-tokenized Tailwind scale jumps (`text-lg` through `text-9xl`). The rule covers all of `src/web`, routes and admin included.
- Line height comes from the token; add a Tailwind `leading-*` utility only where a denser or looser block genuinely needs it (a card title over two lines, display type on the landing). Never set a raw `leading-[…]` in new code.
- Italic serif is reserved **strictly** for the final emphasis word of Hero, Section and page headings (`h1`/`h2`) — never numerals, step badges, or card titles. In the app the page title's emphasis word is `italic text-signal` ("Good morning, *Sam.*", "Ready to *send*"); it is the only orange type in app chrome (ADR 0037).
- **Single-source shadcn/ui & 21st.dev component system (`src/web/components/ui/*`):** Never hand-roll buttons, cards, badges, inputs, tabs, switches, dialogs, command palettes, SVG charts, or calendars from scratch. Compose every screen from the shared primitives (`Button`, `Card`, `Badge`, `Input`, `Switch`, `Separator`, `Tabs`, `ScrollArea`, `ChartArea` via `recharts`, `Calendar` via `react-day-picker`, `CommandDialog` via `cmdk` + Radix Dialog, `AnimatedBeam`, and `lucide-react` icons), styled exclusively with Ember `@theme` tokens.
- Mobile (`390px`) is a first-class layout target alongside tablet (`768px`), laptop (`1280px`), and widescreen (`1440px+`): metadata lines stack cleanly instead of wrapping mid-phrase, previews swap to native `390px` mobile screens under `lg` (`1024px`), and touch targets stay `≥ 40–44px`.

Uppercase labels are 11px at `.14em` tracking, and always sit with a larger line that carries the
meaning — a column header or a card title, never a lone instruction. Display type is set tight
(1.02–1.15); body never is.

## 4. Space and layout

A 4px base. Every gap, padding and margin is a multiple of 4 (a few 2 and 6px optical nudges aside).

| Element | Value |
|---|---|
| Container | max 1200 · 1440 from 1700 |
| Side padding | 20 · 32 from `sm` · 48 from `lg` |
| App main padding | 16 sides / 20 top / 28 bottom at 390 · 28 / 28 from 768 · 56 from 1700 |
| App content max | 1440 |
| Sidebar / rail | 268 · 296 from 1700 · rail 76 |
| Board lane | five lanes, min 264 each, share the width (`repeat(5, minmax(264px, 1fr))`) |
| Sheet | 468 · 520 from 1700; the Board detail sheet is 500 · 540 |
| Phone sheet | 82dvh, bottom sheet with a 44×5 grab handle |
| Home grid | one column · two from 1024 (`lg`) |

Section rhythm on the landing is space, not dividers: 96px above and below, 88–120 on the hero, how it
works and the band. The band is the only full-bleed colour change. Texture bookends: the hero, and the
closing band plus footer as one block. Everything between sits on solid paper.

Media queries are on the viewport: 480 (hide Sign in), 700 (nav row, tray labels), 767/768 (app phone
layout, rail), 1099/1100 (KPI), 1279/1280 (sidebar), 1700 (large screens).

| Width | What happens |
|---|---|
| 390 | Phone. Landing one column, hero stacked, nav on a second row. App: sidebar hidden, bottom tab bar (Home, Board, Search, Profile, More). Home: one column. Board: lane tabs, card stack, bottom sheet |
| 768 | Landing stacks the hero. App: 76px icon rail replaces the sidebar; board columns scroll in their own box |
| 1024 | Hero two columns again. App: icon rail; Home cards two across |
| 1280 | Full 268px sidebar returns. Landing and app on the desktop layout at 1200 max |
| 1440 | Reference width. Container 1200 (padding 48). Sheet 468 over the board |
| 1920 | From 1700: container 1440, sidebar 296, main padding 56, content max 1440, sheet 520 |

## 5. Shape and depth

Flat paper with fine ink lines. Depth comes from hairlines and a soft contact shadow — never glow,
blur or gradient.

Radius is Tailwind's scale, nothing else:

| Radius | Utility | Where |
|---|---|---|
| 4px | `rounded-sm` | Inline chips, markers, small marks |
| 6px | `rounded-md` | Buttons, fields, icon buttons, tabs, badges |
| 8px | `rounded-lg` | Small containers, inner panels, sheet sections |
| 12px | `rounded-xl` | Cards, panels, board lanes, sheets, toasts, job cards |
| 16px | `rounded-2xl` | Landing tiles and stack cards, the phone bottom sheet's top |
| 999px | `rounded-full` | Pills, count badges, switches, circular monograms |

The one documented radius exception is the phone bottom sheet's 16px top radius (`rounded-t-2xl`).
The logo square's 7px is brand art, not a UI radius.

Line weights: `1px solid line` for card edges, dividers, table rows (with a 1px highlight beneath on
paper — letterpress). `1px solid line2` for controls and outlines. `1px dashed` for *not from the
resume*: saved-answer source tags, empty slots, a card that moved away, "Not scored yet". `2px dotted
line2` for the path in How it works only. `2–3px solid ink` for board column header rules, the active
tab underline and the selected-card ring.

Shadows: none on page, sidebar and wells. Cards carry `0 1px 0 rgba(21,19,17,.10),
0 12px 24px -18px rgba(21,19,17,.38)`; lifted surfaces `0 1px 0 rgba(21,19,17,.10),
0 28px 56px -26px rgba(21,19,17,.46)`; sheets `-30px 0 60px -34px rgba(21,19,17,.5)` (side) or
`0 -24px 50px -28px` (bottom). Dark mode swaps the ink in every shadow for black.

**Grain.** An SVG `feTurbulence` filter (fractalNoise, baseFrequency .85, three octaves) tinted by a
colour matrix, on a full-bleed layer that ignores the pointer. Light grain is warm grey (.30 .25 .20),
dark grain is paper (.96 .92 .85). The `grain` tweak maps 0–1 to 0–0.24 in light and 0–0.15 in dark,
default 0.5. Behind the whole page on Home and the board; on the landing only behind the hero and the
closing band plus footer, fading out with a mask. Never over text — cards and sheets are solid paper
above it.

## 6. Iconography

Stroke icons on a 24px grid with round caps and joins. No fills, no duotone, no emoji. The boards use
inline SVG; the build uses `lucide-react` at the same stroke weight.

| Stroke | Where |
|---|---|
| 1.6 | Navigation and tab bar |
| 1.7–1.8 | Buttons, fields, inline |
| 2–2.6 | Check marks and arrows at 12–14px |

Sizes: nav 18, rail 20, tab bar 21, buttons 14–16, inline 12–14. The touch target is the button, never
the icon. Icon-only buttons carry an `aria-label`; decorative icons are `aria-hidden`. Orange is not
used for icons except the check beside Submitted.

## 7. Motion

Two kinds of motion, with two rulebooks. Do not borrow one for the other.

### UI motion

The interface answers instantly and gets out of the way. Every UI transition is 120–200ms, ease-out, and
moves no more than 2px (1px on hover lift, 2px on press). Exits are faster than entrances: a thing that
leaves gets the short end of the range. No spring, no bounce, no overshoot, no delayed decoration.

| Property | Value |
|---|---|
| In / out | 120–200ms (`--duration-quick` 150ms, `--duration-base` 200ms) |
| Easing | `--ease-out: cubic-bezier(.2,.7,.2,1)`; Tailwind `ease-out`, the default transition curve |
| Travel | ≤2px for UI; sheets, modals and toasts may travel further |
| Hover | Only under `@media (hover: hover) and (pointer: fine)`; Tailwind's `hover:` variant already guards this |
| Reduced motion | Static: transitions and keyframes resolve to their finished state |
| Limit | No UI transition longer than 300ms. A modal, sheet or toast may use its entrance/exit budget |

The primitives (`Button`, `Card`, `Badge`, `Tabs`, `Switch`, nav links) use `transition duration-quick
ease-out`; the tokens are in `src/web/styles.css` and `transition` inherits the ease-out curve by default.
Never add a bespoke `transition-all` to a UI surface.

### Marketing motion

The landing choreography is the exception: 400–700ms, paper-like, elegant, never playful. The orange dot
is the only live mark.

| Property | Value |
|---|---|
| Easing | `cubic-bezier(.2,.7,.2,1)` |
| Duration | 400–700ms (stamp .5s, tray .5s, card .7s, marker .7s, summary .6s, chevron .4s) |
| Travel | ≤12px for reveals (stamp 6, summary 10) |
| Rotation | ≤6° (stack offsets 1.6–2.6, glide 4, stamp 3) |
| Tick | 800ms state timer drives every loop |
| Forbidden | springs, bounce, overshoot, parallax, auto-playing video |

The four choreographed surfaces, so nobody re-invents them:

1. **Sorting stack** (landing hero) — each card is one job resolving at a timestamp inside the user's
   08:00–20:00 sending window, at least 20 minutes after the last. Top card lifts 6px, shadow deepens,
   evidence rows draw in, receipt strip unfolds (.5s), the Applying stamp presses in (1.04→1 scale, 0→1
   opacity, −3°), then the card glides left into the Applied count. A non-fit lifts, fades in its one-line
   reason, glides right, muted. Cards behind sit smaller and dimmer. The tally ticks; at 8 pm the day's
   summary settles on top for ~5s. 34 ticks per loop.
2. **Travelling dot** (Where it applies) — connectors flow toward the hub (dashed stroke, 1.8s per dash
   period). The orange dot runs to each tile in turn, the tile border turns orange (no glow), a
   "Submitted" tag shows ~1.5s, the counter ticks. A faint breathing ring (4.6s) marks the active hub.
   On phone the connectors become a vertical spine.
3. **Reply reading** (every reply) — an 18-tick sequence: email slides in 10px, the label pill appears,
   the matching card lifts and slides to the next column (.7s) with a "Moved to …" note; a rejection
   crossfades in and its card slides to Closed.
4. **Path** (How it works) — a dotted path threads the six tiles through the gutters with a numbered
   node at each. One orange dot walks it at ~520px/s and rests .55s on each node, which lights with an
   orange ring.

**Reduced motion.** Every animation has a static state. With `animate` off or under
`prefers-reduced-motion`, transitions and keyframes are disabled and each loop shows one finished frame
— a stamped top card with partial counts, the connector with labels visible, the path with no dot. State
still changes; nothing moves.

## 8. Components

| Product element | shadcn/ui | 21st.dev / Magic UI |
|---|---|---|
| Landing hero stack | Card | The one sanctioned card stack (decided by Overture, not a gesture); `motion` library |
| How it works bento | Card | Bento Grid, paper-styled: solid surfaces, hairlines, no glow |
| Path and travelling dot | custom | Animated Beam, made elegant: one dot on a dotted path |
| Where it applies connector | custom | Animated Beam |
| Overnight list | Card, ScrollArea | Animated List |
| ⌘K workspace search | Dialog + Command (`cmdk`), `GET /api/workspace/search` | none |
| Usage meter | Progress | none |
| Applications chart | Chart (Recharts) | none |
| Date range control | ToggleGroup | none |
| Detail view | Sheet, Drawer, Tabs | none |
| Board lanes and drag | Card, ScrollArea; drag with `@dnd-kit/core` | none |
| Toasts with Undo | Sonner | none |
| Calendar month and day picker | Calendar (`react-day-picker`) | none |
| Tooltips, popovers, switches | Radix via `src/web/components/ui/*` | none |

The rebuild's stack (Radix dialog, popover, scroll-area, separator, slot, switch, tabs and tooltip; `cmdk`,
`sonner`, `motion`, `recharts`, `react-day-picker`, `@dnd-kit/core`, `class-variance-authority`, `clsx`,
`tailwind-merge`) is recorded in ADR 0037.

**Buttons.** Primary is ink with paper text, hover lightens to muted (dark: to near-white). Default is
44px high (`min-h-11`); the scale is xs 32, sm 36, default 44, lg 48 (52 from `sm`); icon buttons are 40,
icon-lg 44, and every phone control grows to 44–48. Radius 6. Secondary is the card surface with the
input outline; its hover is the well and the ink — `hover:bg-muted hover:text-foreground` with a
`foreground/30` border, never orange. Ghost (transparent, muted text, well on hover) is for low-priority
actions. Link is underlined ink. Disabled is .45 opacity, no hover, `not-allowed`, drawn for every
variant. Loading keeps the label, sets `aria-busy`, and disables the control; there is no spinner.

**Fields.** Height 48, radius 6, 1px `line2`, card fill; focus is the 2px ink ring with a 2px offset.
Always paired with a visible label or an `aria-label`. Select is a field with a chevron opening a popover
list on a card surface with lift shadow; the current value is bold with a check, the hovered row sits on
well. Invalid adds a `need` border and a 1px `need` ring, plus a message tied with `aria-describedby`.

**Chips, pills, badges.** `rounded-full`, 600 weight, 11–12px. Status pills tint a surface (`need-soft`,
`ok-soft`, `accbg`); the plain pill is outline on paper. Source tags: solid ink outline = from the
resume, dashed = from saved answers. The Applying stamp is the only rotated element (−3°, uppercase,
orange outline).

**Cards.** Monogram tile (ink, serif italic first letter), company, age; role in serif; location;
hairline; Match score in italic serif with the note on the right. The same component on the board, the
phone and the landing, enlarged. Interactive cards lift their shadow and move their border to
`foreground/30` on hover; no colour.

**Tabs.** Active = ink text + 2px ink underline. Phone stage tabs are pills, not tabs.

**Sheet.** Desktop side sheet 468 wide (520 at 1700+; the Board detail sheet 500/540); phone bottom sheet
82dvh with a 44×5 grab handle and the documented 16px top radius. Same content, different chrome.

**Navigation.** Right side of the landing reads Sign in, Start free, a 28px hairline, then the theme
icon — so the toggle is a utility, not a third call to action. Sign in is a 44px outline button with
full-contrast ink text; 12px between the two buttons. Under 860px the nav collapses to logo, Start free
and a 44px menu button; the sheet rises 8px over .4s and holds the links, Theme and Sign in. The menu
button carries `aria-expanded` and a label that changes between Open menu and Close menu.

Sidebar items: active = card surface, hairline, a 2px ink marker on the left edge (top edge in the tab
bar). The sidebar holds, top to bottom: the lockup and a collapse button, Search (⌘K), the six
destinations (Home, Board, Ready, Review, Inbox, Calendar), the Profile menu (Resume, Details,
Preferences, Account, Billing), Support and Notifications, then the theme toggle and the usage card. Under
1280, or when collapsed on desktop (remembered per browser), the sidebar becomes a 76px icon rail; under
768 a 64px tab bar with Home, Board, Search, Profile and More, where More opens a sheet with the other
destinations. There is no Settings destination: account and billing are Profile pages (ADR 0037).

A nav count badge is live product data, never a drawn sample: Ready counts the Applications waiting for
approval, Review the open Reviews, Inbox the unread employer mail. No badge shows at zero, and the link's
accessible name carries the count ("Review, 4 waiting"). The board's sample counts are sample data, not
copy.

**Toasts.** Card surface, `line2` border, lift shadow, radius 12, 356 wide (Sonner's default), bottom right (top on phone),
z-70. A toast reports something that happened: the orange check only when Overture acted, `need` colours
when it needs you, neutral otherwise. One ghost action at most. Enters with a 6px rise over 300ms, leaves
in 4s. Loading toasts use the same surface and an `aria-live` region.

**Hero stack card.** Ink monogram tile; role in serif (clamp 21–31); company; Match as a thin ring (2.5
stroke, ink for fits, muted for non-fits) with the italic score in the centre; one mono line for city,
work mode, salary; two evidence rows joining the posting's ask (muted) to the matching resume fact
(ink) with a dotted hairline; a receipt strip that unfolds for fits or the one-line reason for non-fits.
Radius 16, lift shadow, 24 padding, no inner boxes. A deck of three sits behind at 12/−10/8px offsets
and 2.2/−2.6/1.6°.

### Component states

Every interactive component draws all seven states. If a state does not apply, it is `—`, not absent.

| Component | Default | Hover | Focus | Active / pressed | Disabled | Invalid | Loading |
|---|---|---|---|---|---|---|---|
| Primary button | ink fill, paper label, `shadow-sh` | fill `btn-hover`, −1px lift | 2px ink ring, 2px offset | ink fill, 1px press | 45% opacity, `not-allowed`, no hover | — | `aria-busy`, label kept, disabled |
| Secondary button | card fill, `input` border | well fill, ink text, `foreground/30` border | 2px ink ring | well fill, 1px press | 45% opacity, no hover | — | `aria-busy`, label kept |
| Ghost / link | transparent, muted text | well fill, ink text (link: ink underline) | 2px ink ring | well fill | 45% opacity | — | `aria-busy` |
| Field | card fill, 48 high, `input` border | no hover change | 2px ink ring, 2px offset | caret only | 45% opacity, `not-allowed` | `need` border + 1px `need` ring, message via `aria-describedby` | `aria-busy`, read-only value |
| Card (interactive) | card, hairline, `shadow-sh` | `shadow-lift`, `foreground/30` border | ring on the inner control | selected: ink ring 1px | — | — | `aria-busy` on the card |
| Nav item | muted text | well, ink text | 2px ink ring | current: card surface + 2px ink marker | — | — | — |
| Tab | muted text | card/60, ink text | 2px ink ring | selected: card, ink text, shadow | 45% opacity, no pointer | — | — |
| Switch | well track, card thumb | `muted-foreground` border | 2px ink ring | on: ink track, thumb translates 16px | 45% opacity | — | — |

### Tables and lists

Tables are paper, not dashboards: a 1px hairline under the header row and between body rows, no zebra,
no vertical rules. The header is `text-eyebrow` uppercase tracked, muted. Cells are `text-sm`; every
number — counts, money, percentages, durations — is mono or tabular-nums so columns align. A row that
opens gets the well on hover and an ink focus ring on its control. On the phone a table becomes a list of
cards or definition rows; it never scrolls horizontally as a table.

Lists reuse the card or row primitives: title line, one metadata line, one trailing control. Empty lists
are empty states, not a table with one blank row.

### Nested surfaces

A card may sit on the well, and a well may sit on a card: paper on paper on paper. Three levels is the
limit. Each level changes exactly one cue — the well is the darker fill, the card is paper with a
hairline and `shadow-sh`, the innermost strip drops the shadow and keeps the border. Never nest a shadow
inside a shadow, never nest a sheet in a card, and never put text directly on the grain.

### Z-index layers

| Layer | z | What lives there |
|---|---|---|
| 20 | `z-20` | Sidebar, icon rail, sticky board header |
| 50 | `z-50` | Phone tab bar, dialogs, command palette, popovers, menus |
| 60 | `z-60` | Sheet scrim and sheet (detail sheet, code-paste sheet, phone More) |
| 70 | `z-70` | Toasts (Sonner) |

Nothing sits above 70. Native `<dialog>` sheets use the top layer and do not need a z-index.

## 9. Patterns

### Loading

Loading is a skeleton of the real layout on the well, `animate-pulse`, never a spinner and never a blank
page. The skeleton keeps the page's landmarks and heading so the screen does not jump when data lands.
Slow operations (a PDF render, a batch send) keep their control visible, set `aria-busy`, and show the
one-line progress copy in the card. A route-level load uses `RouteFallback`, which keeps the shell.

### Empty

Every list, board, table and inbox has a designed empty state: a card title in `dsCardTitle`, one
sentence of what would be here, and exactly one primary action that fills it. No illustrations, no
invented samples. Sample data on the landing or a demo account is labelled "Sample data"; a product empty
state never pretends to have data.

### Error

An error says what happened, what was not sent, and what happens next — in that order. Page-level errors
use the reusable `RouteErrorCard` — the page `h1`, one sentence, Try again and Back to Home — as the router
`errorElement` on the root, the app shell, the admin shell and every route, with a class boundary around each
shell's outlet so a failed lazy chunk shows the card instead of a blank page. Section errors stay in the
section, use `need` for the heading or icon, and carry `role="alert"`. A failed send always states that
nothing was charged. Never replace the whole page with an error when one card failed.

### Form errors and aria-live

Every field has a visible label (or an `aria-label`). An invalid field sets `aria-invalid`, adds
`aria-describedby` pointing at the message, and the message is `role="alert"` with `need` text. The
first invalid field receives focus on submit. Form-level errors sit above the actions and use
`role="alert"`. Toasts are an `aria-live="polite"` region (Sonner), validation summaries and destructive
confirmations are `assertive`; no message is carried by colour alone — it always has words.

### When there is no board

If a screen has no canvas board, build it from this document and the shared primitives: the tokens, the
page-title/card-title roles, the 4px grid, the component states above, and the closest existing screen as
a pattern. Do not invent a new colour, radius, size or motion value to fill the gap, and do not copy a
board's labels or captions as product copy. Record the missing board in `docs/research/boards-status.md`
in the same pull request. When a board and this document disagree on look, this document wins; when either
disagrees with `docs/SPEC.md` on product, the spec wins.

### Two composition rules matter more than the inventory

1. **Provenance is a component.** Any answer carries its source in a chip — `From your resume`,
   `From your saved answers`, `Typed here`. It is never optional decoration.
2. **Honesty blocks are fixed.** Every reply carries `What Overture did`. Every dossier carries the
   receipt strip. Every failure says what was not sent **and** that nothing was charged.

## 10. Voice

Plain and direct. Short, neutral sentences. Say what Overture does and what you control.

Plain section titles — How it works, Where it applies, Pricing, Questions. One short sentence, then
stop. Concrete verbs: finds, scores, answers, writes, submits, tracks. Name the control: "Anything it
is unsure about waits for you." Fictional sample data is labelled "Sample data".

No hype, no superlatives, no exclamation points, no emoji, no invented metrics, none of the banned words
(`Hold` as a stage, runner, lease, provider, dispatch, attempt, ledger, credit, CAPTCHA, Brain, Hands). Inline numbers are mono and tabular (display numerals follow §3). A
failure says what happened, what was not sent, and what happens next. Where a policy could be misread,
state the boundary rather than the marketing line.

## 11. Accessibility

- **Contrast.** 4.5:1 minimum for all text, including 11px grey labels; 3:1 from 24px. Small orange
  text always uses `signal-text`.
- **Not by colour alone.** Statuses differ in lightness, wording or shape: "Needs you" is a labelled pill,
  source tags differ by outline style, the active tab is underlined, the active nav item carries a
  marker.
- **Target size.** 44px minimum on touch: phone buttons 48, tab bar 60, stage pills 44, icon buttons
  44, toggles 44. Pointer-only desktop controls may be 40. A compact control that must stay 34px
  visually (notification CTAs) is the 44px element, with a -5px top and bottom margin so the row does
  not grow; the painted 34px box is an inner span.
- **Control edges.** Inputs, selects, textareas, checkboxes and switches draw a 3:1 `--input` edge on the
  card (WCAG 2.2 1.4.11). `--border` stays a soft hairline because it is decoration, not a control.
- **Focus.** 2px solid ink ring with a 2–3px offset on every interactive element. Never removed, never
  orange.
- **Real elements.** `button`, `a`, `input` with a label or `aria-label`. Decorative SVG is
  `aria-hidden`; informative SVG has `role="img"` and a label.
- **Theme control.** A real button with a state-aware label: "Switch to dark mode" / "Switch to light
  mode".
- **Motion.** Reduced-motion users get the static state of every animation. No motion is needed to
  understand anything. Nothing flashes. UI motion follows §7.
- **Language and order.** Plain words, one `h1` per page, headings in order, reading order matching
  visual order.
- **Landmarks and skip link.** Every route has exactly one visible `main` (`id="main-content"`) and one
  visible `h1`. The first tab stop on every page is "Skip to content", rendered once by `RootLayout`,
  which is hidden until focused and moves focus to `main`. A sheet or dialog title is an `h2`. Admin gate
  screens carry the page `h1`.
- **Hover.** Every pointer control changes surface, text, border or underline on hover, except the current
  page and an on toggle, which already show their strongest state. Guard: `test/e2e/interactive.test.ts`
  checks pointer cursor, hover, focus ring, 44px on phones, landmarks, headings and axe on every route.

---

## 12. What we keep even though the linter flags it

`impeccable detect` scores the canvas, not the build, and its rules mix defects with taste. We do not
chase the score, and this section records why so it is not re-litigated every time the tool runs.

The distinction: **the detector is authoritative on defects and advisory on taste.** Contrast, tap
targets, heading order and overflow are defects — they are fixed, and the boards measure clean on all
four. Everything below is a style rule derived from what large numbers of generated sites do. Applying
them here removes the qualities that make this look authored rather than assembled.

| Flag | Why we keep it |
|---|---|
| `nested-cards` | Board columns and specimen sheets exist to show nesting. Flattening a specimen stops it being a specimen |
| `overused-font` | A face is not slop because other people use it; slop is using it with no rule. Ours is semantic and written down: serif is a person's words, mono is a machine's fact, sans is the interface. A distinctive face with a weak rule reads worse than a common face with a strong one |
| `cream-palette` | The paper *is* the metaphor. A job hunt is paperwork, applications, letters. A cool grey ground turns this into a dashboard |
| `italic-serif-display` | Italic marks the owner's own voice — a signal, not a gradient. It appears where a person is speaking, and since ADR 0037 on the one emphasis word of a heading (§3) |
| `undersized-ui-text` | 11px tracked caps are a print convention for column headers and status pills, always paired with a larger line, always at 4.5:1. The remaining hits are a PDF mock rendered at page scale |
| `numbered-section-labels` | `fig. 1`, `01 ·` are a canvas device only: the boards read as a plate book, while the app ships no fig, folio or section-number labels (#307) |
| `tight-leading` | Display type is set at 1.02–1.15 by design; body stays at 1.5 and is never flagged |
| `pulsing-dot` | The one live mark in the system, with a static state under `prefers-reduced-motion` |
| `hero-eyebrow-chip` | A tracked-caps kicker above an `h1` is a masthead convention and carries real categorisation |

What we refuse in **both** directions: we do not add gradients, glows, glass, decorative card stacks (the
landing hero's sorting stack is the one sanctioned stack), floating orbs,
emoji, invented metrics or a second accent colour to look contemporary; and we do not suppress the
detector to make a report look clean. If a rule starts catching a **defect**, it is fixed at the source
and this table is updated.

Two things survive any restyle, and they are the difference between authored and generated:

- every colour in the palette has one job, and orange has exactly one;
- every number on screen is traceable to something the product actually knows.

## 13. Brand assets

Drawn at true pixel size on the Brand assets board.

| File | Size | Use |
|---|---|---|
| `favicon.svg` | vector | Browser tab; swaps ink and paper under `prefers-color-scheme: dark` |
| `favicon.ico` | 16/32/48 | Legacy browsers, one file |
| `favicon-16/32/48.png` | 16–48 | Tab at 1x, taskbar at 2x, search results |
| `apple-touch-icon.png` | 180 | iOS home screen, full-bleed ink, no transparency or rounding |
| `icon-192.png` · `icon-512.png` | 192, 512 | PWA manifest, store listings |
| `icon-512-maskable.png` | 512 | PWA maskable, mark inside the central 80% safe circle |
| `og-image.png` | 1200×630 | Open Graph share |
| `twitter-card.png` | 1200×600 | X large summary card |
| `avatar-400.png` | 400 | Social avatar, mark inside a centred circle for round crops |
| `logo-horizontal-{paper,ink}.svg` | vector | Mark beside wordmark, min 96px wide |
| `logo-stacked-{paper,ink}.svg` | vector | Mark over wordmark, min 56px wide |

## 14. Boards

The list of boards still to draw or redraw lives in `docs/research/boards-status.md`. This document
governs how the product looks; that file tracks the canvas work. A screen with no board is built from
this document and the shared primitives, and the gap is added there in the same pull request.
