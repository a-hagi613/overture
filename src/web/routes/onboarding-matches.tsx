import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import type { OnboardingMatchView, OnboardingPlanKind } from "../../shared/onboarding.ts";
import type { BoardResponse } from "../lib/board-api.ts";
import type { OnboardingMatches } from "../lib/onboarding-api.ts";
import type { TrialCardState } from "../components/onboarding-trial-modal.tsx";

import { copy } from "../../shared/copy.ts";
import { OnboardingLoadState } from "../components/onboarding-load-state.tsx";
import { OnboardingMatchesCard } from "../components/onboarding-matches-card.tsx";
import { OnboardingPlanChoice } from "../components/onboarding-plan-choice.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import { OnboardingTrialModal } from "../components/onboarding-trial-modal.tsx";
import { fetchBoard } from "../lib/board-api.ts";
import { useAcceptConsent, useConsent } from "../lib/consent-api.ts";
import {
  fetchOnboardingMatches,
  useOnboardingMatches,
  useOnboardingState,
  usePrepareOnboarding,
  useSaveOnboardingMatches,
  useSaveOnboardingPlan,
  useStartOnboardingCheckout,
} from "../lib/onboarding-api.ts";
import { startCardSetup, verifyTrialCard } from "../lib/trial-api.ts";

const trialText = copy.onboarding.trial;
const planText = copy.onboarding.plan;

function salaryPeriodFor(value: string | null | undefined) {
  if (value === "year" || value === "month" || value === "hour") {
    return value;
  }

  return null;
}

function previewMatchesFromBoard(board: BoardResponse, base: OnboardingMatches) {
  const allCards = board.columns.flatMap((column) => column.cards);

  const ranked = allCards.toSorted((left, right) => (right.score ?? 0) - (left.score ?? 0));

  const mapped: OnboardingMatchView[] = ranked.slice(0, 9).map((card) => ({
    company: card.company,
    employmentType: "full_time",
    id: card.id,
    location: card.location,
    reason: null,
    salaryCurrency: card.salary?.currency ?? null,
    salaryMinMinor: card.salary?.minMinor ?? null,
    salaryPeriod: salaryPeriodFor(card.salary?.period),
    score: card.score ?? 85,
    strong: card.strong,
    title: card.title,
    why: [],
    workplace: "remote",
  }));

  return {
    matches: mapped,
    pickLimit: base.pickLimit,
    planKind: base.planKind,
    poolCount: board.total,
    selected: base.selected,
    trialAvailable: base.trialAvailable,
  };
}

export function OnboardingMatchesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const preview = params.get("preview") === "1";
  const trialParam = params.get("trial") === "1";
  const cardParam = params.get("card");
  const cancelledParam = cardParam === "cancelled";
  const sessionId = params.get("session");
  const returned = cardParam === "verified" && sessionId !== null;
  const trialUsedParam = params.get("plan") === "trial_used";
  const suffix = preview ? "?preview=1" : "";

  const state = useOnboardingState();
  const matches = useOnboardingMatches();
  const save = useSaveOnboardingMatches();
  const savePlan = useSaveOnboardingPlan();
  const checkout = useStartOnboardingCheckout();
  const consent = useConsent();
  const acceptConsent = useAcceptConsent();
  const prepare = usePrepareOnboarding();

  const [planOverride, setPlanOverride] = useState<OnboardingPlanKind | null>(null);
  const [planFailed, setPlanFailed] = useState(false);
  const [checkoutFailed, setCheckoutFailed] = useState(false);

  const [selectionState, setSelectionState] = useState<{ ids: string[]; signature: string } | null>(
    null,
  );

  const [openingModal, setOpeningModal] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDismissed, setModalDismissed] = useState(false);
  const [trialState, setTrialState] = useState<TrialCardState>("verify");
  const [agreed, setAgreed] = useState(false);
  const completingRef = useRef(false);
  const cancelledNoticeRef = useRef(false);

  const needsPreviewBoard = preview && matches.data?.matches.length === 0;
  const hasApplications = !preview && (state.data?.applicationsLeft ?? 0) > 0;

  const boardQuery = useQuery({
    enabled: needsPreviewBoard,
    queryFn: fetchBoard,
    queryKey: ["board"],
  });

  useEffect(() => {
    if (!preview && cancelledParam && !cancelledNoticeRef.current) {
      cancelledNoticeRef.current = true;
      toast.info(trialText.cancelledNote);
    }
  }, [cancelledParam, preview]);

  const serverPlan = matches.data?.planKind ?? null;
  const trialAvailable = !trialUsedParam && (matches.data?.trialAvailable ?? true);
  const defaultPlan: OnboardingPlanKind = trialAvailable ? "free_trial" : "week";
  const planKind = planOverride ?? serverPlan ?? defaultPlan;

  const persistDefaultPlan = savePlan.mutate;

  useEffect(() => {
    if (preview || matches.data === undefined || serverPlan !== null || planOverride !== null) {
      return;
    }

    persistDefaultPlan(defaultPlan);
  }, [defaultPlan, matches.data, persistDefaultPlan, planOverride, preview, serverPlan]);

  useEffect(() => {
    if (preview || state.data === undefined) {
      return;
    }

    if (state.data.onboardedAt !== null && !completingRef.current) {
      void navigate("/home", { replace: true });

      return;
    }

    if (state.data.step < 2) {
      void navigate("/onboarding/resume", { replace: true });
    }
  }, [navigate, preview, state.data]);

  const verify = useMutation({
    mutationFn: async (currentPicks: readonly string[]) => {
      if (preview) {
        return "granted" as const;
      }

      const consentAccepted =
        consent.data !== undefined &&
        consent.data.accepted?.version === consent.data.current.version;

      if (consent.data !== undefined && !consentAccepted) {
        await acceptConsent.mutateAsync(consent.data.current.version);
      }

      await savePlan.mutateAsync(planKind);

      if (planKind !== "free_trial") {
        const current = await fetchOnboardingMatches();

        const targetIds =
          currentPicks.length > 0
            ? [...currentPicks]
            : current.selected.slice(0, current.pickLimit);

        if (targetIds.length === 0) {
          return "empty_selection" as const;
        }

        await save.mutateAsync(targetIds);
        completingRef.current = true;

        try {
          globalThis.location.assign(await checkout.mutateAsync(planKind));
        } catch {
          completingRef.current = false;

          return "checkout_failed" as const;
        }

        return "redirect" as const;
      }

      if (!hasApplications && !returned) {
        globalThis.location.assign(await startCardSetup());

        return "redirect" as const;
      }

      if (!hasApplications && returned) {
        const outcome = await verifyTrialCard(sessionId);

        if (outcome !== "granted") {
          return outcome;
        }
      }

      const current = await fetchOnboardingMatches();

      const targetIds =
        currentPicks.length > 0 ? [...currentPicks] : current.selected.slice(0, current.pickLimit);

      if (targetIds.length === 0) {
        return "empty_selection" as const;
      }

      completingRef.current = true;

      const result = await prepare.mutateAsync(targetIds);

      if (result.prepared <= 0) {
        completingRef.current = false;

        return "empty_selection" as const;
      }

      return "granted" as const;
    },
    onError: () => {
      completingRef.current = false;
    },
    onSuccess: async (outcome) => {
      if (outcome === "granted") {
        if (preview) {
          toast.success("Free trial preview complete.");
          await navigate("/ready");

          return;
        }

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["home"] }),
          queryClient.invalidateQueries({ queryKey: ["billing"] }),
          queryClient.invalidateQueries({ queryKey: ["onboarding-state"] }),
          queryClient.invalidateQueries({ queryKey: ["nav"] }),
          queryClient.invalidateQueries({ queryKey: ["ready"] }),
          queryClient.invalidateQueries({ queryKey: ["board"] }),
        ]);

        await navigate("/tracker", { replace: true });

        return;
      }

      if (outcome === "checkout_failed") {
        completingRef.current = false;
        setCheckoutFailed(true);
        toast.error(planText.checkoutFailed);

        return;
      }

      if (outcome === "empty_selection") {
        completingRef.current = false;
        setModalOpen(false);
        toast.error(copy.onboarding.matches.prepareFailed);

        return;
      }

      if (outcome !== "redirect") {
        completingRef.current = false;

        if (outcome === "declined") {
          setTrialState("declined");
        } else if (outcome === "pending") {
          setTrialState("pending");
        } else {
          setTrialState("used");
        }
      }
    },
  });

  const restart = useMutation({
    mutationFn: async () => {
      globalThis.location.assign(await startCardSetup());
    },
  });

  const waitingForPreviewBoard = needsPreviewBoard && boardQuery.isPending;

  if (matches.data === undefined || waitingForPreviewBoard) {
    return (
      <OnboardingShell step={4}>
        <OnboardingLoadState
          onRetry={() => {
            void matches.refetch();
          }}
          retrying={matches.isFetching}
          state={matches.isError ? "error" : "loading"}
        />
      </OnboardingShell>
    );
  }

  const effectiveMatches: OnboardingMatches =
    needsPreviewBoard && boardQuery.data !== undefined && boardQuery.data.total > 0
      ? previewMatchesFromBoard(boardQuery.data, matches.data)
      : matches.data;

  const topMatches = effectiveMatches.matches.slice(0, effectiveMatches.pickLimit);
  const topMatchIds = new Set(topMatches.map((item) => item.id));
  const matchesSignature = topMatches.map((item) => item.id).join(",");
  const defaultSelected = topMatches.map((item) => item.id);
  const validSaved = effectiveMatches.selected.filter((id) => topMatchIds.has(id));

  let fallbackPicks = defaultSelected;

  if (validSaved.length > 0) {
    fallbackPicks = validSaved;
  }

  const picks =
    selectionState?.signature === matchesSignature
      ? selectionState.ids.filter((id) => topMatchIds.has(id))
      : fallbackPicks;

  const selectedMatches = topMatches.filter((match) => picks.includes(match.id));
  const busy = save.isPending || openingModal || savePlan.isPending;
  const text = copy.onboarding.matches;

  const syncSelection = (
    view: OnboardingMatches,
    options: { ids?: string[]; signature?: string } = {},
  ) => {
    setSelectionState({
      ids: options.ids ?? view.selected.filter((id) => topMatchIds.has(id)),
      signature: options.signature ?? matchesSignature,
    });

    const dropped = view.picks?.droppedPicks ?? 0;

    if (dropped > 0) {
      toast.info(text.droppedForEmployer(dropped));
    }
  };

  const selectPlan = async (next: OnboardingPlanKind) => {
    if (next === planKind || preview) {
      return;
    }

    setPlanOverride(next);
    setPlanFailed(false);

    try {
      if (next === "free_trial" && picks.length > 3) {
        const trimmed = picks.slice(0, 3);

        syncSelection(await save.mutateAsync(trimmed));
      }

      const view = await savePlan.mutateAsync(next);

      if (next !== "free_trial") {
        const topIds = view.matches.slice(0, view.pickLimit).map((match) => match.id);

        if (picks.length < topIds.length) {
          const saved = await save.mutateAsync(topIds);

          syncSelection(saved, { ids: saved.selected, signature: topIds.join(",") });
        }
      }
    } catch {
      setPlanOverride(serverPlan);
      setPlanFailed(true);
      toast.error(planText.saveFailed);
    }
  };

  const toggle = (id: string) => {
    const next = picks.includes(id)
      ? picks.filter((pick) => pick !== id)
      : [...picks, id].slice(0, effectiveMatches.pickLimit);

    setSelectionState({ ids: next, signature: matchesSignature });

    if (!preview) {
      save.mutate(next, {
        onSuccess: (view) => {
          syncSelection(view);
        },
      });
    }
  };

  const autoModalOpen = !modalDismissed && (trialParam || (!preview && returned));

  const effectiveModalOpen = modalOpen || autoModalOpen;

  const openTrialModal = async () => {
    if (openingModal) {
      return;
    }

    setOpeningModal(true);
    setCheckoutFailed(false);

    try {
      if (!preview && picks.length > 0) {
        syncSelection(await save.mutateAsync(picks));
      }

      setModalDismissed(false);
      setModalOpen(true);
      setOpeningModal(false);
    } catch {
      setOpeningModal(false);
      toast.error(copy.onboarding.matches.saveFailed);
    }
  };

  const alreadyAgreed =
    consent.data !== undefined && consent.data.accepted?.version === consent.data.current.version;

  const agreedNow = agreed || (!preview && alreadyAgreed) || returned;

  const verifyDisabled =
    (trialState === "verify" && !returned && !agreedNow) ||
    (!preview && consent.data === undefined && !returned);

  const consentCheckbox = (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-relaxed text-foreground">
      <input
        checked={agreedNow}
        className="mt-1 h-4 w-4 flex-none accent-signal"
        onChange={(event) => {
          setAgreed(event.currentTarget.checked);
        }}
        type="checkbox"
      />
      <span>
        {trialText.consentBefore}
        <Link
          className="font-medium underline decoration-input underline-offset-4 hover:text-signal-text"
          to="/terms"
        >
          {trialText.consentTerms}
        </Link>
        {trialText.consentComma}
        <Link
          className="font-medium underline decoration-input underline-offset-4 hover:text-signal-text"
          to="/privacy"
        >
          {trialText.consentPrivacy}
        </Link>
        {trialText.consentAnd}
        <Link
          className="font-medium underline decoration-input underline-offset-4 hover:text-signal-text"
          to="/consent"
        >
          {trialText.consentLink}
        </Link>
        {trialText.consentPeriod}
      </span>
    </label>
  );

  let ctaLabel = planText.ctaMonth(picks.length);

  if (planKind === "free_trial") {
    ctaLabel = planText.ctaTrial;
  } else if (planKind === "week") {
    ctaLabel = planText.ctaWeek(picks.length);
  }

  return (
    <OnboardingShell step={4}>
      <OnboardingMatchesCard
        allowEmptyContinue={preview && effectiveMatches.matches.length === 0}
        backTo={`/onboarding/targets${suffix}`}
        busy={busy}
        ctaLabel={ctaLabel}
        failed={save.isError}
        intro={planKind === "free_trial" ? undefined : copy.onboarding.matches.introPaid}
        matches={effectiveMatches}
        onContinue={openTrialModal}
        onToggle={toggle}
        paidPlan={planKind !== "free_trial"}
        planSlot={
          preview ? undefined : (
            <>
              {cancelledParam ? (
                <output className="mt-4 block rounded-lg border border-need/40 bg-need-soft/40 p-3 text-xs font-medium text-need">
                  {trialText.cancelledNote}
                </output>
              ) : null}
              <OnboardingPlanChoice
                disabled={busy}
                onSelect={(next) => {
                  void selectPlan(next);
                }}
                planKind={planKind}
                trialAvailable={trialAvailable}
              />
              {planFailed ? (
                <output className="mt-3 block text-xs font-semibold text-need">
                  {planText.saveFailed}
                </output>
              ) : null}
            </>
          )
        }
        selected={picks}
      />

      <OnboardingTrialModal
        busy={verify.isPending || restart.isPending || prepare.isPending}
        consentSlot={consentCheckbox}
        disabled={verifyDisabled}
        error={verify.isError || restart.isError || prepare.isError || checkoutFailed}
        hasApplications={hasApplications}
        onOpenChange={(nextOpen) => {
          setModalOpen(nextOpen);

          if (!nextOpen) {
            setModalDismissed(true);

            if (trialParam || returned || cardParam !== null || sessionId !== null) {
              const next = new URLSearchParams(params);

              next.delete("trial");
              next.delete("card");
              next.delete("plan");
              next.delete("session");
              setParams(next, { replace: true });
            }
          }
        }}
        onVerify={() => {
          if (trialState === "verify" || trialState === "pending") {
            verify.mutate(picks);
          } else {
            restart.mutate();
          }
        }}
        open={effectiveModalOpen}
        planKind={planKind}
        returned={returned}
        selectedMatches={selectedMatches}
        state={trialState}
      />
    </OnboardingShell>
  );
}
