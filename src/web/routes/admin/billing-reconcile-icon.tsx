const ICON_PATHS = {
  check: "m5 12.5 4.5 4.5L19 7.5",
  info: "M12 8h.01M11 12h1v4h1m9-4a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  warning:
    "M12 9v4m0 4h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z",
} as const;

export function ReconcileIcon({ kind }: { kind: keyof typeof ICON_PATHS }) {
  const path = ICON_PATHS[kind];

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="mt-0.5 h-5 w-5 flex-none"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}
