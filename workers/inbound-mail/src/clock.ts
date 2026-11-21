export function millisecondsNow() {
  return Math.trunc(performance.timeOrigin + performance.now());
}

export function secondsNow() {
  return Math.trunc(millisecondsNow() / 1000);
}
