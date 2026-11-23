import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { PageHeader } from "../components/page-header.tsx";
import { ReadyApprovedList } from "../components/ready-approved-list.tsx";
import { ReadyCard } from "../components/ready-card.tsx";
import { ReadyConfirmDialog } from "../components/ready-confirm-dialog.tsx";
import type { ReadyConfirmTarget } from "../components/ready-confirm-dialog.tsx";
import { ReadyStatus } from "../components/ready-status.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { dsBody, dsCardTitle, dsMono } from "../components/ui/ds.ts";
import { useHomeData } from "../lib/home-api.ts";
import {
  ReadyApiError,
  useApprove,
  useApproveAll,
  useEditAnswer,
  useReady,
  useSkipReady,
  useUnapprove,
} from "../lib/ready-api.ts";
import type { ReadyAnswer, ReadyCard as ReadyCardData } from "../lib/ready-api.ts";

const INITIAL_VISIBLE = 4;
const PAGE_STEP = 6;
const SKIP_DELAY_MS = 5000;

function errorCode(error: Error) {
  return error instanceof ReadyApiError ? error.code : "request_failed";
}

function handleEditFailure(error: Error) {
  toast.error(
    errorCode(error) === "plan_changed" ? copy.ready.toast.planChanged : copy.ready.toast.failed,
  );
}

export function ReadyPage() {
  const queryClient = useQueryClient();
  const { data: ready, isError, isFetching, isPending, isSuccess, refetch } = useReady();
  const { data: home } = useHomeData();
  const approve = useApprove();
  const approveAll = useApproveAll();
  const skip = useSkipReady();
  const unapprove = useUnapprove();
  const editAnswer = useEditAnswer();

  const headingRef = useRef<HTMLHeadingElement>(null);
  const recoveringRef = useRef(false);
  const skipTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
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
        void fetch(`/api/applications/${encodeURIComponent(id)}/withdraw`, {
          keepalive: true,
          method: "POST",
        });
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
  const visibleCards = pendingCards.slice(0, visibleCount);
  const remaining = Math.max(0, pendingCards.length - visibleCards.length);
  const expandedList = visibleCount > INITIAL_VISIBLE && pendingCards.length > INITIAL_VISIBLE;

  const stale = isError && ready !== undefined;
  const failedToLoad = isError && ready === undefined;
  const confirmedEmpty = isSuccess && pendingCards.length === 0;

  const sentToday = home?.sentToday ?? 0;
  const dailyCap = home?.dailyCap ?? 10;
  const fill = dailyCap === 0 ? 0 : Math.min(100, Math.round((sentToday / dailyCap) * 100));

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

  const executeConfirm = () => {
    if (confirmTarget === null) {
      return;
    }

    if (confirmTarget.kind === "single") {
      const card = sendableCards.find((entry) => entry.id === confirmTarget.id);
      const planSha256 = card?.plan?.planSha256 ?? null;

      setConfirmTarget(null);

      if (card === undefined || planSha256 === null) {
        return;
      }

      setRemovedIds((current) => [...current, card.id]);

      approve.mutate(
        { id: card.id, planSha256 },
        {
          onError: (error) => {
            setRemovedIds((current) => current.filter((id) => id !== card.id));
            handleEditFailure(error);
          },
          onSuccess: () => {
            toast.success(copy.ready.toast.sentTo(card.company));
            refreshLinkedQueries();
          },
        },
      );

      return;
    }

    const batch = sendableCards;

    setConfirmTarget(null);

    if (batch.length === 0) {
      return;
    }

    const batchIds = batch.map((card) => card.id);

    setRemovedIds((current) => [...current, ...batchIds]);

    approveAll.mutate(
      batch.map((card) => ({ id: card.id, planSha256: card.plan?.planSha256 ?? "" })),
      {
        onError: (error) => {
          setRemovedIds((current) => current.filter((id) => !batchIds.includes(id)));
          handleEditFailure(error);
        },
        onSuccess: (result) => {
          const refusedIds = result.refused.map((entry) => entry.id);

          if (refusedIds.length > 0) {
            setRemovedIds((current) => current.filter((id) => !refusedIds.includes(id)));
            toast.error(copy.ready.toast.refused(refusedIds.length));
          }

          if (result.approved.length > 0) {
            toast.success(copy.ready.toast.approvedAll(result.approved.length));
          }

          refreshLinkedQueries();
        },
      },
    );
  };

  const skipCard = (card: ReadyCardData) => {
    const existingTimer = skipTimers.current.get(card.id);

    if (existingTimer !== undefined) {
      globalThis.clearTimeout(existingTimer);
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
        label: copy.board.undo,
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

  const unapproveCard = (card: ReadyCardData) => {
    unapprove.mutate(card.id, {
      onError: () => {
        toast.error(copy.ready.toast.failed);
      },
      onSuccess: () => {
        setRemovedIds((current) => current.filter((id) => id !== card.id));
        toast.success(copy.ready.toast.unapproved);
        refreshLinkedQueries();
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

  return (
    <div>
      <PageHeader
        headingRef={headingRef}
        lead={copy.ready.lead}
        titleNode={
          <>
            {copy.ready.titlePlain} <em className="italic text-signal">{copy.ready.titleItalic}</em>
          </>
        }
      />

      {stale ? <ReadyStatus busy={isFetching} onRetry={retry} variant="stale" /> : null}

      {ready === undefined ? null : (
        <Card
          ariaLabel={copy.ready.sendAll}
          className="mt-6 border-signal/25 bg-card p-5 md:p-6"
          variant="elevated"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2.5">
                <span className="font-serif text-metric leading-none tabular-nums text-signal-text">
                  {String(pendingCards.length)}
                </span>
                <h2 className={dsCardTitle}>{copy.ready.readyCountTitle(pendingCards.length)}</h2>
              </div>
              <p className={`${dsBody} mt-1.5`}>{copy.ready.readyHeroNote}</p>
            </div>

            <Button
              disabled={sendableCards.length === 0}
              onClick={() => {
                setConfirmTarget({ count: sendableCards.length, kind: "all" });
              }}
              size="lg"
              variant="primary"
            >
              <Send aria-hidden="true" size={16} />
              <span>{copy.ready.sendAllCount(sendableCards.length)}</span>
            </Button>
          </div>

          <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-signal transition-all"
                style={{ width: `${String(fill)}%` }}
              />
            </div>
            <span className={`${dsMono} shrink-0`}>
              {copy.ready.sentToday(sentToday, dailyCap)}
            </span>
          </div>
        </Card>
      )}

      {isPending ? <ReadyStatus variant="loading" /> : null}

      {failedToLoad ? <ReadyStatus busy={isFetching} onRetry={retry} variant="failed" /> : null}

      {confirmedEmpty ? (
        <Card className="mt-6 p-6">
          <h2 className={dsCardTitle}>{copy.ready.emptyTitle}</h2>
          <p className={`${dsBody} mt-1.5`}>{copy.ready.emptyBody}</p>
        </Card>
      ) : null}

      {visibleCards.length > 0 ? (
        <section aria-label="Applications ready to send" className="mt-5 flex flex-col gap-4">
          {visibleCards.map((card, index) => (
            <ReadyCard
              card={card}
              editing={
                editing !== null && editing.applicationId === card.id
                  ? { questionId: editing.questionId }
                  : null
              }
              expanded={expandedId === null ? index === 0 : expandedId === card.id}
              key={card.id}
              onApprove={(targetCard) => {
                setConfirmTarget({
                  company: targetCard.company,
                  id: targetCard.id,
                  kind: "single",
                  title: targetCard.title ?? targetCard.plan?.postingTitle ?? targetCard.company,
                });
              }}
              onCancelEdit={() => {
                setEditing(null);
              }}
              onEdit={(answer) => {
                setEditing({ applicationId: card.id, questionId: answer.questionId });
              }}
              onSave={(input) => {
                saveAnswer(card, input.answer, input.value);
              }}
              onSkip={skipCard}
              onToggle={() => {
                const isOpen = expandedId === null ? index === 0 : expandedId === card.id;

                setExpandedId(isOpen ? "" : card.id);
              }}
              saving={editAnswer.isPending}
            />
          ))}

          {remaining > 0 ? (
            <Button
              className="w-full justify-center gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setVisibleCount((current) => current + PAGE_STEP);
              }}
              size="default"
              variant="ghost"
            >
              <span>{copy.ready.showMore(remaining)}</span>
              <ChevronDown aria-hidden="true" size={16} />
            </Button>
          ) : null}

          {remaining === 0 && expandedList ? (
            <Button
              className="w-full justify-center gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setVisibleCount(INITIAL_VISIBLE);
              }}
              size="default"
              variant="ghost"
            >
              <span>{copy.ready.showLess}</span>
              <ChevronUp aria-hidden="true" size={16} />
            </Button>
          ) : null}
        </section>
      ) : null}

      {approvedCards.length > 0 ? (
        <ReadyApprovedList
          busy={unapprove.isPending}
          cards={approvedCards}
          onUnapprove={unapproveCard}
          zone={home?.timeZone ?? "UTC"}
        />
      ) : null}

      <ReadyConfirmDialog
        busy={approve.isPending || approveAll.isPending}
        onCancel={() => {
          setConfirmTarget(null);
        }}
        onConfirm={executeConfirm}
        target={confirmTarget}
      />
    </div>
  );
}
