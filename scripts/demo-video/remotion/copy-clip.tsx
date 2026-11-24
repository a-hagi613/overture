import { useCurrentFrame } from "remotion";
import type { CSSProperties } from "react";

import { ChapterCopy } from "./chapter-copy.tsx";
import type { Chapter, Segment } from "./chapters.ts";
import { fadeOpacity } from "./motion.ts";

export function CopyClip({
  chapter,
  compact,
  segment,
  showBody = true,
  style,
}: {
  chapter: Chapter;
  compact: boolean;
  segment: Segment;
  showBody?: boolean;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const opacity = fadeOpacity(segment.fadeIn, segment.fadeOut, segment.durationInFrames, frame);

  return (
    <div style={{ opacity, position: "absolute", ...style }}>
      <ChapterCopy chapter={chapter} compact={compact} showBody={showBody} />
    </div>
  );
}
