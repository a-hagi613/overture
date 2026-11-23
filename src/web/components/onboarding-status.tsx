import { Check } from "lucide-react";

import { copy } from "../../shared/copy.ts";

export function OnboardingStatus({ answered, label }: { answered: boolean; label?: string }) {
  if (label !== undefined) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs font-medium ${
          answered ? "text-ok" : "text-muted-foreground"
        }`}
      >
        {answered ? <Check aria-hidden="true" size={13} /> : null}
        <span>{label}</span>
      </span>
    );
  }

  if (!answered) {
    return <span className="text-xs text-muted-foreground">{copy.onboarding.notAnswered}</span>;
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-ok">
      <Check aria-hidden="true" size={13} />
      <span>{copy.onboarding.answered}</span>
    </span>
  );
}
