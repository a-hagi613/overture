export function Bloom() {
  return (
    <div
      aria-hidden="true"
      className="-right-[240px] -top-[260px] pointer-events-none absolute z-0 h-[700px] w-[700px] rounded-full"
      style={{
        background: "radial-gradient(closest-side, var(--color-bloom), transparent)",
      }}
    />
  );
}
