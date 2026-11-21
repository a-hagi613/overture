export function OnboardingStepDot({
  position,
  state,
}: {
  position: number;
  state: "done" | "on" | "next";
}) {
  if (state === "done") {
    return (
      <span className="dot2" style={{ borderColor: "var(--ink)", color: "var(--ink)" }}>
        <svg
          aria-hidden="true"
          fill="none"
          height={14}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2.2}
          viewBox="0 0 24 24"
          width={14}
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    );
  }

  return <span className="dot2">{position}</span>;
}
