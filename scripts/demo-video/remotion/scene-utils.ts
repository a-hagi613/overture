import type { CoordPoint } from "./metrics.ts";

export type DemoVariant = "desktop" | "mobile";

export const FULL_IMAGE_STYLE = {
  display: "block",
  height: "100%",
  left: 0,
  objectFit: "cover" as const,
  objectPosition: "center top",
  position: "absolute" as const,
  top: 0,
  width: "100%",
};

export function offsetEntry(target: CoordPoint, dx: number, dy: number) {
  return [
    Math.max(0.1, Math.min(0.9, target[0] + dx)),
    Math.min(0.9, target[1] + dy),
  ] satisfies CoordPoint;
}
