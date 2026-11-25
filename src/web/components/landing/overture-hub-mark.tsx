export function OvertureHubMark() {
  return (
    <span className="block h-full w-full overflow-hidden rounded-2xl">
      <svg aria-hidden="true" className="h-full w-full" viewBox="0 0 32 32">
        <rect className="fill-foreground" height="32" width="32" />
        <circle
          className="stroke-primary-ink"
          cx="16"
          cy="16"
          fill="none"
          r="8.5"
          strokeWidth="1.5"
        />
        <path className="stroke-signal" d="M16 5.5v21" strokeLinecap="round" strokeWidth="1.6" />
      </svg>
    </span>
  );
}
