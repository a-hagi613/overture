import { AbsoluteFill, useCurrentFrame } from "remotion";

import type { Segment } from "./chapters.ts";
import { HomeScene } from "./home-scene.tsx";
import { InboxScene } from "./inbox-scene.tsx";
import type { SizeMetrics } from "./metrics.ts";
import { clipOpacity } from "./motion.ts";
import { ResumeScene } from "./resume-scene.tsx";
import type { DemoVariant } from "./scene-utils.ts";
import { TrackerScene } from "./tracker-scene.tsx";

export function ScreenClip({
  metrics,
  segment,
  variant,
}: {
  metrics: SizeMetrics;
  segment: Segment;
  variant: DemoVariant;
}) {
  const frame = useCurrentFrame();
  const opacity = clipOpacity(segment.fadeIn, segment.fadeOut, segment.durationInFrames, frame);

  return (
    <AbsoluteFill style={{ opacity }}>
      {segment.chapter === "home" ? <HomeScene variant={variant} /> : null}
      {segment.chapter === "tracker" ? (
        <TrackerScene
          durationInFrames={segment.durationInFrames}
          metrics={metrics}
          variant={variant}
        />
      ) : null}
      {segment.chapter === "resume" ? (
        <ResumeScene
          durationInFrames={segment.durationInFrames}
          metrics={metrics}
          variant={variant}
        />
      ) : null}
      {segment.chapter === "inbox" ? (
        <InboxScene
          durationInFrames={segment.durationInFrames}
          metrics={metrics}
          variant={variant}
        />
      ) : null}
    </AbsoluteFill>
  );
}
