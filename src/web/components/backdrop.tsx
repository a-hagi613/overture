const bloomStyle = {
  background: "radial-gradient(closest-side, var(--color-bloom), transparent)",
  height: "700px",
  pointerEvents: "none",
  position: "absolute",
  right: "-240px",
  top: "-260px",
  width: "700px",
  zIndex: 0,
} as const;

export function Backdrop() {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.12] dark:opacity-[0.075]"
      >
        <svg className="grain-light absolute inset-0 h-full w-full" aria-hidden="true">
          <filter
            colorInterpolationFilters="sRGB"
            height="100%"
            id="overture-grain-light"
            width="100%"
            x="0"
            y="0"
          >
            <feTurbulence
              baseFrequency="0.85"
              numOctaves={3}
              seed={7}
              stitchTiles="stitch"
              type="fractalNoise"
            />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.28  0 0 0 0 0.26  0 0 0 0 0.23  0 0 0 1.3 -0.2"
            />
          </filter>
          <rect filter="url(#overture-grain-light)" height="100%" width="100%" />
        </svg>
        <svg className="grain-dark absolute inset-0 h-full w-full" aria-hidden="true">
          <filter
            colorInterpolationFilters="sRGB"
            height="100%"
            id="overture-grain-dark"
            width="100%"
            x="0"
            y="0"
          >
            <feTurbulence
              baseFrequency="0.85"
              numOctaves={3}
              seed={7}
              stitchTiles="stitch"
              type="fractalNoise"
            />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.95  0 0 0 0 0.92  0 0 0 0 0.86  0 0 0 1.3 -0.2"
            />
          </filter>
          <rect filter="url(#overture-grain-dark)" height="100%" width="100%" />
        </svg>
      </div>
      <div aria-hidden="true" style={bloomStyle} />
    </>
  );
}
