import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

type LoadState = "empty" | "error" | "loading";

export function OnboardingLoadState({
  onRetry,
  retrying = false,
  state,
}: {
  onRetry: () => void;
  retrying?: boolean;
  state: LoadState;
}) {
  if (state === "loading") {
    return (
      <Card className="p-6 md:p-7">
        <output aria-busy="true" className="block text-sm text-muted-foreground">
          {copy.onboarding.loading}
        </output>
      </Card>
    );
  }

  const title =
    state === "error" ? copy.onboarding.loadFailedTitle : copy.onboarding.emptyTargetsTitle;

  const message = state === "error" ? copy.onboarding.loadFailedBody : copy.onboarding.emptyTargets;

  return (
    <Card ariaLabelledBy="ob-load-h" className="p-6 md:p-7">
      <div role={state === "error" ? "alert" : undefined}>
        <h2 className={dsCardTitle} id="ob-load-h">
          {title}
        </h2>
        <p className={`${dsBody} mt-2 max-w-lg`}>{message}</p>
        <Button
          className="mt-5"
          disabled={retrying}
          onClick={() => {
            if (!retrying) {
              onRetry();
            }
          }}
          size="default"
          variant="primary"
        >
          {retrying ? copy.onboarding.retrying : copy.onboarding.retry}
        </Button>
      </div>
    </Card>
  );
}
