import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { useSettleOnboarding } from "../lib/onboarding-api.ts";

const PAID_RETURN_ATTEMPTS = 6;
const PAID_RETURN_DELAY_MS = 1500;

async function sleep(ms: number) {
  await new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

/**
 * Settles a Stripe return on the Tracker: verifies the card once, prepares the durable picks and leaves the URL
 * clean. A refresh, a double return or a second tab reuses the same picks and Applications, so it never creates a
 * second charge or a second entry. A paid Checkout return waits for the webhook to credit the plan, then prepares
 * the same picks.
 */
export function useOnboardingSettle() {
  const [params, setParams] = useSearchParams();
  const settle = useSettleOnboarding();
  const startedFor = useRef<string | null>(null);
  const mutate = useRef(settle.mutateAsync);

  useEffect(() => {
    mutate.current = settle.mutateAsync;
  }, [settle.mutateAsync]);

  const card = params.get("card");
  const session = params.get("session");
  const billing = params.get("billing");
  const planParam = params.get("plan");
  const paidPlan = planParam === "week" || planParam === "month";
  const { plan } = copy.onboarding;

  useEffect(() => {
    if (billing === "success" && card === null && !paidPlan) {
      toast.success(copy.onboarding.trial.planActive);

      const next = new URLSearchParams(params);

      next.delete("billing");
      next.delete("plan");
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

    async function settleTrial() {
      try {
        const result = await mutate.current(session);

        if (result.outcome === "pending") {
          toast.info(copy.onboarding.trial.pendingTitle, {
            description: copy.onboarding.trial.pendingBody,
          });

          return;
        }

        if (result.outcome === "already_trialed" || result.outcome === "already_used") {
          toast.error(copy.onboarding.trial.usedBody, {
            action: {
              label: plan.trialUsedAction,
              onClick: () => {
                globalThis.location.assign("/onboarding/matches?plan=trial_used");
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
          toast.success(plan.returnTrial);
        }

        clearParams();
      } catch {
        startedFor.current = null;
        toast.error(copy.onboarding.trial.settleFailed);
      }
    }

    void settleTrial();
  }, [billing, card, params, paidPlan, plan, session, setParams]);

  useEffect(() => {
    if (billing !== "success" || card !== null || !paidPlan) {
      return;
    }

    if (startedFor.current === "paid-return") {
      return;
    }

    startedFor.current = "paid-return";

    const clearParams = () => {
      const next = new URLSearchParams(params);

      next.delete("billing");
      next.delete("plan");
      setParams(next, { replace: true });
    };

    const message = planParam === "week" ? plan.returnWeek : plan.returnMonth;

    async function attempt(remaining: number) {
      if (remaining <= 0) {
        return "pending";
      }

      try {
        const result = await mutate.current(null);

        if (result.outcome === "prepared" || result.outcome === "no_picks") {
          toast.success(message);
          clearParams();

          return "done";
        }

        if (result.outcome !== "pending") {
          toast.error(copy.onboarding.trial.settleFailed);
          clearParams();

          return "done";
        }
      } catch {
        toast.error(copy.onboarding.trial.settleFailed);
        startedFor.current = null;
        clearParams();

        return "done";
      }

      await sleep(PAID_RETURN_DELAY_MS);

      return attempt(remaining - 1);
    }

    async function runPaidReturn() {
      const result = await attempt(PAID_RETURN_ATTEMPTS);

      if (result === "pending") {
        toast.info(plan.returnPending);
      }
    }

    void runPaidReturn();
  }, [billing, card, paidPlan, params, plan, planParam, setParams]);
}
