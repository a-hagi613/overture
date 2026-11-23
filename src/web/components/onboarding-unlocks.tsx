import { copy } from "../../shared/copy.ts";
import { Badge } from "./ui/badge.tsx";

export function OnboardingUnlocks({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }

  return <Badge variant="secondary">{copy.onboarding.unlocks(count)}</Badge>;
}
