interface LandingGrainProps {
  variant: "hero" | "closing";
}

export function LandingGrain({ variant }: LandingGrainProps) {
  const isHero = variant === "hero";
  const lightId = isHero ? "ov-l-h-gl" : "ov-l-c-gl";
  const darkId = isHero ? "ov-l-h-gd" : "ov-l-c-gd";
  const seed = isHero ? 7 : 12;

  const lightValues = isHero
    ? "0 0 0 0 0.30  0 0 0 0 0.25  0 0 0 0 0.20  0 0 0 1.3 -0.2"
    : "0 0 0 0 0.36  0 0 0 0 0.27  0 0 0 0 0.18  0 0 0 1.3 -0.2";

  const darkValues = isHero
    ? "0 0 0 0 0.96  0 0 0 0 0.92  0 0 0 0 0.85  0 0 0 1.3 -0.2"
    : "0 0 0 0 0.96  0 0 0 0 0.90  0 0 0 0 0.80  0 0 0 1.3 -0.2";

  return (
    <div
      aria-hidden="true"
      className={
        isHero
          ? "pointer-events-none absolute inset-x-0 -top-28 bottom-0 z-0 opacity-[0.19] [mask-image:linear-gradient(to_bottom,black_78%,transparent)] dark:opacity-[0.125]"
          : "pointer-events-none absolute inset-x-0 top-0 -bottom-56 z-0 opacity-[0.19] [mask-image:linear-gradient(to_top,black_78%,transparent)] dark:opacity-[0.125]"
      }
    >
      <svg aria-hidden="true" className="absolute inset-0 block h-full w-full dark:hidden">
        <filter
          colorInterpolationFilters="sRGB"
          height="100%"
          id={lightId}
          width="100%"
          x="0"
          y="0"
        >
          <feTurbulence
            baseFrequency="0.85"
            numOctaves={3}
            seed={seed}
            stitchTiles="stitch"
            type="fractalNoise"
          />
          <feColorMatrix type="matrix" values={lightValues} />
        </filter>
        <rect filter={`url(#${lightId})`} height="100%" width="100%" />
      </svg>
      <svg aria-hidden="true" className="absolute inset-0 hidden h-full w-full dark:block">
        <filter colorInterpolationFilters="sRGB" height="100%" id={darkId} width="100%" x="0" y="0">
          <feTurbulence
            baseFrequency="0.85"
            numOctaves={3}
            seed={seed}
            stitchTiles="stitch"
            type="fractalNoise"
          />
          <feColorMatrix type="matrix" values={darkValues} />
        </filter>
        <rect filter={`url(#${darkId})`} height="100%" width="100%" />
      </svg>
    </div>
  );
}
