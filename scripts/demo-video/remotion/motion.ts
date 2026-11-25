import { interpolate, spring } from "remotion";

import { FPS } from "./theme.ts";

export function clampInterpolate(
  value: number,
  input: readonly number[],
  output: readonly number[],
) {
  return interpolate(value, [...input], [...output], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

export function launchSpring(
  frame: number,
  delay = 0,
  config: { damping?: number; mass?: number; stiffness?: number } = {},
) {
  if (frame < delay) {
    return 0;
  }

  return spring({
    config: {
      damping: config.damping ?? 12,
      mass: config.mass ?? 0.78,
      stiffness: config.stiffness ?? 185,
    },
    fps: FPS,
    frame: frame - delay,
  });
}

export function clipOpacity(
  fadeIn: boolean,
  fadeOut: boolean,
  durationInFrames: number,
  frame: number,
) {
  const enter = fadeIn ? clampInterpolate(frame, [0, 10], [0, 1]) : 1;

  const exit = fadeOut
    ? clampInterpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0])
    : 1;

  return Math.min(enter, exit);
}
