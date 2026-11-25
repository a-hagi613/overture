# Landing demo videos

The landing's "Inside the workspace" section shows two silent walkthroughs of the seeded Demo account:

| File | Size | Use |
|---|---|---|
| `public/videos/workspace-demo-desktop.mp4` | 1280×800, 20s | Desktop and tablet (`lg` and up) |
| `public/videos/workspace-demo-desktop-poster.png` | 1280×800 | First paint and reduced motion |
| `public/videos/workspace-demo-mobile.mp4` | 720×1280, 20s | Phone layout (below `lg`) |
| `public/videos/workspace-demo-mobile-poster.png` | 720×1280 | First paint and reduced motion |

Both videos start at frame 0 on **Home (90D chart)** and walk through four full-frame, zero-zoom scenes:
1. Home (90-day momentum dashboard)
2. Tracker (dragging a card from Applied to Interviews)
3. Resume (uploading and scanning a PDF resume)
4. Inbox (opening an employer offer thread)

Both MP4s are committed as H.264 (`yuv420p`, `+faststart`) under 4 MB so the landing keeps its budget.

## Rebuilding

```sh
bun run scripts/demo-video/capture.ts   # build, seed throwaway demo instances, capture real interactions + metrics
bun run scripts/demo-video/render.ts    # Remotion render, ffmpeg re-mux, posters
```

`capture.ts` writes `scripts/demo-video/assets/captures/` (gitignored) from the real UI at 2× (desktop) and 3×
(mobile) density along with normalized `metrics.json`. `render.ts` uses those captures as Remotion's public
directory, then re-muxes the H.264 output with ffmpeg for `+faststart` and writes the frame-0 posters.

Set `REMOTION_BROWSER_EXECUTABLE` to reuse an installed Chromium headless shell:

```sh
REMOTION_BROWSER_EXECUTABLE="$HOME/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell" \
  bun run scripts/demo-video/render.ts
```

Remotion and `@remotion/cli` are dev dependencies only; the production install (`bun install --production`) does not
ship them.
