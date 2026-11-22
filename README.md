# Landing canvas parity screenshots

Live renders of `/` from `a-hagi613/ds-canvas-parity-landing` for issue #437.

- `390/light.png`, `390/dark.png`: live landing at 390 px.
- `1280/light.png`, `1280/dark.png`: live landing at 1280 px.
- `canvas/390-*.png`, `canvas/1280-*.png`: the canvas source frames
  (`w5-landing-phone`, `lp-390-dark`, `lp-1280`, `lp-1280-dark`).
- `canvas/flagship-1440.png`: the `w5-landing` flagship frame at 1440 px, static state.

Every live image is captured by `test/e2e/board-match-landing.test.ts` with animations disabled.
