import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";

import { DragCursor } from "./drag-cursor.tsx";
import type { SizeMetrics } from "./metrics.ts";
import { clampInterpolate, launchSpring } from "./motion.ts";
import type { DemoVariant } from "./scene-utils.ts";
import { FULL_IMAGE_STYLE, offsetEntry } from "./scene-utils.ts";

export function TrackerScene({
  durationInFrames,
  metrics,
  variant,
}: {
  durationInFrames: number;
  metrics: SizeMetrics;
  variant: DemoVariant;
}) {
  const frame = useCurrentFrame();
  const { cardStart, dropTarget, overlaySize } = metrics;
  const cursorScale = variant === "mobile" ? 1.15 : 1.05;

  const entryPoint = offsetEntry(cardStart, -0.1, 0.14);

  const hoverProgress = Math.min(
    1,
    Math.max(0, launchSpring(frame, 4, { damping: 14, mass: 0.72, stiffness: 165 })),
  );

  const dragLift = Math.min(
    1,
    Math.max(0, launchSpring(frame, 28, { damping: 14, mass: 0.68, stiffness: 200 })),
  );

  const dragProgress = Math.min(
    1,
    Math.max(0, launchSpring(frame, 38, { damping: 16, mass: 0.9, stiffness: 118 })),
  );

  const settleDown = Math.min(
    1,
    Math.max(0, launchSpring(frame, 96, { damping: 15, mass: 0.7, stiffness: 220 })),
  );

  const isDragging = frame >= 28 && frame < 104;
  const isOver = dragProgress >= 0.52;
  const isDropped = frame >= 104;

  const arcY = Math.sin(Math.min(1, Math.max(0, dragProgress)) * Math.PI) * -0.045;

  let cursorX: number;
  let cursorY: number;

  if (frame < 28) {
    cursorX = entryPoint[0] + (cardStart[0] - entryPoint[0]) * hoverProgress;
    cursorY = entryPoint[1] + (cardStart[1] - entryPoint[1]) * hoverProgress;
  } else {
    cursorX = cardStart[0] + (dropTarget[0] - cardStart[0]) * dragProgress;
    cursorY = cardStart[1] + (dropTarget[1] - cardStart[1]) * dragProgress + arcY;
  }

  const cardX = cardStart[0] + (dropTarget[0] - cardStart[0]) * dragProgress;
  const cardY = cardStart[1] + (dropTarget[1] - cardStart[1]) * dragProgress + arcY;

  const cardLiftFactor = Math.max(0, dragLift * (1 - settleDown));
  const overlayScale = 1 + 0.035 * cardLiftFactor;
  const overlayTilt = -1.4 * cardLiftFactor;

  const cursorEnter = clampInterpolate(frame, [4, 10], [0, 1]);
  const cursorExit = clampInterpolate(frame, [118, 134], [1, 0]);
  const cursorOpacity = cursorEnter * cursorExit;
  const cursorPressed = isDragging && frame < 96 ? 1 : 0;

  let backdropSrc = staticFile(`captures/tracker-before-${variant}.png`);

  if (isDropped) {
    backdropSrc = staticFile(`captures/tracker-after-${variant}.png`);
  } else if (isDragging) {
    backdropSrc = isOver
      ? staticFile(`captures/tracker-over-${variant}.png`)
      : staticFile(`captures/tracker-drag-backdrop-${variant}.png`);
  }

  const afterFadeOpacity =
    frame >= 104 && frame < 110 ? clampInterpolate(frame, [104, 110], [0, 1]) : 1;

  return (
    <AbsoluteFill>
      {frame >= 104 && frame < 110 ? (
        <Img src={staticFile(`captures/tracker-over-${variant}.png`)} style={FULL_IMAGE_STYLE} />
      ) : null}

      <Img src={backdropSrc} style={{ ...FULL_IMAGE_STYLE, opacity: afterFadeOpacity }} />

      {isDragging ? (
        <div
          style={{
            borderRadius: variant === "mobile" ? 999 : 8,
            boxShadow: `0 18px 36px -12px rgba(21, 19, 17, ${(0.32 * cardLiftFactor).toFixed(2)})`,
            height: `${String(overlaySize[1] * 100)}%`,
            left: `${String(cardX * 100)}%`,
            pointerEvents: "none",
            position: "absolute",
            top: `${String(cardY * 100)}%`,
            transform: `translate(-50%, -50%) scale(${String(overlayScale)}) rotate(${String(overlayTilt)}deg)`,
            width: `${String(overlaySize[0] * 100)}%`,
            zIndex: 5,
          }}
        >
          <Img
            src={staticFile(`captures/tracker-overlay-${variant}.png`)}
            style={{
              display: "block",
              height: "100%",
              objectFit: "contain",
              width: "100%",
            }}
          />
        </div>
      ) : null}

      {frame < durationInFrames - 20 ? (
        <DragCursor
          opacity={cursorOpacity}
          pressed={cursorPressed}
          scale={cursorScale}
          x={cursorX}
          y={cursorY}
        />
      ) : null}
    </AbsoluteFill>
  );
}
