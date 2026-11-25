import { Navigate, useSearchParams } from "react-router";

export function OnboardingTrialPage() {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);

  next.set("trial", "1");

  return <Navigate replace to={`/onboarding/matches?${next.toString()}`} />;
}
