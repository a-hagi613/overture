---
status: accepted
---

# The sign-in dark ground follows the canvas

Issue #74: the redrawn sign-in boards (`design/reference/source/w5-signin.dc.html`, modes sign-in, sign-up,
magic-sent) draw the dark page on their own tokens, a `#12110F` ground, while DESIGN.md's Ember dark puts the page
at `#191714`. The owner ruled (2026-11-20) that the canvas wins for the sign-in surfaces.

- **Scope.** Only the sign-in route (`/signin`, all three modes) in dark mode. Every other screen keeps DESIGN.md's
  Ember dark, and light mode is unchanged everywhere.
- **Mechanism.** A scoped token set, `.dark .signin-surface` in `src/web/styles.css`, takes the canvas's `.ov.dark`
  values (see DESIGN.md, "Sign-in dark ground"). Components read the same `--color-*` tokens as everywhere else, so
  no hex value lives in a component.
- **Source of truth.** The canvas. DESIGN.md records the scoped tokens so the document and the boards agree, and the
  six dark sign-in board-match tests compare against the redrawn PNGs at `maxDiffPixelRatio` 0.01.

## Considered Options

- Change DESIGN.md's Ember dark to `#12110F`: changes every dark screen to fix one surface, and the Ember dark was
  measured across the app's boards.
- Redraw the dark sign-in boards on the Ember dark tokens: the owner chose the canvas, and redrawing the boards
  would also change `design/reference`, which this change leaves alone.
- Leave the boards as they were and keep the tests `fixme`: the boards and DESIGN.md would still disagree.
