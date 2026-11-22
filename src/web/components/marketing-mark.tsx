export function MarketingMark({ size = 32 }: { size?: number }) {
  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 32 32" width={size}>
      <rect className="landing-mark-ground" height="32" rx="7" width="32" />
      <circle className="landing-mark-ring" cx="16" cy="16" fill="none" r="8.5" strokeWidth="1.5" />
      <path className="landing-mark-tick" d="M16 5.5v21" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}
