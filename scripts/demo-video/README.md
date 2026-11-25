# Landing demo videos

The landing's "Inside the workspace" section shows two silent walkthroughs of the seeded Demo account:

| File | Size | Use |
|---|---|---|
| `public/videos/workspace-demo-desktop.mp4` | 1280×800, 30s | Desktop and tablet (`lg` and up) |
| `public/videos/workspace-demo-desktop-poster.png` | 1280×800 | First paint and reduced motion |
| `public/videos/workspace-demo-mobile.mp4` | 720×1280, 30s | Phone layout (below `lg`) |
| `public/videos/workspace-demo-mobile-poster.png` | 720×1280 | First paint and reduced motion |

Both files are committed. They are H.264 (`yuv420p`, `+faststart`) and stay under 4 MB so the landing keeps its
budget.

## Rebuilding

```sh
bun run scripts/demo-video/capture.ts   # build, seed a temp demo instance, capture the five screens
bun run scripts/demo-video/render.ts    # Remotion render, ffmpeg re-mux, posters
```

`capture.ts` writes `scripts/demo-video/assets/captures/` (gitignored) from the real UI at 2× (desktop) and 3×
(mobile) density. `render.ts` uses those frames as Remotion's public directory, then re-muxes the H.264 output with
ffmpeg for `+faststart` and writes the poster from frame 0.

Remotion needs a Chrome build. By default it downloads its own; set `REMOTION_BROWSER_EXECUTABLE` to reuse one that
is already installed, for example the Playwright headless shell:

```sh
REMOTION_BROWSER_EXECUTABLE="$HOME/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell" \
  bun run scripts/demo-video/render.ts
```

Remotion and `@remotion/cli` are dev dependencies only; the production install (`bun install --production`) does not
ship them.
