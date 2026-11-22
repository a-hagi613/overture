---
name: Overture
description: A job-search agent that applies to roles for you, and shows its work.
source: Claude artifact P3aiZsEXkoUKBrknvvBNJJ — Section A, boards 1–3 (design system)
colors:
  background: "#F3EEE4"
  sidebar: "#ECE6DA"
  card: "#FBF8F2"
  muted: "#E9E3D8"
  foreground: "#151311"
  muted-foreground: "#5E5850"
  signal: "#D2561F"
  signal-text: "#A9431A"
  signal-soft: "rgba(210,86,31,0.10)"
  need: "#8E3A2C"
  need-soft: "#EFD9D3"
  ok: "#3F6B52"
  ok-soft: "#DDE7DE"
  border: "rgba(21,19,17,0.14)"
  input: "rgba(21,19,17,0.28)"
  overlay: "rgba(21,19,17,0.16)"
  dark-background: "#191714"
  dark-sidebar: "#1E1C19"
  dark-card: "#221F1C"
  dark-muted: "#2A2723"
  dark-foreground: "#F2EDE4"
  dark-muted-foreground: "#ADA69B"
  dark-signal: "#F0743A"
  dark-signal-text: "#F37D44"
  dark-need: "#E58A78"
  dark-need-soft: "#40261F"
  dark-ok: "#8DBFA2"
  dark-ok-soft: "#25352B"
typography:
  display:
    family: "Instrument Serif"
    weights: [400]
    fallback: "Newsreader, Georgia"
    use: "display, headings, big numerals, scores"
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
rounded:
  xs: "2px"
  sm: "5px"
  md: "6px"
  lg: "8px"
  xl: "10px"
  card: "12px"
  pill: "999px"
spacing:
  base: "4px"
components:
  button-primary:
    background: "foreground"
    foreground: "card"
    height: "40px app, 46px landing, 52px landing hero, 48px phone"
    radius: "6px"
  button-secondary:
    background: "card"
    foreground: "foreground"
    border: "1px solid input"
    height: "40px app, 44px phone"
  icon-button:
    size: "40px, 44px on phone"
  field:
    height: "40px"
    radius: "6px"
    border: "1px solid input"
    focus: "2px solid foreground, 2px offset"
  grain:
    light-max-opacity: 0.24
    dark-max-opacity: 0.15
    default: 0.5
motion:
  easing: "cubic-bezier(.2,.7,.2,1)"
  ui-duration: "400–700ms"
  travel: "≤12px"
  rotation: "≤6deg"
  tick: "800ms"
---

# Overture design system — Ember

The contract for every screen and every build. Everything below is transcribed from the shipped design
system boards (Section A, boards 1–3 of the canvas artifact `P3aiZsEXkoUKBrknvvBNJJ`). The canvas is the wireframe:
**the build matches its boards pixel for pixel.** Where this document and a design-system board disagree on
appearance, the board wins and this document is corrected. Where a board disagrees with `docs/SPEC.md` on
product (words, screens, behaviour), the spec wins and the board is redrawn; §13 lists those boards.

Section B of that artifact — the later restatement with neutral paper, Newsreader and Archivo — was an
experiment that has been **removed**. There is one design, and this is it.

Product vocabulary, screens and behaviour come from `docs/SPEC.md`. This file governs how the
product looks. Until §13's redraws land, boards that still say `Hold`, show the old nav (Job Board, Holds, Answer Bank) or a Live Tab are
read as `Queued`/`Review` and the destinations in `docs/SPEC.md` §15 (six since ADR 0029: Home, Ready, Board,
Review, Inbox, Profile); their *visual treatment* is what is fixed here.

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
| `--acct` | `--signal-text` | `#A9431A` | `#F37D44` | Orange for small text |
| `--need` | `--destructive` | `#8E3A2C` | `#E58A78` | Needs you: a Review |
| `--ok` | — | `#3F6B52` | `#8DBFA2` | Screening, Interviewing, Offer |
| `--line` | `--border` | `rgba(21,19,17,.14)` | `rgba(242,237,228,.14)` | Hairline, default |
| `--line2` | `--input` | `rgba(21,19,17,.28)` | `rgba(242,237,228,.26)` | Control outline |
| `--hl` | — | `rgba(255,255,255,.55)` | `rgba(255,255,255,.04)` | Letterpress highlight under rules |
| `--accbg` | `--signal-soft` | `rgba(210,86,31,.10)` | `rgba(240,116,58,.16)` | Tinted chip and tray |
| `--needbg` | `--need-soft` | `#EFD9D3` | `#40261F` | "Needs you" pill background |
| `--okbg` | `--ok-soft` | `#DDE7DE` | `#25352B` | Status pill background |
| `--scrim` | `--overlay` | `rgba(21,19,17,.16)` | `rgba(0,0,0,.38)` | Behind sheets |

**Orange marks only the moment Overture acts** — Applying, Submitted, the active step, the travelling
dot, the Applied tray, the logo stroke. Not links, not hover, not focus, not decoration. Small orange
text uses `--acct`, never `--acc`, because `--acc` is 3.6:1 on paper.

Statuses differ in lightness as well as hue. "Needs you" (a Review) is the only red. Applied and Submitted
are the only orange states. Board column rules: Queued `ink`, Applied `acc`, Screening · Interviewing · Offer
`ok`, Closed `mut`. Queued is ink because most of it needs nothing from the user; a Queued card waiting on a
Review carries the red "Needs you" pill instead. App chrome — selected cards, active tabs, meters, KPI
numerals — uses ink, never orange.

Measured on the shipped hexes (text needs 4.5:1, 3:1 at ≥24px):

| Pair | Light | Dark |
|---|---|---|
| ink on bg | 16.0:1 | 15.3:1 |
| ink on card | 17.5:1 | 14.1:1 |
| mut on bg | 6.1:1 | 7.4:1 |
| mut on card | 6.6:1 | 6.8:1 |
| mut on well | 5.5:1 | 6.2:1 |
| acct on bg (small text) | 5.2:1 | 6.7:1 |
| acct on card | 5.7:1 | 6.1:1 |
| acc on bg (large text, strokes) | 3.6:1 | 6.2:1 |
| need on card | 7.1:1 | 6.4:1 |
| ok on card | 5.8:1 | 7.9:1 |
| bg on ink (primary button) | 16.0:1 | 15.3:1 |

Chart colours: `--chart-1` signal, `--chart-2` ink, `--chart-3` ok, `--chart-4` muted-foreground,
`--chart-5` need. The primary button is ink with paper text in both modes.

### Sign-in dark ground

The sign-in surfaces (`/signin`: sign-in, magic-sent, refused and suspended) in dark mode use the ground of the redrawn sign-in boards (`design/reference/source/w5-signin.dc.html`, the `.ov.dark` block, and the #203 sign-in states), not the Ember dark above (ADR 0027). They are a scoped token set, `.dark .signin-surface` in `src/web/styles.css`; every other screen keeps the dark column of the table. Light mode is unchanged. The reference pack for the new states is `design/reference/signin/` at 390 and 1280, with `sign-in` redrawn without the password field (ADR 0035).

| CSS variable | Sign-in dark (canvas) | Ember dark (other screens) |
|---|---|---|
| `--bg` | `#12110F` | `#191714` |
| `--bg2` | `#181614` | `#1E1C19` |
| `--card` | `#1B1916` | `#221F1C` |
| `--well` | `#24211D` | `#2A2723` |
| `--ink` | `#F2EDE4` | `#F2EDE4` |
| `--mut` | `#A39C92` | `#ADA69B` |
| `--line` | `rgba(242,237,228,.12)` | `rgba(242,237,228,.14)` |
| `--line2` | `rgba(242,237,228,.24)` | `rgba(242,237,228,.26)` |
| `--hl` | `rgba(255,255,255,.035)` | `rgba(255,255,255,.04)` |
| `--bloom` | `rgba(255,255,255,.04)` | `rgba(255,255,255,.04)` |
| `--acc`, `--acct` | `#F0743A` | `#F0743A`, `#F37D44` |
| `--need`, `--needbg` | `#E58A78`, `#3A211C` | `#E58A78`, `#40261F` |
| `--ok`, `--okbg` | `#8DBFA2`, `#1F2E26` | `#8DBFA2`, `#25352B` |
| primary button text | `#12110F` | `#221F1C` (card) |
| `--btnh` (primary hover) | `#FFFBF2` | `#FFFBF2` |
| `--sh` | `0 1px 0 rgba(0,0,0,.45), 0 12px 26px -20px rgba(0,0,0,.9)` | `0 1px 0 rgba(0,0,0,.4), 0 12px 26px -20px rgba(0,0,0,.8)` |
| `--lift` | `0 1px 0 rgba(0,0,0,.5), 0 30px 60px -26px rgba(0,0,0,.92)` | `0 1px 0 rgba(0,0,0,.5), 0 30px 60px -26px rgba(0,0,0,.92)` |

The canvas's `--btnink`, `--btnh`, `--sh` and `--lift` map to the scoped `--color-primary-ink`,
`--color-btn-hover`, `--shadow-sh` and `--shadow-lift`. Tokens the sign-in surface does not draw (`--accbg`,
`--okbg` as a chip, `--scrim`, `--gridln`, `--focus`) are left out.

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

| Role | Size | At 390 | Line height | Tracking |
|---|---|---|---|---|
| Hero (serif, italic for one emphasis) | clamp(56px, 6.8vw, 100px), 124 at 1700+ | 56 | .96 | -.022em |
| Page title (serif) | 42 | 32 | 1.05 | -.005em |
| Section (serif) | clamp(40px, 4.6vw, 64px) | 40 | 1.02 | -.015em |
| Band headline (serif) | clamp(34px, 5vw, 72px), 72–92 at 1700+ | 34 | .98 | -.02em |
| Sub-head (serif) | 28 | 24 | 1.1 | — |
| Card title (serif) | 26 | 22 | 1.15 | — |
| Body | 14 | 13.5 | 1.55 | — |
| Small / hint | 12.5 | 12.5 | 1.5 | — |
| Eyebrow (caps) | 11 | 11 | 1.2 | .15em |
| Label (caps) | 10.5 | 10.5 | 1.2 | .14em |

Uppercase labels are 10.5–11px at `.14–.15em` tracking, and always sit with a larger line that carries
the meaning — a column header or a card title, never a lone instruction. Display type is set tight
(1.02–1.15); body never is.

## 4. Space and layout

A 4px base. Every gap, padding and margin on the boards is a multiple of 4 (a few 2 and 6px optical
nudges aside).

| Element | Value |
|---|---|
| Landing container | max 1200 · 1440 from 1700 |
| Landing side padding | clamp(20px, 4vw, 48px) |
| Landing hero | 2 columns, gap 56/64, min column 400 |
| Bento | 12 columns · gap 28 · row gap 64 · rows 424 424 420 330 |
| Connector | 1160 design units, scales to 1400 |
| Home content | padding 26/36 · 18/16 at 390 · 32/64 at 1920 |
| Sidebar / rail | 268 · 76 · 300 at 1920 |
| Board column | 252 wide, gap 16 · up to 340 |
| Sheet | 468 · 520 at 1920 · bottom sheet 566 high at 390 |
| KPI grid | auto-fit min 210, gap 16 · 2×2 under 1100 |

Section rhythm on the landing is space, not dividers: 96px above and below, 88–120 on the hero, how it
works and the band. The band is the only full-bleed colour change. Texture bookends: the hero, and the
closing band plus footer as one block. Everything between sits on solid paper.

Media queries are on the viewport: 480 (hide Sign in), 700 (nav row, tray labels), 767/768 (app phone
layout, rail), 900 (connector becomes lists), 1099/1100 (bento and KPI), 1279/1280 (sidebar), 1700
(large screens).

| Width | What happens |
|---|---|
| 390 | Phone. Landing one column, hero stacked, bento and band as vertical lists, nav on a second row. Home: sidebar hidden, 2×2 KPIs, bottom tab bar. Board: stage pills, card stack, bottom sheet |
| 768 | Landing stacks the hero; bento single column (max 600). App: 76px icon rail replaces the sidebar; board columns scroll in their own box |
| 1024 | Hero two columns again; connector scales with its container; bento still one column to 1099. App: icon rail, KPIs 2×2 to 1099, four across from 1100 |
| 1280 | Full 268px sidebar returns. Landing and app on the desktop layout at 1200 max |
| 1440 | Reference width. Container 1200 (padding 48). Bento on a 12-column grid with the path; sheet 468 over the board |
| 1920 | From 1700: container 1440, hero visual zoomed 1.18, connector 1400, display to 124. App: sidebar 300, main padding 64, KPI numerals 66, chart 270 high, columns to 340, sheet 520 |

## 5. Shape and depth

Flat paper with fine ink lines. Depth comes from hairlines and a soft contact shadow — never glow,
blur or gradient.

| Radius | Where |
|---|---|
| 2px | Stamp, sheets in a pile, kbd |
| 5px | Segmented option, small monogram |
| 6px | Buttons, fields, icon buttons, nav items |
| 7px | Logo square (of 32) |
| 10px | Cards, panels, job cards, big monogram |
| 12px | Hero stack cards, bento tiles, connector tiles, phone job cards |
| 16px top | Phone bottom sheet |
| 999px | Pills, stage pills, count badges |

Line weights: `1px solid line` for card edges, dividers, table rows (with a 1px highlight beneath on
paper — letterpress). `1px solid line2` for controls and outlines. `1px dashed` for *not from the
resume*: saved-answer source tags, empty slots, a card that moved away, "Not scored yet". `2px dotted
line2` for the path in How it works only. `2–3px solid ink` for board column header rules, the active
tab underline and the selected-card ring.

Shadows: none on page, sidebar and wells. Cards carry `0 1px 0 rgba(21,19,17,.10),
0 12px 24px -18px rgba(21,19,17,.38)`; lifted surfaces `0 1px 0 rgba(21,19,17,.10),
0 28px 56px -26px rgba(21,19,17,.46)`; sheets `-30px 0 60px -34px rgba(21,19,17,.5)` (side) or
`0 -24px 50px -28px` (bottom).

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

Slow and paper-like. Elegant, never playful. The orange dot is the only live mark.

| Property | Value |
|---|---|
| Easing | `cubic-bezier(.2,.7,.2,1)` |
| UI duration | 400–700ms (stamp .5s, tray .5s, card .7s, marker .7s, summary .6s, chevron .4s) |
| Travel | ≤12px for reveals (stamp 6, summary 10) |
| Rotation | ≤6° (stack offsets 1.6–2.6, glide 4, stamp 3) |
| Tick | 800ms state timer drives every loop |
| Forbidden | springs, bounce, overshoot, parallax, auto-playing video |

The four choreographed surfaces, so nobody re-invents them:

1. **Sorting stack** (landing hero) — each card is one job resolving at a timestamp inside the user's
   08:00–20:00 sending window, at least 20 minutes after the last. Top card lifts 6px, shadow deepens, evidence rows draw in, receipt strip unfolds (.5s), the
   Applying stamp presses in (1.04→1 scale, 0→1 opacity, −3°), then the card glides left into the
   Applied count. A non-fit lifts, fades in its one-line reason, glides right, muted. Cards behind sit
   smaller and dimmer. The tally ticks; at 8 pm the day's summary settles on top for ~5s. 34 ticks per
   loop.
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
| ⌘K search | Command | none |
| Usage meter | Progress | none |
| Applications chart | Chart (Recharts) | none |
| Date range control | ToggleGroup | none |
| Detail view | Sheet, Drawer, Tabs | none |

**Buttons.** Primary is ink with paper text, hover lightens to muted (dark: to near-white). Heights 40
in the app, 46 on the landing, 52 in the hero, 48 on phone; icon button 40/44. Radius 6. Ghost
(transparent, muted text, well on hover) is for low-priority actions. Disabled is .45 opacity, no
hover, `not-allowed`, drawn for every variant.

**Fields.** Height 40, radius 6, 1px `line2`, card fill; focus is the 2px ink ring. Always paired with
a visible label or an `aria-label`. Select is a field with a chevron opening a popover list on a card
surface with lift shadow; the current value is bold with a check, the hovered row sits on well.

**Chips, pills, badges.** 999 radius, 600 weight, 11–12px. Status pills tint a surface (`need-soft`,
`ok-soft`, `accbg`); the plain pill is outline on paper. Source tags: solid ink outline = from the
resume, dashed = from saved answers. The Applying stamp is the only rotated element (−3°, uppercase,
orange outline).

**Cards.** Monogram tile (ink, serif italic first letter), company, age; role in serif; location;
hairline; Match score in italic serif with the note on the right. The same component on the board, the
phone and the landing, enlarged.

**Tabs.** Active = ink text + 2px ink underline. Phone stage tabs are pills, not tabs.

**Sheet.** Desktop side sheet 468 wide (520 at 1920); phone bottom sheet 566 high with a 44×5 grab
handle. Same content, different chrome.

**Navigation.** Right side of the landing reads Sign in, Start free, a 28px hairline, then the theme
icon — so the toggle is a utility, not a third call to action. Sign in is a 44px outline button with
full-contrast ink text; 12px between the two buttons. Under 860px the nav collapses to logo, Start free
and a 44px menu button; the sheet rises 8px over .4s and holds the links, Theme and Sign in. The menu
button carries `aria-expanded` and a label that changes between Open menu and Close menu.

Sidebar items: active = card surface, hairline, 3px orange marker on the left edge (top edge in the tab
bar). Under 1280 the sidebar becomes a 76px icon rail; under 768 a 64px tab bar.

A nav count badge is live product data, never a drawn sample: Ready counts the Applications waiting for
approval, Review the open Reviews, Inbox the unread employer mail. No badge shows at zero, and the link's
accessible name carries the count ("Review, 4 waiting"). The board's 2 / 4 / 3 are sample counts for the
drawn example, not copy.

**Toasts.** Card surface, `line2` border, lift shadow, radius 8, 340 wide, bottom right (top on phone).
A toast reports something that happened: the orange check only when Overture acted, `need` colours when it
needs you, neutral otherwise. One ghost action at most. Enters with a 6px rise over .5s, leaves in 4s.

**Hero stack card.** Ink monogram tile; role in serif (clamp 21–31); company; Match as a thin ring (2.5
stroke, ink for fits, muted for non-fits) with the italic score in the centre; one mono line for city,
work mode, salary; two evidence rows joining the posting's ask (muted) to the matching resume fact
(ink) with a dotted hairline; a receipt strip that unfolds for fits or the one-line reason for non-fits.
Radius 12, lift shadow, 24 padding, no inner boxes. A deck of three sits behind at 12/−10/8px offsets
and 2.2/−2.6/1.6°.

**Two composition rules matter more than the inventory:**

1. **Provenance is a component.** Any answer carries its source in a chip — `From your resume`,
   `From your saved answers`, `Typed here`. It is never optional decoration.
2. **Honesty blocks are fixed.** Every reply carries `What Overture did`. Every dossier carries the
   receipt strip. Every failure says what was not sent **and** that nothing was charged.

## 9. Voice

Plain and direct. Short, neutral sentences. Say what Overture does and what you control.

Plain section titles — How it works, Where it applies, Pricing, Questions. One short sentence, then
stop. Concrete verbs: finds, scores, answers, writes, submits, tracks. Name the control: "Anything it
is unsure about waits for you." Fictional sample data is labelled "Sample data".

No hype, no superlatives, no exclamation points, no emoji, no invented metrics, none of the banned words
(`Hold` as a stage, runner, lease, provider, dispatch, attempt, ledger, credit, CAPTCHA, Brain, Hands). Inline numbers are mono and tabular (display numerals follow §3). A
failure says what happened, what was not sent, and what happens next. Where a policy could be misread,
state the boundary rather than the marketing line.

## 10. Accessibility

- **Contrast.** 4.5:1 minimum for all text, including 11px grey labels; 3:1 from 24px. Small orange
  text always uses `signal-text`.
- **Not by colour alone.** Statuses differ in lightness, wording or shape: "Needs you" is a labelled pill,
  source tags differ by outline style, the active tab is underlined, the active nav item carries a
  marker.
- **Target size.** 44px minimum on touch: phone buttons 48, tab bar 60, stage pills 44, icon buttons
  44, toggles 44. Pointer-only desktop controls may be 40.
- **Focus.** 2px solid ink ring with a 2–3px offset on every interactive element. Never removed, never
  orange.
- **Real elements.** `button`, `a`, `input` with a label or `aria-label`. Decorative SVG is
  `aria-hidden`; informative SVG has `role="img"` and a label.
- **Theme control.** A real button with a state-aware label: "Switch to dark mode" / "Switch to light
  mode".
- **Motion.** Reduced-motion users get the static state of every animation. No motion is needed to
  understand anything. Nothing flashes.
- **Language and order.** Plain words, one `h1` per page, headings in order, reading order matching
  visual order.

---

## 11. What we keep even though the linter flags it

`impeccable detect` scores this canvas at 524 findings. We are not chasing that number, and this section
records why so it is not re-litigated every time the tool runs.

The distinction: **the detector is authoritative on defects and advisory on taste.** Contrast, tap
targets, heading order and overflow are defects — they are fixed, and the boards measure clean on all
four. Everything below is a style rule derived from what large numbers of generated sites do. Applying
them here removes the qualities that make this look authored rather than assembled.

| Flag | Count | Why we keep it |
|---|---|---|
| `nested-cards` | 75 | Board columns and specimen sheets exist to show nesting. Flattening a specimen stops it being a specimen |
| `overused-font` | 50 | A face is not slop because other people use it; slop is using it with no rule. Ours is semantic and written down: serif is a person's words, mono is a machine's fact, sans is the interface. A distinctive face with a weak rule reads worse than a common face with a strong one |
| `cream-palette` | 18 | The paper *is* the metaphor. A job hunt is paperwork, applications, letters. A cool grey ground turns this into a dashboard |
| `italic-serif-display` | 13 | Italic marks the owner's own voice — a signal, not a gradient. It appears where a person is speaking and nowhere else |
| `undersized-ui-text` | 7 | 10.5–11px tracked caps are a print convention for column headers and status pills, always paired with a larger line, always at 4.5:1. The remaining hits are a PDF mock rendered at page scale |
| `numbered-section-labels` | 6 | `fig. 1`, `01 ·` are a canvas device only: the boards read as a plate book, while the app ships no fig, folio or section-number labels (#307) |
| `tight-leading` | 4 | Display type is set at 1.02–1.15 by design; body stays at 1.55 and is never flagged |
| `pulsing-dot` | 3 | The one live mark in the system, with a static state under `prefers-reduced-motion` |
| `hero-eyebrow-chip` | 3 | A tracked-caps kicker above an `h1` is a masthead convention and carries real categorisation |

What we refuse in **both** directions: we do not add gradients, glows, glass, decorative card stacks (the
landing hero's sorting stack is the one sanctioned stack), floating orbs,
emoji, invented metrics or a second accent colour to look contemporary; and we do not suppress the
detector to make a report look clean. If a rule starts catching a **defect**, it is fixed at the source
and this table is updated.

Two things survive any restyle, and they are the difference between authored and generated:

- every colour in the palette has one job, and orange has exactly one;
- every number on screen is traceable to something the product actually knows.

## 12. Brand assets

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

## 13. Boards to redraw

Product changes since the boards were drawn. Each is redrawn on the canvas before the slice that builds that
screen, then built to match. Visual treatment stays; words, structure and behaviour follow `docs/SPEC.md`.

| Board | Change |
|---|---|
| Every app board | **Redrawn and built on Home, Ready, Board, Review, Profile, Settings, Notifications and Inbox; card detail is still to do.** Seven destinations on desktop in this order: Home, Ready, Board, Review, Inbox, Calendar, Profile (Ready added by ADR 0029, Calendar by ADR 0034; the phone tab bar keeps six), Settings from the avatar; no "Job Board", "Holds", "Answer Bank", "Activity", "Personal workspace"; one "Applications left" figure, no "Match Scores" counter; `--hold` tokens renamed `--need` |
| Job Board | **Redrawn and built as Board.** Queued replaces Hold as the first column, ink rule; red "Needs you" pill on cards waiting on a Review. The Ready column sits between Queued and Applied with the green rule (ADR 0029): cards show "Ready to send" with a Send button until approved, then their send time, and hold Sending and Checking with the employer until confirmed sent |
| Ready | **New, drawn and built (ADR 0029, `w5-ready`, #195).** The Ready destination, heading "Ready to send": approval cards with the job, employer, resume file, every answer as it will be typed with its source, the cover letter and what changed; Send, Skip, Edit an answer; approved cards with their send time and Undo; "Send all"; empty and all-approved states; phone and desktop |
| Holds | **Redrawn as Review (file `w5-holds`).** Becomes Review: open questions grouped by jobs unlocked |
| Answer Bank, Resume | **Redrawn: folded into Profile.** Fold into Profile: resume, facts by tier, targets with live count, skip list, job-search address |
| Settings | **Redrawn; the legal card (Terms, Privacy, the consent version you agreed to) is added by #214.** No approval mode (approval is not a setting: every send is approved, ADR 0029), no "Overnight window", no user-set company limit or daily caps, no UTC reset; the fixed limits explained (10 a day, 08:00–20:00 local, one company per 30 days, reset at local midnight). **Account pages drawn (`d207-*`):** Notifications, Export, Delete account, Support access, Terms and privacy, as five tabs under Settings; **Export is built (#224)**, the rest follow their tickets |
| Onboarding 1–4 | **Welcome/Sign in and Resume drawn and built (`w5-onb`, #215), Your facts drawn and built (`w5-onb-questions`, #128); What you want and Forwarding & start are drawn and build in #216 and #217.** Five steps: Sign in · Resume · Your facts · What you want · Forward ATS mail (the filter guide and the paste fallback) + consent + trial + Start; invited sign-in states are drawn with Sign In; no "Connect inbox", no Gmail, no "Memory Base" |
| Sign In | **Google, LinkedIn and an emailed link only; no password, sign-up, forgot or reset screens (ADR 0035).** Dark uses the sign-in dark ground (§2, ADR 0027) |
| Product states | **Pause reasons drawn on Home (`w5-home-paused`, #157).** No Gmail connect states; add `confirming` ("Checking with the employer"), each pause reason, out of applications |
| Billing (M3, #240) | **Drawn at 1280 and 390, light and dark, in `design/reference/{settings-billing,onb-trial,billing-plans,home-paused-billing,out-of-applications}` (sources `design/reference/source/w5-settings-billing`, `w5-onb-trial`, `w5-billing-plans`, `w5-home-paused-billing`, `w5-out-of-applications`).** Settings **Plan and billing** (`/settings/billing`) is the sixth tab of `SettingsAccountTabs`: current plan with Applications left and renewal, Week or Month switch at renewal, cancel at period end, Stripe portal and invoices. **Onboarding step 6** (`/onboarding/trial`, after step 5): verify a card for 3 free Applications, one per card; card declined; card already used. **Choose a plan** with the Checkout return states (started, not finished, checking the payment). **Home paused** for "Plan ended" and "Payment didn't go through", each with its fix. **Out of Applications** and the **invited M2 grant running out** (the grant's Applications left and end date). Copy uses the glossary words only and no banned words. Not yet on the canvas: see the PR for the publish status |
| Calendar | **Drawn (#292, `w5-calendar-month`, `w5-calendar-empty`, `w5-calendar-entry`) and built (#294; phone agenda, empty and dark states #295, with the agenda opening on today and the Calendar busy while a month loads).** A month grid with Sent, Stage move, Offer, Closed, Check-in and Interview chips and a day panel on desktop; a compact grid, agenda and day bottom sheet on the phone; the Calendar button sits in the Home and Board headers. The canvas is the reference at 390 and 1280, light and dark. The `w5-calendar-*` boards live on canvas v125 and are not yet exported to `design/reference/source/`; the Home and Board header baselines in `test/e2e/chrome-baselines/` were refreshed from the rendered shell to include the Calendar button. Interview items arrive with #296 (`.ics` parser); the Interview chip styling is in place until then |
| Code paste | **New, drawn with the M2 Inbox boards (#205) and built (#223).** Home's "needs a code" card, shown five minutes into a verification-code wait with the countdown to expiry, and the paste sheet in its four states (waiting, still waiting, window closed, code accepted). Results and the address it points at follow the spec; the canvas is the reference in `design/reference/code-wait/` and `design/reference/code-paste/` at 390 and 1280, light and dark |
| Ready email | **New, drawn and built (ADR 0029, `w5-ready-email`, #196).** One Recap per daily preparation run: the new Ready Applications by employer and job title, how many Reviews are open, one link to the Ready page, no answers and no send button |
| Daily digest | Morning summary of **yesterday** (sends between 08:00 and 20:00); "Needs you", not "Hold" |
| M2 boards | **Built or drawn (ADR 0030), one ticket each on #6:** onboarding What you want and Forwarding & start (drawn as `onbw-4` and `onbw-5`); **Inbox drawn and built (#218, `w5-inbox-*`): threads, message, attachments, "Couldn't verify sender", empty and address explainer; the code-paste prompt drawn and built (#205, #223), see the Code paste row, and the Profile forwarding-address card in #230**; **notifications drawn and built (`d206-notifications`, #221): the in-app list with unread state and Mark all as read, and the header bell**; push copy, the recap and auto-move drawn (`d206-push`, `d206-recap`, `d206-auto-move`), with the pushes, the recap email and the auto-move toast built by #222, #196 and #219; Settings account pages (notifications, **export drawn and built (#224)**, support access log; **Delete account drawn and built (#225) to `design/reference/settings-delete`**); **admin people screens (users, invites, user detail and suspension) drawn and built (#226) to `design/reference/{users,invites,user}`; Mail health drawn (`w5-admin-mail-health`) and built (#229) to `design/reference/mail-health`; Reveal, audit and ATS probe status still to build (#227)**; sign-in invite and password states; **Terms, Privacy and the consent card drawn and built (`d203`, #214), with the Settings legal card** |
| Landing | **Redrawn (#239): boards `lp-1280` and `lp-1280-dark` (1280), `w5-landing-phone` and `lp-390-dark` (390) on the canvas Landing page, reference in `design/reference/landing/`.** Daytime sends (08:00–20:00); card verified for the trial (no "No credit card"); five ATSes, no Workday; no glow on the travelling-dot tiles |
| Pricing | **Drawn (#239): boards `pricing-1280`, `pricing-1280-dark`, `pricing-390`, `pricing-390-dark` on the canvas Pricing page, reference in `design/reference/pricing/`.** Trial (card verified, 3 applications once per card), Week $12 for 70 over 7 days, Month $35 for 300 over 30 days; "Never charged for failure"; Terms and Privacy in the footer |
| Landing 1440 and 1920 (`w5-landing`, `lp-1440-dark`, `lp-1920`, `lp-1920-dark`) | **Still the pre-ADR-0028 wording (Workday, "No credit card"). Not in scope for #239; to be removed from the canvas in the page.** |
| Live Tab (3 boards) | Deleted: users never see a browser |
| Mobile reference | Deleted, already marked to retire |
| Admin billing (#241) | **Drawn on the canvas (`P3aiZsEXkoUKBrknvvBNJJ`, version 140) at 1280 and 390, light and dark, as `bill-users-*` (per-user billing: trial, renewals, expiry, payment-failure pause), `bill-refund-*` (refund with a required reason and audit note), `bill-recon-*` (daily Stripe and Overture records reconciliation with the mismatch alert) and `bill-margin-*` (cost and margin per Application per plan).** Each board carries the admin shell with a Billing item in the sidebar and a chip nav under 1024 px. Sample data only, labelled. Reference captures in `design/reference/billing/{users,refund,reconciliation,margin}`, sources in `design/reference/source/billing/`. The app build is M3 and not started; the copy avoids the banned words, so the reconciliation reads "Overture records", not "ledger" |
| New | Review; **drawn on Home (`w5-home-paused`, #157): check-in, strengthen-profile prompt, queue position, activity and the `Couldn't apply` card.** **Home's Ready card ("2 ready to send · 1 approved", opens Ready) — drawn on Home (`w5-home`, #195).** **Admin people screens drawn (#208) and built (#226) from `design/reference/{users,invites,user}`; Mail health drawn (`w5-admin-mail-health`) and built (#229) to `design/reference/mail-health`; Reveal, audit and ATS probe status still to draw.** The M1 admin (overview, kill switches & settings, catalog health; M1-12) is built from the Settings board's components and this document's tokens, and the people screens are checked by axe and reachability rather than pixels for now; pricing and billing (M3) |
