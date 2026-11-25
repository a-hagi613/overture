import { Img, Sequence, staticFile, useCurrentFrame } from "remotion";

import { ChapterPill } from "./chapter-pill.tsx";
import { activeSegmentAtFrame, SEGMENTS } from "./chapters.ts";
import { useCaptureMetrics } from "./metrics.ts";
import { launchSpring } from "./motion.ts";
import { PaperBackground } from "./paper-background.tsx";
import { ScreenClip } from "./screen-clip.tsx";
import { EMBER, SURFACE_SHADOW } from "./theme.ts";

const FRAME_BOX = { height: 760, left: 32, top: 20, width: 1216 } as const;

export function DesktopDemo() {
  const frame = useCurrentFrame();
  const { chapter, segment } = activeSegmentAtFrame(frame);
  const metrics = useCaptureMetrics();

  const pillSpring =
    segment.from === 0
      ? 1
      : launchSpring(frame - segment.from, 2, { damping: 12, mass: 0.72, stiffness: 210 });

  return (
    <PaperBackground>
      <div
        style={{
          backgroundImage:
            "radial-gradient(circle at 54% 38%, rgba(251, 248, 242, 0.85) 0%, rgba(243, 238, 228, 0) 70%)",
          inset: 0,
          position: "absolute",
        }}
      />

      <div
        style={{
          backgroundColor: EMBER.background,
          border: `1px solid ${EMBER.border}`,
          borderRadius: 16,
          boxShadow: SURFACE_SHADOW,
          height: FRAME_BOX.height,
          left: FRAME_BOX.left,
          overflow: "hidden",
          position: "absolute",
          top: FRAME_BOX.top,
          width: FRAME_BOX.width,
        }}
      >
        <Img
          src={staticFile("captures/home-desktop.png")}
          style={{
            display: "block",
            height: "100%",
            inset: 0,
            objectFit: "cover",
            objectPosition: "center top",
            position: "absolute",
            width: "100%",
          }}
        />

        {SEGMENTS.map((item) => (
          <Sequence
            durationInFrames={item.durationInFrames}
            from={item.from}
            key={`screen-${item.chapter}-${String(item.from)}`}
          >
            <ScreenClip metrics={metrics.desktop} segment={item} variant="desktop" />
          </Sequence>
        ))}

        <div
          style={{
            bottom: 16,
            left: "60%",
            position: "absolute",
            transform: "translateX(-50%)",
            zIndex: 10,
          }}
        >
          <ChapterPill active={chapter.id} enterSpring={pillSpring} label={chapter.pill} />
        </div>
      </div>
    </PaperBackground>
  );
}
