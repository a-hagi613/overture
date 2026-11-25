import { AbsoluteFill, Img, useCurrentFrame } from "remotion";

import type { Chapter, ChapterView, CursorBeat, Segment } from "./chapters.ts";
import { Cursor } from "./cursor.tsx";
import { cameraZoomCurve, rightPaneMotion } from "./motion.ts";
import { EMBER } from "./theme.ts";

const SIDEBAR_RATIO = 0.2;
const RIGHT_RATIO = 1 - SIDEBAR_RATIO;
const MOBILE_HEADER_RATIO = 0.068;
const MOBILE_TAB_RATIO = 0.076;
const MOBILE_BODY_RATIO = 1 - MOBILE_HEADER_RATIO - MOBILE_TAB_RATIO;

function toDesktopPaneCoord(point: readonly [number, number]) {
  return [
    Math.min(0.98, Math.max(0.02, (point[0] - SIDEBAR_RATIO) / RIGHT_RATIO)),
    Math.min(0.98, Math.max(0.02, point[1])),
  ] as const;
}

function toMobileBodyCoord(point: readonly [number, number]) {
  return [
    Math.min(0.98, Math.max(0.02, point[0])),
    Math.min(0.98, Math.max(0.02, (point[1] - MOBILE_HEADER_RATIO) / MOBILE_BODY_RATIO)),
  ] as const;
}

function mapDesktopBeat(beat: CursorBeat | null) {
  if (beat === null) {
    return null;
  }

  return {
    clickAt: beat.clickAt,
    from: toDesktopPaneCoord(beat.from),
    to: toDesktopPaneCoord(beat.to),
  } satisfies CursorBeat;
}

function mapMobileBeat(beat: CursorBeat | null) {
  if (beat === null) {
    return null;
  }

  return {
    clickAt: beat.clickAt,
    from: toMobileBodyCoord(beat.from),
    to: toMobileBodyCoord(beat.to),
  } satisfies CursorBeat;
}

export function ScreenClip({
  chapter,
  freezeZoom = false,
  segment,
  source,
  variant,
}: {
  chapter: Chapter;
  freezeZoom?: boolean;
  segment: Segment;
  source: string;
  variant: "desktop" | "mobile";
}) {
  const frame = useCurrentFrame();
  const view: ChapterView = variant === "desktop" ? chapter.desktop : chapter.mobile;

  const zoom = cameraZoomCurve(
    frame,
    segment.durationInFrames,
    view.zoomFrom,
    view.zoomTo,
    freezeZoom,
  );

  const { opacity, scale, translateY } = rightPaneMotion(
    segment.fadeIn,
    segment.fadeOut,
    segment.durationInFrames,
    frame,
  );

  if (variant === "mobile") {
    const focus = toMobileBodyCoord(view.focus);
    const beat = mapMobileBeat(view.cursor);

    return (
      <AbsoluteFill style={{ opacity }}>
        <div
          style={{
            height: `${String(MOBILE_BODY_RATIO * 100)}%`,
            left: 0,
            overflow: "hidden",
            position: "absolute",
            right: 0,
            top: `${String(MOBILE_HEADER_RATIO * 100)}%`,
            zIndex: 1,
          }}
        >
          <div
            style={{
              height: "100%",
              transform: `translateY(${String(translateY)}px) scale(${String(scale)})`,
              transformOrigin: "50% 45%",
              width: "100%",
            }}
          >
            <div
              style={{
                height: "100%",
                position: "relative",
                transform: `scale(${String(zoom)})`,
                transformOrigin: `${String(focus[0] * 100)}% ${String(focus[1] * 100)}%`,
                width: "100%",
              }}
            >
              <Img
                src={source}
                style={{
                  display: "block",
                  height: `${(100 / MOBILE_BODY_RATIO).toFixed(4)}%`,
                  left: 0,
                  maxWidth: "none",
                  objectFit: "cover",
                  objectPosition: "top center",
                  position: "absolute",
                  top: `${((-MOBILE_HEADER_RATIO / MOBILE_BODY_RATIO) * 100).toFixed(4)}%`,
                  width: "100%",
                }}
              />
              {beat === null ? null : (
                <Cursor beat={beat} durationInFrames={segment.durationInFrames} scale={1.15} />
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            backgroundColor: EMBER.background,
            height: `${String(MOBILE_HEADER_RATIO * 100)}%`,
            left: 0,
            overflow: "hidden",
            position: "absolute",
            right: 0,
            top: 0,
            zIndex: 2,
          }}
        >
          <Img
            src={source}
            style={{
              display: "block",
              height: `${(100 / MOBILE_HEADER_RATIO).toFixed(4)}%`,
              maxWidth: "none",
              objectFit: "cover",
              objectPosition: "top center",
              width: "100%",
            }}
          />
        </div>

        <div
          style={{
            backgroundColor: EMBER.card,
            bottom: 0,
            height: `${String(MOBILE_TAB_RATIO * 100)}%`,
            left: 0,
            overflow: "hidden",
            position: "absolute",
            right: 0,
            zIndex: 2,
          }}
        >
          <Img
            src={source}
            style={{
              bottom: 0,
              display: "block",
              height: `${(100 / MOBILE_TAB_RATIO).toFixed(4)}%`,
              left: 0,
              maxWidth: "none",
              objectFit: "cover",
              objectPosition: "bottom center",
              position: "absolute",
              width: "100%",
            }}
          />
        </div>
      </AbsoluteFill>
    );
  }

  const focus = toDesktopPaneCoord(view.focus);
  const beat = mapDesktopBeat(view.cursor);

  return (
    <AbsoluteFill style={{ opacity }}>
      <div
        style={{
          backgroundColor: EMBER.background,
          bottom: 0,
          left: `${String(SIDEBAR_RATIO * 100)}%`,
          overflow: "hidden",
          position: "absolute",
          right: 0,
          top: 0,
          zIndex: 1,
        }}
      >
        <div
          style={{
            height: "100%",
            transform: `translateY(${String(translateY)}px) scale(${String(scale)})`,
            transformOrigin: "50% 42%",
            width: "100%",
          }}
        >
          <div
            style={{
              height: "100%",
              transform: `scale(${String(zoom)})`,
              transformOrigin: `${String(focus[0] * 100)}% ${String(focus[1] * 100)}%`,
              width: "100%",
            }}
          >
            <Img
              src={source}
              style={{
                display: "block",
                height: "100%",
                marginLeft: `${String((-SIDEBAR_RATIO / RIGHT_RATIO) * 100)}%`,
                maxWidth: "none",
                objectFit: "cover",
                objectPosition: "left top",
                width: `${String((1 / RIGHT_RATIO) * 100)}%`,
              }}
            />
            {beat === null ? null : (
              <Cursor beat={beat} durationInFrames={segment.durationInFrames} scale={1.05} />
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          backgroundColor: "#ECE6DA",
          borderRight: `1px solid ${EMBER.border}`,
          bottom: 0,
          left: 0,
          overflow: "hidden",
          position: "absolute",
          top: 0,
          width: `${String(SIDEBAR_RATIO * 100)}%`,
          zIndex: 2,
        }}
      >
        <Img
          src={source}
          style={{
            display: "block",
            height: "100%",
            maxWidth: "none",
            objectFit: "cover",
            objectPosition: "left top",
            width: `${String((1 / SIDEBAR_RATIO) * 100)}%`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
}
