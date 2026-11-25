import { Composition } from "remotion";

import { TOTAL_FRAMES } from "./chapters.ts";
import { DesktopDemo } from "./desktop-demo.tsx";
import { MobileDemo } from "./mobile-demo.tsx";
import { DESKTOP_HEIGHT, DESKTOP_WIDTH, FPS, MOBILE_HEIGHT, MOBILE_WIDTH } from "./theme.ts";

export function RemotionRoot() {
  return (
    <>
      <Composition
        component={DesktopDemo}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        height={DESKTOP_HEIGHT}
        id="workspace-desktop"
        width={DESKTOP_WIDTH}
      />
      <Composition
        component={MobileDemo}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        height={MOBILE_HEIGHT}
        id="workspace-mobile"
        width={MOBILE_WIDTH}
      />
    </>
  );
}
