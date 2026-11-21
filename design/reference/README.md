# Board reference pack

The canvas boards (artifact `P3aiZsEXkoUKBrknvvBNJJ`, Section A), rendered in a real browser so that code can be built
to match them pixel for pixel without access to the canvas. The orchestrator regenerates this folder whenever a board
changes; never edit it by hand.

## What is here

One folder per screen: `home`, `home-paused` (adds `reasons-1280-light`, all seven pause banners), `ready`, `ready-email`,
`board`, `review`, `profile`, `settings`, `notifications` (adds `empty-<width>-<theme>`), `signin`,
`onboarding-welcome`, `onboarding-resume`, `onboarding-questions`, `onboarding-targets`. Each variant is named
`<width>-<theme>` (Sign in adds the mode: `sign-in`, `sign-up`, `magic-sent`), and comes as three files:

| File | What it is | Use it for |
|---|---|---|
| `<variant>.html` | The fully rendered board as static HTML, every element with its inline styles, no scripts | Open it in a browser and inspect it with devtools, exactly as on the canvas. It renders identically to the canvas (0.0 % pixel difference, checked) |
| `<variant>.json` | Every visible element: DOM path, text, aria label, box (`x`, `y`, `w`, `h` in CSS px at that width) and computed styles (type, colour, spacing, borders, radius, shadow, layout), plus the CSS custom properties in use | Exact values to build from, and to assert in tests |
| `<variant>.png` | Full-page screenshot at device scale 1 | The baseline the "matches the board" end-to-end check compares the app against |

`source/` holds the board sources (`w5-*.dc.html`; `w5-holds` is the Review screen, `w5-ready-email` the Recap email)
and the design-system boards
(`ds-2`, `ds-3`), for reading the intent behind a value.

## Rules for building a screen

- Build from the `.json` values and the `.html` structure, translated into the app's tokens (CSS variables) and copy
  module. Never hard-code a hex from here into a component; map it to its token.
- Seed the app's test data with the sample data the board shows (names, companies, counts, times), so the app and the
  board render the same content.
- Each screen gets an end-to-end check that screenshots the app at the board's width and theme and compares it with
  `<variant>.png`. CI fails when the share of differing pixels is over the threshold set in that check, and the diff
  image is kept as a CI artifact.
