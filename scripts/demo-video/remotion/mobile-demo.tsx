import { Sequence, staticFile, useCurrentFrame } from "remotion";

import { chapterAtFrame, chapterFor, SEGMENTS } from "./chapters.ts";
import { CopyClip } from "./copy-clip.tsx";
import { Lockup } from "./lockup.tsx";
import { PaperBackground } from "./paper-background.tsx";
import { ProgressDots } from "./progress-dots.tsx";
import { SampleDataTag } from "./sample-data-tag.tsx";
import { ScreenClip } from "./screen-clip.tsx";
import { EMBER, SURFACE_SHADOW } from "./theme.ts";

const PHONE = { left: 119, top: 230, width: 482, height: 1017, bezel: 10 } as const;
const SCREEN_WIDTH = PHONE.width - PHONE.bezel * 2 - 2;
const SCREEN_HEIGHT = PHONE.height - PHONE.bezel * 2 - 2;

export function MobileDemo() {
  const frame = useCurrentFrame();
  const active = chapterAtFrame(frame);

  return (
    <PaperBackground>
      <div style={{ left: 40, position: "absolute", top: 38 }}>
        <Lockup />
      </div>
      <div style={{ position: "absolute", right: 40, top: 38 }}>
        <SampleDataTag />
      </div>

      <div style={{ height: 150, left: 40, position: "absolute", top: 108, width: 640 }}>
        {SEGMENTS.map((segment) => (
          <Sequence
            durationInFrames={segment.durationInFrames}
            from={segment.from}
            key={`${segment.chapter}-${String(segment.from)}`}
            layout="none"
          >
            <CopyClip
              chapter={chapterFor(segment.chapter)}
              compact
              segment={segment}
              showBody={false}
              style={{ left: 0, top: 0, width: 640 }}
            />
          </Sequence>
        ))}
      </div>

      <div
        style={{
          backgroundColor: EMBER.foreground,
          borderRadius: 44,
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
            borderRadius: 34,
            height: SCREEN_HEIGHT,
            overflow: "hidden",
            position: "relative",
            width: SCREEN_WIDTH,
          }}
        >
          {SEGMENTS.map((segment) => (
            <Sequence
              durationInFrames={segment.durationInFrames}
              from={segment.from}
              key={`screen-${segment.chapter}-${String(segment.from)}`}
            >
              <ScreenClip
                chapter={chapterFor(segment.chapter)}
                freezeZoom={segment.from === 820}
                segment={segment}
                source={staticFile(`captures/${segment.chapter}-mobile.png`)}
                variant="mobile"
              />
            </Sequence>
          ))}
        </div>
      </div>

      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "center",
          left: 0,
          position: "absolute",
          top: 1262,
          width: 720,
        }}
      >
        <ProgressDots active={active.id} />
      </div>
    </PaperBackground>
  );
}
