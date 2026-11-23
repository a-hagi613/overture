export function LandingStepNode({ active, num }: { active: boolean; num: string }) {
  return (
    <span
      className={
        active
          ? "relative z-10 mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-signal font-sans text-sm font-semibold leading-none tabular-nums text-card ring-4 ring-background ring-offset-2 ring-offset-signal transition duration-300 xl:absolute xl:-top-14 xl:left-2.5 xl:mb-0 xl:scale-110"
          : "relative z-10 mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-foreground font-sans text-sm font-semibold leading-none tabular-nums text-background ring-4 ring-background transition duration-300 xl:absolute xl:-top-14 xl:left-2.5 xl:mb-0"
      }
    >
      {num}
    </span>
  );
}
