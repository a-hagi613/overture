import { copy } from "../../shared/copy.ts";

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
      <output
        aria-busy="true"
        className="obd block rounded-lg border border-border bg-card shadow-sh"
      >
        <span className="text-[14.5px] text-muted-foreground">{copy.onboarding.loading}</span>
      </output>
    );
  }

  const title =
    state === "error" ? copy.onboarding.loadFailedTitle : copy.onboarding.emptyTargetsTitle;

  const message = state === "error" ? copy.onboarding.loadFailedBody : copy.onboarding.emptyTargets;

  return (
    <section
      aria-labelledby="ob-load-h"
      className="obd rounded-lg border border-border bg-card shadow-sh"
      role={state === "error" ? "alert" : undefined}
    >
      <h2 className="serif" id="ob-load-h" style={{ fontSize: "clamp(24px, 3.5vw, 30px)" }}>
        {title}
      </h2>
      <p className="mt-2 max-w-[52ch] text-[14.5px] text-muted-foreground">{message}</p>
      <button
        aria-disabled={retrying}
        className="btn mt-5"
        onClick={() => {
          if (!retrying) {
            onRetry();
          }
        }}
        style={{ minHeight: 44 }}
        type="button"
      >
        {retrying ? copy.onboarding.retrying : copy.onboarding.retry}
      </button>
    </section>
  );
}
