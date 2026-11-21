import { copy } from "../../shared/copy.ts";

export function OnboardingStatus({ answered, label }: { answered: boolean; label?: string }) {
  if (label !== undefined) {
    return <span className="stt no">{label}</span>;
  }

  if (!answered) {
    return <span className="stt no">{copy.onboarding.notAnswered}</span>;
  }

  return (
    <span className="stt ok">
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
      {"\u00A0"}
      {copy.onboarding.answered}
    </span>
  );
}
