# Sign-in canvas parity screenshots (#438)

Every PNG the pull request embeds, captured on this branch.

- `live/<width>/<theme>/<state>.png` — the running app at `/signin`, full page at device scale 1, with the
  browser viewport height set to the matching canvas frame so nothing is stamped mid-page.
- `canvas/<width>/<theme>/<state>.png` — the canvas board renders the reference pack ships
  (`design/reference/signin/`), produced from the source boards `w5-signin`, `w5-signin-magic-sent`,
  `w5-signin-refused` and `w5-suspended` (`design/reference/source/`).

States: `sign-in` (default), `magic-sent`, `refused` (email outside the invite list) and `suspended`.
Themes: light and dark (the dark ground follows ADR 0027). Widths: 390 and 1280.

Passwordless auth (ADR 0035) means there is no password, sign-up, forgot-password, reset-password or
verify-sent state: those boards are excluded on purpose.
