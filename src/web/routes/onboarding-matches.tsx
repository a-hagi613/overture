import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import type { OnboardingMatchView } from "../../shared/onboarding.ts";
import type { BoardResponse } from "../lib/board-api.ts";
import type { OnboardingMatches } from "../lib/onboarding-api.ts";
import type { TrialCardState } from "../components/onboarding-trial-modal.tsx";

import { copy } from "../../shared/copy.ts";
import { OnboardingLoadState } from "../components/onboarding-load-state.tsx";
import { OnboardingMatchesCard } from "../components/onboarding-matches-card.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import { OnboardingTrialModal } from "../components/onboarding-trial-modal.tsx";
import { fetchBoard } from "../lib/board-api.ts";
import { useAcceptConsent, useConsent } from "../lib/consent-api.ts";
import {
  fetchOnboardingMatches,
  useFinishOnboardingStep,
  useOnboardingMatches,
  useOnboardingState,
  usePrepareOnboarding,
  useSaveOnboardingMatches,
} from "../lib/onboarding-api.ts";
import { startCardSetup, verifyTrialCard } from "../lib/trial-api.ts";

const trialText = copy.onboarding.trial;

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
    poolCount: board.total,
    selected: base.selected,
  };
}

export function OnboardingMatchesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const preview = params.get("preview") === "1";
  const trialParam = params.get("trial") === "1";
  const cardParam = params.get("card");
  const sessionId = params.get("session");
  const returned = cardParam === "verified" && sessionId !== null;
  const suffix = preview ? "?preview=1" : "";

  const state = useOnboardingState();
  const matches = useOnboardingMatches();
  const save = useSaveOnboardingMatches();
  const finish = useFinishOnboardingStep();
  const consent = useConsent();
  const acceptConsent = useAcceptConsent();
  const prepare = usePrepareOnboarding();

  const [selected, setSelected] = useState<string[] | null>(null);
  const [openingModal, setOpeningModal] = useState(false);

  const [modalOpen, setModalOpen] = useState(
    () => trialParam || returned || cardParam === "cancelled",
  );

  const [modalDismissed, setModalDismissed] = useState(false);
  const [trialState, setTrialState] = useState<TrialCardState>("verify");
  const [agreed, setAgreed] = useState(false);

  const needsPreviewBoard = preview && matches.data?.matches.length === 0;

  const boardQuery = useQuery({
    enabled: needsPreviewBoard,
    queryFn: fetchBoard,
    queryKey: ["board"],
  });

  useEffect(() => {
    if (preview || state.data === undefined) {
      return;
    }

    if (state.data.onboardedAt !== null) {
      void navigate("/home", { replace: true });

      return;
    }

    if (state.data.step < 2) {
      void navigate("/onboarding/resume", { replace: true });
    }
  }, [navigate, preview, state.data]);

  const verify = useMutation({
    mutationFn: async (picks: readonly string[]) => {
      if (preview) {
        return "granted" as const;
      }

      const consentAccepted =
        consent.data !== undefined &&
        consent.data.accepted?.version === consent.data.current.version;

      if (consent.data !== undefined && !consentAccepted) {
        await acceptConsent.mutateAsync(consent.data.current.version);
      }

      if (!returned) {
        globalThis.location.assign(await startCardSetup());

        return "redirect" as const;
      }

      const outcome = await verifyTrialCard(sessionId);

      if (outcome !== "granted") {
        return outcome;
      }

      const current = await fetchOnboardingMatches();
      const targetIds = current.selected.length > 0 ? current.selected : [...picks];

      if (targetIds.length === 0) {
        return "empty_selection" as const;
      }

      const result = await prepare.mutateAsync(targetIds);

      return result.prepared > 0 ? ("granted" as const) : ("empty_selection" as const);
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

        await navigate("/ready");

        return;
      }

      if (outcome === "empty_selection") {
        setModalOpen(false);
        toast.error(copy.onboarding.matches.prepareFailed);

        return;
      }

      if (outcome !== "redirect") {
        setTrialState(outcome);
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
      <OnboardingShell step={3}>
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

  const defaultSelected = effectiveMatches.matches
    .slice(0, effectiveMatches.pickLimit)
    .map((item) => item.id);

  const picks =
    selected ??
    (effectiveMatches.selected.length > 0 ? effectiveMatches.selected : defaultSelected);

  const selectedMatches = effectiveMatches.matches.filter((match) => picks.includes(match.id));
  const busy = save.isPending || openingModal;

  const toggle = (id: string) => {
    const next = picks.includes(id)
      ? picks.filter((pick) => pick !== id)
      : [...picks, id].slice(0, effectiveMatches.pickLimit);

    setSelected(next);

    if (!preview) {
      save.mutate(next);
    }
  };

  const autoModalOpen =
    !preview && !modalDismissed && (trialParam || returned || (state.data?.step ?? 0) >= 4);

  const effectiveModalOpen = modalOpen || autoModalOpen;

  const openTrialModal = async () => {
    if (openingModal) {
      return;
    }

    setOpeningModal(true);

    try {
      if (!preview && picks.length > 0) {
        await save.mutateAsync(picks);

        if ((state.data?.step ?? 0) < 4) {
          await finish.mutateAsync(3);
        }
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

  return (
    <OnboardingShell step={3}>
      <OnboardingMatchesCard
        allowEmptyContinue={preview && effectiveMatches.matches.length === 0}
        backTo={`/onboarding/targets${suffix}`}
        busy={busy}
        failed={save.isError}
        matches={effectiveMatches}
        onContinue={openTrialModal}
        onToggle={toggle}
        selected={picks}
      />

      <OnboardingTrialModal
        busy={verify.isPending || restart.isPending || prepare.isPending}
        consentSlot={consentCheckbox}
        disabled={verifyDisabled}
        error={verify.isError || restart.isError || prepare.isError}
        onOpenChange={(nextOpen) => {
          setModalOpen(nextOpen);

          if (!nextOpen) {
            setModalDismissed(true);
          }
        }}
        onVerify={() => {
          if (trialState === "verify") {
            verify.mutate(picks);
          } else {
            restart.mutate();
          }
        }}
        open={effectiveModalOpen}
        returned={returned}
        selectedMatches={selectedMatches}
        state={trialState}
      />
    </OnboardingShell>
  );
}
