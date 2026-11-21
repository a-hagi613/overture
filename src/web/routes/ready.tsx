import { useState } from "react";

import { copy } from "../../shared/copy.ts";
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
import { ReadyCard } from "../components/ready-card.tsx";
import { ThemeToggle } from "../components/theme-toggle.tsx";

function dateLine() {
  const now = new Date();
  const weekday = now.toLocaleDateString(copy.ready.dateLocale, { weekday: "long" });
  const month = now.toLocaleDateString(copy.ready.dateLocale, { month: "long" });

  return `${weekday}, ${String(now.getDate())} ${month}`;
}

function errorCode(error: Error) {
  return error instanceof ReadyApiError ? error.code : "request_failed";
}

export function ReadyPage() {
  const { data: ready } = useReady();
  const { data: home } = useHomeData();
  const approve = useApprove();
  const approveAll = useApproveAll();
  const unapprove = useUnapprove();
  const skip = useSkipReady();
  const editAnswer = useEditAnswer();

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ applicationId: string; questionId: string } | null>(
    null,
  );

  const [toast, setToast] = useState<string | null>(null);

  const cards = ready?.cards ?? [];

  const readyCards = cards.filter((card) => card.status === "ready" && card.plan !== null);

  const sentToday = home?.sentToday ?? 0;
  const dailyCap = home?.dailyCap ?? 10;
  const fill = dailyCap === 0 ? 0 : Math.min(100, (sentToday / dailyCap) * 100);
  const zone = home?.timeZone ?? "UTC";

  const say = (message: string) => {
    setToast(message);
  };

  const onFailure = (error: Error) => {
    say(
      errorCode(error) === "plan_changed" ? copy.ready.toast.planChanged : copy.ready.toast.failed,
    );
  };

  const approveCard = (card: ReadyCardData) => {
    if (card.plan === null) {
      return;
    }

    approve.mutate(
      { id: card.id, planSha256: card.plan.planSha256 },
      {
        onError: onFailure,
        onSuccess: () => {
          say(copy.ready.toast.approved);
        },
      },
    );
  };

  const approveEverything = () => {
    if (readyCards.length === 0) {
      return;
    }

    approveAll.mutate(
      readyCards.map((card) => ({ id: card.id, planSha256: card.plan?.planSha256 ?? "" })),
      {
        onError: onFailure,
        onSuccess: (result) => {
          const { refused } = result;

          say(
            refused.length === 0
              ? copy.ready.toast.approvedAll(readyCards.length)
              : copy.ready.toast.refused(refused.length),
          );
        },
      },
    );
  };

  const skipCard = (card: ReadyCardData) => {
    skip.mutate(card.id, {
      onError: onFailure,
      onSuccess: () => {
        say(copy.ready.toast.skipped);
      },
    });
  };

  const unapproveCard = (card: ReadyCardData) => {
    unapprove.mutate(card.id, {
      onError: onFailure,
      onSuccess: () => {
        say(copy.ready.toast.unapproved);
      },
    });
  };

  const saveAnswer = (card: ReadyCardData, answer: ReadyAnswer, value: string) => {
    editAnswer.mutate(
      { applicationId: card.id, questionId: answer.questionId, value },
      {
        onError: onFailure,
        onSuccess: () => {
          setEditing(null);
          say(copy.ready.toast.saved);
        },
      },
    );
  };

  return (
    <div className="board ready">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-serif text-[15px] italic text-muted-foreground">{dateLine()}</p>
          <h1 className="mt-0.5 font-serif text-[32px] leading-[1.05] md:text-[42px]">
            {copy.ready.titlePlain} <span className="italic">{copy.ready.titleItalic}</span>
          </h1>
          <p className="mt-2 text-[14px] leading-[1.5] text-muted-foreground">{copy.ready.lead}</p>
        </div>
        <ThemeToggle className="hidden h-10 w-10 flex-none items-center justify-center rounded-md border border-input bg-card hover:bg-muted md:flex" />
      </header>
      <ThemeToggle className="mt-4 flex h-11 w-11 items-center justify-center rounded-md border border-input bg-card hover:bg-muted md:hidden" />

      <section
        aria-label={copy.ready.sendAll}
        className="mt-[22px] flex flex-wrap items-center justify-between gap-x-[18px] gap-y-3 rounded-lg border border-border bg-card px-[18px] py-[14px] shadow-sh"
      >
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[14px] font-semibold leading-[1.5]">
            {copy.ready.summary(ready?.ready ?? 0, ready?.approved ?? 0)}
          </p>
          <span
            aria-hidden="true"
            className="inline-block w-1 text-[14px] leading-[1.5] text-muted-foreground"
          >
            {copy.ready.dot}
          </span>
          <button
            className="btn"
            disabled={readyCards.length === 0}
            onClick={approveEverything}
            type="button"
          >
            {copy.ready.sendAll}
          </button>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <p className="num whitespace-nowrap text-[12.5px] text-muted-foreground">
            {copy.ready.sentToday(sentToday, dailyCap)}
          </p>
          <div aria-hidden="true" className="h-[5px] w-[110px] rounded-[3px] bg-border">
            <div
              className="h-full rounded-[3px] bg-foreground"
              style={{ width: `${String(fill)}%` }}
            />
          </div>
        </div>
      </section>

      {cards.length === 0 ? (
        <div className="mt-[22px] flex flex-col items-start gap-1.5 rounded-lg border border-border bg-card px-6 py-7 shadow-sh">
          <p className="font-serif text-[26px] leading-[1.15]">{copy.ready.emptyTitle}</p>
          <p className="text-[13.5px] text-muted-foreground">{copy.ready.emptyBody}</p>
        </div>
      ) : (
        <section aria-label="Applications ready to send" className="mt-[18px] flex flex-col gap-4">
          {cards.map((card, index) => (
            <ReadyCard
              card={card}
              editing={
                editing !== null && editing.applicationId === card.id
                  ? { questionId: editing.questionId }
                  : null
              }
              expanded={expandedId === null ? index === 0 : expandedId === card.id}
              key={card.id}
              onApprove={approveCard}
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
              onUnapprove={unapproveCard}
              saving={editAnswer.isPending}
              timeZone={zone}
            />
          ))}
        </section>
      )}

      {toast === null ? null : (
        <div
          aria-live="polite"
          className="fixed bottom-20 left-1/2 z-40 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-md border border-input bg-card py-1 pl-4 pr-4 text-[13px] font-semibold shadow-lift md:bottom-6"
        >
          <span>{toast}</span>
          <button
            className="min-h-10 px-2 text-[13px] font-semibold underline underline-offset-2"
            onClick={() => {
              setToast(null);
            }}
            type="button"
          >
            {copy.ready.dismiss}
          </button>
        </div>
      )}
    </div>
  );
}
