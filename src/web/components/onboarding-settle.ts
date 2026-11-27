import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { useSettleOnboarding } from "../lib/onboarding-api.ts";

/**
 * Settles a Stripe return on the Tracker: verifies the card once, prepares the durable picks and leaves the URL
 * clean. A refresh, a double return or a second tab reuses the same picks and Applications, so it never creates a
 * second charge or a second entry.
 */
export function useOnboardingSettle() {
  const [params, setParams] = useSearchParams();
  const settle = useSettleOnboarding();
  const startedFor = useRef<string | null>(null);
  const mutate = useRef(settle.mutate);

  useEffect(() => {
    mutate.current = settle.mutate;
  }, [settle.mutate]);

  const card = params.get("card");
  const session = params.get("session");
  const billing = params.get("billing");

  useEffect(() => {
    if (billing === "success" && card === null) {
      toast.success(copy.onboarding.trial.planActive);
      const next = new URLSearchParams(params);

      next.delete("billing");
      setParams(next, { replace: true });

      return;
    }

    if (card !== "verified") {
      return;
    }

    const key = session ?? "no-session";

    if (startedFor.current === key) {
      return;
    }

    startedFor.current = key;

    const clearParams = () => {
      const next = new URLSearchParams(params);

      next.delete("card");
      next.delete("session");
      setParams(next, { replace: true });
    };

    mutate.current(session, {
      onError: () => {
        startedFor.current = null;
        toast.error(copy.onboarding.trial.settleFailed);
      },
      onSuccess: (result) => {
        if (result.outcome === "pending") {
          toast.info(copy.onboarding.trial.pendingTitle, {
            description: copy.onboarding.trial.pendingBody,
          });

          return;
        }

        if (result.outcome === "already_trialed" || result.outcome === "already_used") {
          toast.error(copy.onboarding.trial.usedBody, {
            action: {
              label: copy.onboarding.trial.choosePlan,
              onClick: () => {
                globalThis.location.assign("/profile/billing");
              },
            },
          });
          clearParams();

          return;
        }

        if (result.outcome === "card_not_verified") {
          toast.error(copy.onboarding.trial.declinedBody, {
            action: {
              label: copy.onboarding.trial.tryAnother,
              onClick: () => {
                globalThis.location.assign("/onboarding/matches");
              },
            },
          });
          clearParams();

          return;
        }

        if (result.outcome === "prepared") {
          toast.success(copy.ready.toast.sendAllDone(result.prepared));
        }

        clearParams();
      },
    });
  }, [billing, card, params, session, setParams]);
}
