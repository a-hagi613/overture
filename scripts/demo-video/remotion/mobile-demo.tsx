import { Sequence, staticFile, useCurrentFrame } from "remotion";

import { ChapterPill } from "./chapter-pill.tsx";
import { activeSegmentAtFrame, chapterFor, SEGMENTS } from "./chapters.ts";
import { launchSpring } from "./motion.ts";
import { PaperBackground } from "./paper-background.tsx";
import { ScreenClip } from "./screen-clip.tsx";
import { EMBER, SURFACE_SHADOW } from "./theme.ts";

const PHONE = { bezel: 11, height: 1084, left: 103, top: 128, width: 514 } as const;
const SCREEN_WIDTH = PHONE.width - PHONE.bezel * 2 - 2;
const SCREEN_HEIGHT = PHONE.height - PHONE.bezel * 2 - 2;

export function MobileDemo() {
  const frame = useCurrentFrame();
  const { chapter, segment } = activeSegmentAtFrame(frame);

  const pillSpring =
    segment.from === 0
      ? 1
      : launchSpring(frame - segment.from, 2, { damping: 12, mass: 0.72, stiffness: 210 });

  return (
    <PaperBackground>
      <div
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 42%, rgba(251, 248, 242, 0.85) 0%, rgba(243, 238, 228, 0) 70%)",
          inset: 0,
          position: "absolute",
        }}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          left: 0,
          position: "absolute",
          top: 38,
          width: 720,
          zIndex: 10,
        }}
      >
        <ChapterPill active={chapter.id} enterSpring={pillSpring} label={chapter.pill} />
      </div>

      <div
        style={{
          backgroundColor: EMBER.foreground,
          borderRadius: 46,
          boxShadow: SURFACE_SHADOW,
          height: PHONE.height,
          left: PHONE.left,
          padding: PHONE.bezel,
          position: "absolute",
          top: PHONE.top,
          width: PHONE.width,
        }}
      >
        <div
          style={{
            backgroundColor: EMBER.background,
            borderRadius: 36,
            height: SCREEN_HEIGHT,
            overflow: "hidden",
            position: "relative",
            width: SCREEN_WIDTH,
          }}
        >
          {SEGMENTS.map((item) => (
            <Sequence
              durationInFrames={item.durationInFrames}
              from={item.from}
              key={`screen-${item.chapter}-${String(item.from)}`}
            >
              <ScreenClip
                chapter={chapterFor(item.chapter)}
                freezeZoom={item.from === 721}
                segment={item}
                source={staticFile(`captures/${item.chapter}-mobile.png`)}
                variant="mobile"
              />
            </Sequence>
          ))}
        </div>
      </div>
    </PaperBackground>
  );
}
