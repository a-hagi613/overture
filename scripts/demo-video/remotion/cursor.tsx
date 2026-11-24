import { useCurrentFrame } from "remotion";

import type { CursorBeat } from "./chapters.ts";
import { CursorGlyph } from "./cursor-glyph.tsx";
import { clampInterpolate } from "./motion.ts";
import { EMBER } from "./theme.ts";

export function Cursor({
  beat,
  durationInFrames,
  scale,
}: {
  beat: CursorBeat;
  durationInFrames: number;
  scale: number;
}) {
  const frame = useCurrentFrame();
  const appear = durationInFrames * 0.16;
  const clickFrame = durationInFrames * beat.clickAt;
  const x = clampInterpolate(frame, [appear, clickFrame], [beat.from[0], beat.to[0]]);
  const y = clampInterpolate(frame, [appear, clickFrame], [beat.from[1], beat.to[1]]);
  const enter = clampInterpolate(frame, [appear - 2, appear + 6], [0, 1]);
  const exit = clampInterpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0]);
  const opacity = enter * exit;
  const pressed = clampInterpolate(frame, [clickFrame - 3, clickFrame, clickFrame + 4], [0, 1, 0]);
  const rippleScale = clampInterpolate(frame, [clickFrame, clickFrame + 14], [0.5, 1.6]);
  const rippleOpacity = clampInterpolate(frame, [clickFrame, clickFrame + 14], [0.65, 0]) * opacity;

  return (
    <>
      <span
        style={{
          border: `2px solid ${EMBER.signal}`,
          borderRadius: 999,
          height: 34,
          left: `${String(beat.to[0] * 100)}%`,
          marginLeft: -17,
          marginTop: -17,
          opacity: rippleOpacity,
          position: "absolute",
          top: `${String(beat.to[1] * 100)}%`,
          transform: `scale(${String(rippleScale)})`,
          width: 34,
        }}
      />
      <span
        style={{
          left: `${String(x * 100)}%`,
          opacity,
          position: "absolute",
          top: `${String(y * 100)}%`,
        }}
      >
        <CursorGlyph pressed={pressed} scale={scale} />
      </span>
    </>
  );
}
