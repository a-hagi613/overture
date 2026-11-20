export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 32 32" width={size}>
      <rect fill="var(--color-foreground)" height="32" rx="7" width="32" />
      <circle
        cx="16"
        cy="16"
        r="8.5"
        stroke="var(--color-background)"
        strokeWidth="1.5"
        style={{ fill: "none" }}
      />
      <path
        d="M16 5.5v21"
        stroke="var(--color-signal)"
        strokeLinecap="round"
        strokeWidth="1.5"
        style={{ fill: "none" }}
      />
    </svg>
  );
}
