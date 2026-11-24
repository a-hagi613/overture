import { AbsoluteFill, Img, useCurrentFrame } from "remotion";

import type { Chapter, ChapterView, Segment } from "./chapters.ts";
import { Cursor } from "./cursor.tsx";
import { clampInterpolate, fadeOpacity } from "./motion.ts";

export function ScreenClip({
  chapter,
  freezeZoom = false,
  segment,
  source,
  variant,
}: {
  chapter: Chapter;
  freezeZoom?: boolean;
  segment: Segment;
  source: string;
  variant: "desktop" | "mobile";
}) {
  const frame = useCurrentFrame();
  const view: ChapterView = variant === "desktop" ? chapter.desktop : chapter.mobile;
  const progress = clampInterpolate(frame, [0, Math.max(1, segment.durationInFrames - 1)], [0, 1]);
  const zoom = freezeZoom ? 1 : view.zoomFrom + (view.zoomTo - view.zoomFrom) * progress;
  const opacity = fadeOpacity(segment.fadeIn, segment.fadeOut, segment.durationInFrames, frame);

  return (
    <AbsoluteFill style={{ opacity }}>
      <div
        style={{
          height: "100%",
          overflow: "hidden",
          transform: `scale(${String(zoom)})`,
          transformOrigin: `${String(view.focus[0] * 100)}% ${String(view.focus[1] * 100)}%`,
          width: "100%",
        }}
      >
        <Img
          src={source}
          style={{
            display: "block",
            height: "100%",
            objectFit: "cover",
            objectPosition: "top center",
            width: "100%",
          }}
        />
        {view.cursor === null ? null : (
          <Cursor
            beat={view.cursor}
            durationInFrames={segment.durationInFrames}
            scale={variant === "mobile" ? 1.2 : 1}
          />
        )}
      </div>
    </AbsoluteFill>
  );
}
