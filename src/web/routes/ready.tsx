import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { READY_DWELL_MAX_MS } from "../../shared/ready-approval.ts";
import { PageHeader } from "../components/page-header.tsx";
import { ReadyConfirmDialog } from "../components/ready-confirm-dialog.tsx";
import type { ReadyConfirmTarget } from "../components/ready-confirm-dialog.tsx";
import { ReadyInspectDrawer } from "../components/ready-inspect-drawer.tsx";
import { ReadyScheduledStrip } from "../components/ready-scheduled-strip.tsx";
import { ReadyStatus } from "../components/ready-status.tsx";
import { ReadyTable } from "../components/ready-table.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Card } from "../components/ui/card.tsx";
import { dsBody, dsCardTitle } from "../components/ui/ds.ts";
import { MetricStrip } from "../components/ui/metric-strip.tsx";
import type { MetricStripItem } from "../components/ui/metric-strip.tsx";
import { useHomeData } from "../lib/home-api.ts";
import {
  ReadyApiError,
  useApprove,
  useEditAnswer,
  useReady,
  useSkipReady,
} from "../lib/ready-api.ts";
import type { ReadyAnswer, ReadyCard as ReadyCardData } from "../lib/ready-api.ts";

const SKIP_DELAY_MS = 5000;

interface ApproveInput {
  dwellMs?: number | undefined;
  id: string;
  planSha256: string;
}

function errorCode(error: Error) {
  return error instanceof ReadyApiError ? error.code : "request_failed";
}

function handleEditFailure(error: Error) {
  toast.error(
    errorCode(error) === "plan_changed" ? copy.ready.toast.planChanged : copy.ready.toast.failed,
  );
}

function elapsedMs() {
  return globalThis.performance.now();
}

function boundedDwell(startedAt: number) {
  return Math.min(Math.max(0, Math.round(elapsedMs() - startedAt)), READY_DWELL_MAX_MS);
}

function nextIdAfterRemoval(cards: readonly ReadyCardData[], removingId: string) {
  const index = cards.findIndex((card) => card.id === removingId);

  if (index === -1) {
    return null;
  }

  return cards.at(index + 1)?.id ?? cards.at(index - 1)?.id ?? null;
}

export function ReadyPage() {
  const queryClient = useQueryClient();
  const { data: ready, isError, isFetching, isPending, isSuccess, refetch } = useReady();
  const { data: home } = useHomeData();
  const approve = useApprove();
  const skip = useSkipReady();
  const editAnswer = useEditAnswer();

  const headingRef = useRef<HTMLHeadingElement>(null);
  const recoveringRef = useRef(false);
  const skipTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const startedAtRef = useRef<Map<string, number>>(new Map());
  const focusedIdRef = useRef<string | null>(null);
  const keyHandlerRef = useRef<((event: KeyboardEvent) => void) | null>(null);

  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [removedIds, setRemovedIds] = useState<readonly string[]>([]);
  const [confirmTarget, setConfirmTarget] = useState<ReadyConfirmTarget | null>(null);

  const [editing, setEditing] = useState<{ applicationId: string; questionId: string } | null>(
    null,
  );

  useEffect(() => {
    if (recoveringRef.current && !isFetching) {
      recoveringRef.current = false;
      headingRef.current?.focus();
    }
  }, [isFetching]);

  useEffect(
    () => () => {
      for (const [id, timer] of skipTimers.current) {
        globalThis.clearTimeout(timer);
        void (async () => {
          try {
            await fetch(`/api/applications/${encodeURIComponent(id)}/withdraw`, {
              keepalive: true,
              method: "POST",
            });
          } catch {}
        })();
      }

      skipTimers.current.clear();
    },
    [],
  );

  const rawCards = ready?.cards ?? [];

  const pendingCards = rawCards.filter(
    (card) => card.status === "ready" && !removedIds.includes(card.id),
  );

  const approvedCards = rawCards.filter((card) => card.status === "approved");
  const sendableCards = pendingCards.filter((card) => card.plan !== null);

  const inspectedIndex =
    inspectedId === null ? -1 : pendingCards.findIndex((card) => card.id === inspectedId);

  const inspectedCard = inspectedIndex >= 0 ? (pendingCards.at(inspectedIndex) ?? null) : null;
  const activeShortcutCard = inspectedCard ?? pendingCards.at(0) ?? null;
  const trackedId = inspectedCard?.id ?? pendingCards.at(0)?.id ?? null;
  const pendingKey = pendingCards.map((card) => card.id).join("|");

  useEffect(() => {
    const liveIds = pendingKey === "" ? [] : pendingKey.split("|");
    const live = new Set(liveIds);

    for (const id of startedAtRef.current.keys()) {
      if (!live.has(id)) {
        startedAtRef.current.delete(id);
      }
    }

    for (const id of liveIds) {
      if (!startedAtRef.current.has(id)) {
        startedAtRef.current.set(id, elapsedMs());
      }
    }

    if (trackedId !== focusedIdRef.current) {
      focusedIdRef.current = trackedId;

      if (trackedId !== null) {
        startedAtRef.current.set(trackedId, elapsedMs());
      }
    }
  }, [focusedIdRef, pendingKey, startedAtRef, trackedId]);

  const stale = isError && ready !== undefined;
  const failedToLoad = isError && ready === undefined;
  const confirmedEmpty = isSuccess && pendingCards.length === 0;

  const sentToday = home?.sentToday ?? 0;
  const dailyCap = home?.dailyCap ?? 10;
  const fill = dailyCap === 0 ? 0 : Math.min(100, Math.round((sentToday / dailyCap) * 100));
  const timeZone = home?.timeZone ?? "UTC";

  const metricItems: MetricStripItem[] = [
    {
      id: "pending",
      label: copy.ready.metrics.pendingLabel,
      unit: copy.ready.metrics.pendingUnit(pendingCards.length),
      value: String(pendingCards.length),
    },
    {
      badge:
        approvedCards.length > 0 ? (
          <Badge className="tabular-nums" variant="ok">
            {copy.ready.scheduledCount(approvedCards.length)}
          </Badge>
        ) : undefined,
      id: "scheduled",
      label: copy.ready.metrics.scheduledLabel,
      subcontent: <ReadyScheduledStrip cards={approvedCards} zone={timeZone} />,
      unit: copy.ready.metrics.scheduledUnit,
      value: String(approvedCards.length),
    },
    {
      detail: copy.ready.sentToday(sentToday, dailyCap),
      id: "daily-limit",
      label: copy.ready.metrics.dailyLimitLabel,
      progress: fill,
      value: `${String(sentToday)} / ${String(dailyCap)}`,
    },
  ];

  const retry = () => {
    recoveringRef.current = true;
    void refetch();
  };

  const refreshLinkedQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ["board"] });
    void queryClient.invalidateQueries({ queryKey: ["home"] });
    void queryClient.invalidateQueries({ queryKey: ["nav"] });
    void queryClient.invalidateQueries({ queryKey: ["profile-facts"] });
    void queryClient.invalidateQueries({ queryKey: ["ready"] });
  };

  const dwellFor = (id: string) => {
    const startedAt = startedAtRef.current.get(id);

    return startedAt === undefined ? null : boundedDwell(startedAt);
  };

  const inspectCard = (card: ReadyCardData) => {
    setInspectedId(card.id);
    setExpandedId(null);
    setEditing(null);
  };

  const stepDrawer = (delta: number) => {
    if (pendingCards.length <= 1 || inspectedIndex < 0) {
      return;
    }

    const next = pendingCards.at(
      (inspectedIndex + delta + pendingCards.length) % pendingCards.length,
    );

    if (next !== undefined) {
      inspectCard(next);
    }
  };

  const requestApprove = (card: ReadyCardData) => {
    setConfirmTarget({
      company: card.company,
      id: card.id,
      kind: "single",
      title: card.title ?? card.plan?.postingTitle ?? card.company,
    });
  };

  const requestEdit = (card: ReadyCardData) => {
    const answers = card.plan?.answers ?? [];

    const answer =
      answers.find((candidate) => candidate.source === "open_text" && !candidate.coverLetter) ??
      answers.find((candidate) => candidate.source === "open_text") ??
      answers.at(0);

    if (answer === undefined) {
      return;
    }

    setInspectedId(card.id);
    setEditing({ applicationId: card.id, questionId: answer.questionId });
  };

  const executeConfirm = () => {
    if (confirmTarget === null) {
      return;
    }

    const card = sendableCards.find((entry) => entry.id === confirmTarget.id);
    const planSha256 = card?.plan?.planSha256 ?? null;
    const dwellMs = card === undefined ? null : dwellFor(card.id);

    setConfirmTarget(null);

    if (card === undefined || planSha256 === null) {
      return;
    }

    const input: ApproveInput = {
      id: card.id,
      planSha256,
    };

    if (dwellMs !== null) {
      input.dwellMs = dwellMs;
    }

    if (inspectedId === card.id) {
      setInspectedId(nextIdAfterRemoval(pendingCards, card.id));
    }

    setRemovedIds((current) => [...current, card.id]);

    approve.mutate(input, {
      onError: (error) => {
        setRemovedIds((current) => current.filter((id) => id !== card.id));
        handleEditFailure(error);
      },
      onSuccess: () => {
        setEditing((current) => (current?.applicationId === card.id ? null : current));
        toast.success(copy.ready.toast.sentTo(card.company));
        refreshLinkedQueries();
      },
    });
  };

  const skipCard = (card: ReadyCardData) => {
    const existingTimer = skipTimers.current.get(card.id);

    if (existingTimer !== undefined) {
      globalThis.clearTimeout(existingTimer);
    }

    if (inspectedId === card.id) {
      setInspectedId(nextIdAfterRemoval(pendingCards, card.id));
    }

    setRemovedIds((current) => (current.includes(card.id) ? current : [...current, card.id]));

    const timer = globalThis.setTimeout(() => {
      skipTimers.current.delete(card.id);

      skip.mutate(card.id, {
        onError: () => {
          setRemovedIds((current) => current.filter((id) => id !== card.id));
          toast.error(copy.ready.toast.failed);
        },
        onSuccess: refreshLinkedQueries,
      });
    }, SKIP_DELAY_MS);

    skipTimers.current.set(card.id, timer);

    toast.success(copy.ready.toast.skippedCompany(card.company), {
      action: {
        label: copy.ready.undo,
        onClick: () => {
          const pendingTimer = skipTimers.current.get(card.id);

          if (pendingTimer !== undefined) {
            globalThis.clearTimeout(pendingTimer);
            skipTimers.current.delete(card.id);
          }

          setRemovedIds((current) => current.filter((id) => id !== card.id));
        },
      },
    });
  };

  const saveAnswer = (card: ReadyCardData, answer: ReadyAnswer, value: string) => {
    editAnswer.mutate(
      { applicationId: card.id, questionId: answer.questionId, value },
      {
        onError: handleEditFailure,
        onSuccess: () => {
          setEditing(null);
          toast.success(copy.ready.toast.saved);
        },
      },
    );
  };

  const busy = approve.isPending || skip.isPending;

  const handleShortcut = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    const { target } = event;

    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') !==
        null
    ) {
      return;
    }

    if (confirmTarget !== null || editing !== null || busy || activeShortcutCard === null) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === "arrowleft" && inspectedCard !== null && pendingCards.length > 1) {
      event.preventDefault();
      stepDrawer(-1);
    } else if (key === "arrowright" && inspectedCard !== null && pendingCards.length > 1) {
      event.preventDefault();
      stepDrawer(1);
    } else if (key === "a") {
      event.preventDefault();
      requestApprove(activeShortcutCard);
    } else if (key === "e") {
      event.preventDefault();
      requestEdit(activeShortcutCard);
    } else if (key === "s") {
      event.preventDefault();
      skipCard(activeShortcutCard);
    }
  };

  useEffect(() => {
    keyHandlerRef.current = handleShortcut;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      keyHandlerRef.current?.(event);
    };

    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [keyHandlerRef]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        headingRef={headingRef}
        titleNode={`${copy.ready.titlePlain} ${copy.ready.titleItalic}`}
      />

      {stale ? <ReadyStatus busy={isFetching} onRetry={retry} variant="stale" /> : null}

      {ready === undefined ? null : (
        <MetricStrip ariaLabel={copy.ready.summaryAria} className="mt-3" items={metricItems} />
      )}

      {isPending ? <ReadyStatus variant="loading" /> : null}

      {failedToLoad ? <ReadyStatus busy={isFetching} onRetry={retry} variant="failed" /> : null}

      {confirmedEmpty ? (
        <Card className="mt-3 flex flex-1 flex-col items-center justify-center p-6 text-center">
          <h2 className={dsCardTitle}>{copy.ready.emptyTitle}</h2>
          <p className={`${dsBody} mt-1.5`}>{copy.ready.emptyBody}</p>
        </Card>
      ) : null}

      {pendingCards.length === 0 ? null : (
        <ReadyTable
          activeId={inspectedCard?.id ?? null}
          cards={pendingCards}
          onApprove={requestApprove}
          onInspect={inspectCard}
          onSkip={skipCard}
        />
      )}

      <ReadyInspectDrawer
        card={inspectedCard}
        count={pendingCards.length}
        editing={
          editing !== null && inspectedCard !== null && editing.applicationId === inspectedCard.id
            ? { questionId: editing.questionId }
            : null
        }
        expanded={inspectedCard !== null && expandedId === inspectedCard.id}
        index={Math.max(0, inspectedIndex)}
        onApprove={requestApprove}
        onCancelEdit={() => {
          setEditing(null);
        }}
        onClose={() => {
          setInspectedId(null);
          setEditing(null);
        }}
        onEdit={(answer) => {
          if (inspectedCard !== null) {
            setEditing({ applicationId: inspectedCard.id, questionId: answer.questionId });
          }
        }}
        onEditRecommended={requestEdit}
        onNext={() => {
          stepDrawer(1);
        }}
        onPrev={() => {
          stepDrawer(-1);
        }}
        onSave={(input) => {
          if (inspectedCard !== null) {
            saveAnswer(inspectedCard, input.answer, input.value);
          }
        }}
        onSkip={skipCard}
        onToggle={() => {
          if (inspectedCard !== null) {
            setExpandedId((current) => (current === inspectedCard.id ? null : inspectedCard.id));
          }
        }}
        saving={editAnswer.isPending}
      />

      <ReadyConfirmDialog
        busy={approve.isPending}
        onCancel={() => {
          setConfirmTarget(null);
        }}
        onConfirm={executeConfirm}
        target={confirmTarget}
      />
    </div>
  );
}
