import { Img, staticFile } from "remotion";

import type { DemoVariant } from "./scene-utils.ts";
import { FULL_IMAGE_STYLE } from "./scene-utils.ts";

export function HomeScene({ variant }: { variant: DemoVariant }) {
  return <Img src={staticFile(`captures/home-${variant}.png`)} style={FULL_IMAGE_STYLE} />;
}
