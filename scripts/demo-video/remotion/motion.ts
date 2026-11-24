import { Easing, interpolate } from "remotion";

export const EASE = Easing.bezier(0.2, 0.7, 0.2, 1);
const CLAMP = { easing: EASE, extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export function clampInterpolate(
  value: number,
  input: readonly number[],
  output: readonly number[],
) {
  return interpolate(value, [...input], [...output], CLAMP);
}

export function fadeOpacity(
  fadeIn: boolean,
  fadeOut: boolean,
  durationInFrames: number,
  frame: number,
) {
  const fade = 20;
  const enter = fadeIn ? clampInterpolate(frame, [0, fade], [0, 1]) : 1;

  const exit = fadeOut
    ? clampInterpolate(frame, [durationInFrames - fade, durationInFrames], [1, 0])
    : 1;

  return Math.min(enter, exit);
}
