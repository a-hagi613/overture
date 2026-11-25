import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";

import { Cursor } from "./cursor.tsx";
import type { SizeMetrics } from "./metrics.ts";
import { clampInterpolate } from "./motion.ts";
import type { DemoVariant } from "./scene-utils.ts";
import { FULL_IMAGE_STYLE, offsetEntry } from "./scene-utils.ts";
import { EMBER } from "./theme.ts";

export function ResumeScene({
  durationInFrames,
  metrics,
  variant,
}: {
  durationInFrames: number;
  metrics: SizeMetrics;
  variant: DemoVariant;
}) {
  const frame = useCurrentFrame();
  const { scanBox, uploadButton } = metrics;
  const entryPoint = offsetEntry(uploadButton, 0.14, 0.1);
  const cursorScale = variant === "mobile" ? 1.15 : 1.05;

  const isScanning = frame >= 46 && frame < 126;
  const isDone = frame >= 126;

  let scanStep = 0;

  if (frame >= 106) {
    scanStep = 3;
  } else if (frame >= 86) {
    scanStep = 2;
  } else if (frame >= 66) {
    scanStep = 1;
  }

  let baseSrc = staticFile(`captures/resume-empty-${variant}.png`);

  if (isDone) {
    baseSrc = staticFile(`captures/resume-done-${variant}.png`);
  } else if (isScanning) {
    baseSrc = staticFile(`captures/resume-scan-${String(scanStep)}-${variant}.png`);
  }

  const scanProgress = isScanning ? ((frame - 46) % 40) / 40 : 0;
  const doneOpacity = frame >= 126 && frame < 134 ? clampInterpolate(frame, [126, 134], [0, 1]) : 1;

  return (
    <AbsoluteFill>
      {frame >= 126 && frame < 134 ? (
        <Img src={staticFile(`captures/resume-scan-3-${variant}.png`)} style={FULL_IMAGE_STYLE} />
      ) : null}

      <Img src={baseSrc} style={{ ...FULL_IMAGE_STYLE, opacity: doneOpacity }} />

      {isScanning ? (
        <div
          style={{
            borderRadius: 8,
            height: `${String(scanBox.height * 100)}%`,
            left: `${String(scanBox.x * 100)}%`,
            overflow: "hidden",
            pointerEvents: "none",
            position: "absolute",
            top: `${String(scanBox.y * 100)}%`,
            width: `${String(scanBox.width * 100)}%`,
            zIndex: 4,
          }}
        >
          <div
            style={{
              height: "100%",
              position: "relative",
              transform: `translateY(${(scanProgress * 125 - 20).toFixed(2)}%)`,
              width: "100%",
            }}
          >
            <div style={{ backgroundColor: EMBER.signal, height: 2, width: "100%" }} />
            <div
              style={{
                backgroundImage: `linear-gradient(to bottom, ${EMBER.signalSoft}, rgba(210, 86, 31, 0))`,
                height: 44,
                width: "100%",
              }}
            />
          </div>
        </div>
      ) : null}

      {frame < 56 ? (
        <Cursor
          clickFrame={34}
          durationInFrames={Math.min(durationInFrames, 56)}
          from={entryPoint}
          scale={cursorScale}
          to={uploadButton}
        />
      ) : null}
    </AbsoluteFill>
  );
}
