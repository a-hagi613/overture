import { EMBER } from "./theme.ts";

export function CursorGlyph({ pressed, scale }: { pressed: number; scale: number }) {
  return (
    <svg
      aria-hidden="true"
      height="24"
      style={{ transform: `scale(${(1 - pressed * 0.14) * scale})`, transformOrigin: "2px 2px" }}
      viewBox="0 0 20 24"
      width="20"
    >
      <path
        d="M2 1.5L2 18.2L6.2 14.4L9 20.8L12.1 19.4L9.3 13.1L15.1 12.7L2 1.5Z"
        fill={EMBER.foreground}
        stroke={EMBER.card}
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}
