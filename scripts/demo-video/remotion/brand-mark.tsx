import { EMBER } from "./theme.ts";

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 32 32" width={size}>
      <rect fill={EMBER.foreground} height="32" rx="7" width="32" />
      <circle cx="16" cy="16" fill="none" r="8.5" stroke={EMBER.card} strokeWidth="1.5" />
      <path d="M16 5.5V26.5" stroke={EMBER.signal} strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}
