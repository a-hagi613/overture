import { Sequence, staticFile, useCurrentFrame } from "remotion";

import { BrowserChrome } from "./browser-chrome.tsx";
import { chapterAtFrame, chapterFor, SEGMENTS } from "./chapters.ts";
import { CopyClip } from "./copy-clip.tsx";
import { Lockup } from "./lockup.tsx";
import { PaperBackground } from "./paper-background.tsx";
import { ProgressDots } from "./progress-dots.tsx";
import { ScreenClip } from "./screen-clip.tsx";
import { EMBER, SURFACE_SHADOW } from "./theme.ts";

const WINDOW = { left: 328, top: 56, width: 920, height: 683, chrome: 36 } as const;
const SCREEN_HEIGHT = WINDOW.height - WINDOW.chrome;
const RAIL_WIDTH = 240;

export function DesktopDemo() {
  const frame = useCurrentFrame();
  const active = chapterAtFrame(frame);

  return (
    <PaperBackground>
      <div style={{ left: 56, position: "absolute", top: 56 }}>
        <Lockup />
      </div>

      <div style={{ height: 360, left: 56, position: "absolute", top: 198, width: RAIL_WIDTH }}>
        {SEGMENTS.map((segment) => (
          <Sequence
            durationInFrames={segment.durationInFrames}
            from={segment.from}
            key={`${segment.chapter}-${String(segment.from)}`}
            layout="none"
          >
            <CopyClip
              chapter={chapterFor(segment.chapter)}
              compact={false}
              segment={segment}
              style={{ left: 0, top: 0, width: RAIL_WIDTH }}
            />
          </Sequence>
        ))}
      </div>

      <div style={{ left: 56, position: "absolute", top: 700 }}>
        <ProgressDots active={active.id} />
      </div>

      <div
        style={{
          backgroundColor: EMBER.card,
          border: `1px solid ${EMBER.border}`,
          borderRadius: 14,
          boxShadow: SURFACE_SHADOW,
          height: WINDOW.height,
          left: WINDOW.left,
          overflow: "hidden",
          position: "absolute",
          top: WINDOW.top,
          width: WINDOW.width,
        }}
      >
        <BrowserChrome url={active.url} />
        <div
          style={{
            backgroundColor: EMBER.background,
            height: SCREEN_HEIGHT,
            overflow: "hidden",
            position: "relative",
            width: "100%",
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
                source={staticFile(`captures/${segment.chapter}-desktop.png`)}
                variant="desktop"
              />
            </Sequence>
          ))}
        </div>
      </div>
    </PaperBackground>
  );
}
