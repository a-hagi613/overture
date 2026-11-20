export function Grain() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 opacity-[0.12] dark:opacity-[0.075]"
    >
      <svg className="absolute inset-0 block h-full w-full dark:hidden" height="100%" width="100%">
        <filter
          colorInterpolationFilters="sRGB"
          height="100%"
          id="ovt-grain-light"
          width="100%"
          x="0"
          y="0"
        >
          <feTurbulence
            baseFrequency="0.85"
            numOctaves="3"
            seed="7"
            stitchTiles="stitch"
            type="fractalNoise"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.28  0 0 0 0 0.26  0 0 0 0 0.23  0 0 0 1.3 -0.2"
          />
        </filter>
        <rect filter="url(#ovt-grain-light)" height="100%" width="100%" />
      </svg>
      <svg className="absolute inset-0 hidden h-full w-full dark:block" height="100%" width="100%">
        <filter
          colorInterpolationFilters="sRGB"
          height="100%"
          id="ovt-grain-dark"
          width="100%"
          x="0"
          y="0"
        >
          <feTurbulence
            baseFrequency="0.85"
            numOctaves="3"
            seed="7"
            stitchTiles="stitch"
            type="fractalNoise"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.95  0 0 0 0 0.92  0 0 0 0 0.86  0 0 0 1.3 -0.2"
          />
        </filter>
        <rect filter="url(#ovt-grain-dark)" height="100%" width="100%" />
      </svg>
    </div>
  );
}
