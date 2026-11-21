import { copy } from "../../shared/copy.ts";

export function OnboardingUnlocks({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }

  return <span className="unl">{copy.onboarding.unlocks(count)}</span>;
}
