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

export function cameraZoomCurve(
  frame: number,
  durationInFrames: number,
  zoomFrom: number,
  zoomTo: number,
  freezeZoom: boolean,
) {
  if (freezeZoom || (zoomFrom === 1 && zoomTo === 1)) {
    return 1;
  }

  const zoomInStart = Math.round(durationInFrames * 0.16);
  const zoomOutStart = Math.round(durationInFrames * 0.72);

  const enter =
    frame < zoomInStart
      ? 0
      : spring({
          config: { damping: 14, mass: 0.88, stiffness: 145 },
          fps: FPS,
          frame: frame - zoomInStart,
        });

  const settleOut =
    frame < zoomOutStart
      ? 0
      : spring({
          config: { damping: 16, mass: 0.9, stiffness: 155 },
          fps: FPS,
          frame: frame - zoomOutStart,
        });

  return zoomFrom + (zoomTo - zoomFrom) * Math.max(0, enter - settleOut);
}

export function rightPaneMotion(
  fadeIn: boolean,
  fadeOut: boolean,
  durationInFrames: number,
  frame: number,
) {
  const enterOpacity = fadeIn ? clampInterpolate(frame, [0, 10], [0, 1]) : 1;

  const exitOpacity = fadeOut
    ? clampInterpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0])
    : 1;

  const enterSpring = fadeIn
    ? launchSpring(frame, 0, { damping: 13, mass: 0.8, stiffness: 195 })
    : 1;

  const exitScale = fadeOut
    ? clampInterpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0.988])
    : 1;

  const translateY = fadeIn ? (1 - enterSpring) * 18 : 0;
  const scale = (fadeIn ? 0.97 + 0.03 * enterSpring : 1) * exitScale;

  return {
    opacity: Math.min(enterOpacity, exitOpacity),
    scale,
    translateY,
  };
}
