import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";

import { Cursor } from "./cursor.tsx";
import type { SizeMetrics } from "./metrics.ts";
import { clampInterpolate } from "./motion.ts";
import type { DemoVariant } from "./scene-utils.ts";
import { FULL_IMAGE_STYLE, offsetEntry } from "./scene-utils.ts";

export function InboxScene({
  durationInFrames,
  metrics,
  variant,
}: {
  durationInFrames: number;
  metrics: SizeMetrics;
  variant: DemoVariant;
}) {
  const frame = useCurrentFrame();
  const { inboxRow } = metrics;
  const entryPoint = offsetEntry(inboxRow, 0.14, 0.14);
  const cursorScale = variant === "mobile" ? 1.15 : 1.05;
  const isOpened = frame >= 48;
  const openOpacity = frame >= 48 && frame < 56 ? clampInterpolate(frame, [48, 56], [0, 1]) : 1;

  return (
    <AbsoluteFill>
      {frame >= 48 && frame < 56 ? (
        <Img src={staticFile(`captures/inbox-before-${variant}.png`)} style={FULL_IMAGE_STYLE} />
      ) : null}

      <Img
        src={staticFile(`captures/${isOpened ? "inbox-after" : "inbox-before"}-${variant}.png`)}
        style={{ ...FULL_IMAGE_STYLE, opacity: openOpacity }}
      />

      {frame < 64 ? (
        <Cursor
          clickFrame={36}
          durationInFrames={Math.min(durationInFrames, 64)}
          from={entryPoint}
          scale={cursorScale}
          to={inboxRow}
        />
      ) : null}
    </AbsoluteFill>
  );
}
