import { useCurrentFrame } from "remotion";

import { CursorGlyph } from "./cursor-glyph.tsx";
import type { CoordPoint } from "./metrics.ts";
import { clampInterpolate, launchSpring } from "./motion.ts";
import { EMBER } from "./theme.ts";

export function Cursor({
  clickFrame,
  durationInFrames,
  from,
  scale,
  to,
}: {
  clickFrame: number;
  durationInFrames: number;
  from: CoordPoint;
  scale: number;
  to: CoordPoint;
}) {
  const frame = useCurrentFrame();
  const appear = 4;
  const travel = launchSpring(frame, appear, { damping: 14, mass: 0.72, stiffness: 165 });
  const moveProgress = Math.min(1, Math.max(0, travel));
  const arcOffset = Math.sin(moveProgress * Math.PI) * -0.02;

  const x = from[0] + (to[0] - from[0]) * travel;
  const y = from[1] + (to[1] - from[1]) * travel + arcOffset;

  const enter = clampInterpolate(frame, [appear, appear + 6], [0, 1]);
  const exit = clampInterpolate(frame, [durationInFrames - 12, durationInFrames - 2], [1, 0]);
  const opacity = enter * exit;

  const clickBounce = launchSpring(frame, clickFrame, { damping: 10, mass: 0.6, stiffness: 260 });

  const pressed =
    frame < clickFrame - 2
      ? 0
      : clampInterpolate(frame, [clickFrame - 2, clickFrame + 2, clickFrame + 8], [0, 1, 0]);

  const outerRippleScale = 0.4 + clickBounce * 1.45;

  const outerRippleOpacity =
    clampInterpolate(frame, [clickFrame, clickFrame + 18], [0.75, 0]) * opacity;

  const innerRippleScale = 0.35 + clickBounce * 0.9;

  const innerRippleOpacity =
    clampInterpolate(frame, [clickFrame + 2, clickFrame + 14], [0.55, 0]) * opacity;

  return (
    <>
      <span
        style={{
          border: `2px solid ${EMBER.signal}`,
          borderRadius: 999,
          height: 36,
          left: `${String(to[0] * 100)}%`,
          marginLeft: -18,
          marginTop: -18,
          opacity: outerRippleOpacity,
          position: "absolute",
          top: `${String(to[1] * 100)}%`,
          transform: `scale(${String(outerRippleScale)})`,
          width: 36,
        }}
      />
      <span
        style={{
          backgroundColor: EMBER.signalSoft,
          borderRadius: 999,
          height: 24,
          left: `${String(to[0] * 100)}%`,
          marginLeft: -12,
          marginTop: -12,
          opacity: innerRippleOpacity,
          position: "absolute",
          top: `${String(to[1] * 100)}%`,
          transform: `scale(${String(innerRippleScale)})`,
          width: 24,
        }}
      />
      <span
        style={{
          left: `${String(x * 100)}%`,
          opacity,
          position: "absolute",
          top: `${String(y * 100)}%`,
          zIndex: 8,
        }}
      >
        <CursorGlyph pressed={pressed} scale={scale} />
      </span>
    </>
  );
}
