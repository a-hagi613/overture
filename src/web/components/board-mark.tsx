export function BoardMark({ kind }: { kind: "check" | "cross" }) {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full border border-foreground"
    >
      <svg
        fill="none"
        height="11"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={kind === "check" ? 2.8 : 3}
        viewBox="0 0 24 24"
        width="11"
      >
        <path d={kind === "check" ? "M5 12.5l4.5 4.5L19 7.5" : "M6 6l12 12M18 6L6 18"} />
      </svg>
    </span>
  );
}
