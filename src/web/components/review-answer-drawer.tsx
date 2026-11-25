import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { OPTION_FIELD_TYPES } from "../../shared/questions.ts";
import { answerReview, dismissReview } from "../lib/review-api.ts";
import type { Review } from "../lib/review-api.ts";
import { ReviewAffectedApps } from "./review-affected-apps.tsx";
import { ReviewAnswer } from "./review-answer.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { dsCardTitle, dsEyebrow, dsMono } from "./ui/ds.ts";
import { SlideOverDrawer } from "./ui/slide-over-drawer.tsx";
import { Switch } from "./ui/switch.tsx";

interface AnswerDraft {
  forId: string;
  saveForFuture: boolean;
  touchedReuse: boolean;
  value: string;
}

function reuseHelperText(saveForFuture: boolean, isDefaultReusable: boolean, touched: boolean) {
  if (!touched) {
    return isDefaultReusable
      ? copy.review.saveForFuture.reusableNote
      : copy.review.saveForFuture.specificNote;
  }

  return saveForFuture ? copy.review.saveForFuture.onNote : copy.review.saveForFuture.offNote;
}

function draftFor(review: Review | null, draft: AnswerDraft | null) {
  if (review === null) {
    return { saveForFuture: false, touchedReuse: false, value: "" };
  }

  if (draft?.forId === review.id) {
    return draft;
  }

  return {
    saveForFuture: review.saveForFutureDefault,
    touchedReuse: false,
    value: "",
  };
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') !==
      null
  );
}

/**
 * Slide-over answer drawer for resolving a blocked Review question, toggling whether Overture
 * should save the answer for future forms, inspecting waiting employers, and stepping Prev/Next.
 * @param props Active Review item, queue position/count, and close/step/resolve callbacks.
 * @returns Slide-over answer drawer dialog.
 */
export function ReviewAnswerDrawer(props: {
  count: number;
  index: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  onResolved: (id: string) => void;
  review: Review | null;
}) {
  const { count, index, onClose, onNext, onPrev, onResolved, review } = props;
  const [draft, setDraft] = useState<AnswerDraft | null>(null);
  const [pending, setPending] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const currentDraft = draftFor(review, draft);
  const { saveForFuture, touchedReuse, value } = currentDraft;

  const hasOptionTiles =
    review !== null &&
    OPTION_FIELD_TYPES.some((candidate) => candidate === review.fieldType) &&
    review.options.length > 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        review === null ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      if (event.key === "ArrowLeft" && count > 1) {
        event.preventDefault();
        onPrev();

        return;
      }

      if (event.key === "ArrowRight" && count > 1) {
        event.preventDefault();
        onNext();

        return;
      }

      if (!hasOptionTiles || !/^[1-9]$/u.test(event.key)) {
        return;
      }

      const option = review.options.at(Math.trunc(Number(event.key)) - 1);

      if (option === undefined) {
        return;
      }

      event.preventDefault();

      setDraft((existing) => {
        const active = draftFor(review, existing);

        if (review.fieldType === "multiselect") {
          const chosen = active.value.split(", ").filter((part) => part !== "");

          const nextValue = chosen.includes(option)
            ? chosen.filter((part) => part !== option)
            : [...chosen, option];

          return { ...active, forId: review.id, value: nextValue.join(", ") };
        }

        return { ...active, forId: review.id, value: option };
      });
    };

    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [count, hasOptionTiles, onNext, onPrev, review]);

  if (review === null) {
    return (
      <SlideOverDrawer
        header={null}
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
        open={false}
        title={copy.review.drawerAria}
      >
        {null}
      </SlideOverDrawer>
    );
  }

  const refresh = async () => {
    onResolved(review.id);
    setDraft(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["reviews"] }),
      queryClient.invalidateQueries({ queryKey: ["home"] }),
      queryClient.invalidateQueries({ queryKey: ["board"] }),
      queryClient.invalidateQueries({ queryKey: ["ready"] }),
      queryClient.invalidateQueries({ queryKey: ["nav"] }),
      queryClient.invalidateQueries({ queryKey: ["profile-facts"] }),
    ]);
  };

  const save = async () => {
    if (value.trim() === "" || pending) {
      return;
    }

    setPending(true);

    try {
      const result = await answerReview(review.id, value.trim(), saveForFuture);

      if (result.readyCount > 0) {
        toast.success(copy.review.savedToReady(result.readyCount), {
          action: {
            label: copy.review.openReady,
            onClick: () => {
              void navigate("/ready");
            },
          },
        });
      } else {
        toast.success(copy.review.savedScoped(review.applications.length));
      }

      await refresh();
    } catch {
      toast.error(copy.review.saveFailed);
    }

    setPending(false);
  };

  const dismiss = async () => {
    if (pending) {
      return;
    }

    setPending(true);

    try {
      await dismissReview(review.id);
      toast.success(copy.review.dismissedToast);
      await refresh();
    } catch {
      toast.error(copy.review.dismissFailed);
    }

    setPending(false);
  };

  const reuseNote = reuseHelperText(saveForFuture, review.saveForFutureDefault, touchedReuse);
  const { factLabel } = review;

  const header = (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={dsMono}>{copy.review.position(index + 1, count)}</span>
          <Button
            ariaLabel={copy.review.previousAria}
            className="h-7 w-7 max-md:h-11 max-md:w-11"
            disabled={count <= 1}
            onClick={onPrev}
            size="icon"
            variant="outline"
          >
            <ChevronLeft aria-hidden="true" size={14} />
          </Button>
          <Button
            ariaLabel={copy.review.nextAria}
            className="h-7 w-7 max-md:h-11 max-md:w-11"
            disabled={count <= 1}
            onClick={onNext}
            size="icon"
            variant="outline"
          >
            <ChevronRight aria-hidden="true" size={14} />
          </Button>
        </div>
        <Button
          ariaLabel={copy.codePaste.close}
          className="h-8 w-8 max-md:h-11 max-md:w-11"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <X aria-hidden="true" size={16} />
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge className="tabular-nums" variant="signal">
          {copy.review.unlocksBadge(review.unlocked)}
        </Badge>
        <Badge variant="outline">{copy.review.categories[review.category]}</Badge>
      </div>

      <h2 className={`${dsCardTitle} mt-2.5 leading-snug`} id="rev-q">
        {review.prompt}
      </h2>

      {factLabel === null ? null : (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {copy.review.closestFactKnown(factLabel)}
        </p>
      )}
    </div>
  );

  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        className="max-md:flex-1"
        disabled={pending || value.trim() === ""}
        onClick={() => {
          void save();
        }}
        size="sm"
        variant="primary"
      >
        <Check aria-hidden="true" size={14} />
        <span>{copy.review.saveUnblock(review.applications.length)}</span>
      </Button>
      <Button
        disabled={pending}
        onClick={() => {
          void dismiss();
        }}
        size="sm"
        variant="outline"
      >
        <X aria-hidden="true" size={14} />
        <span>{copy.review.dismiss}</span>
      </Button>
    </div>
  );

  return (
    <SlideOverDrawer
      description={review.prompt}
      footer={footer}
      header={header}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
      title={copy.review.drawerAria}
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div>
          <p className={dsEyebrow} id="rev-lbl">
            {copy.review.yourAnswer}
          </p>
          <div className="mt-2.5">
            <ReviewAnswer
              field={review}
              onChange={(nextValue) => {
                setDraft({ ...currentDraft, forId: review.id, value: nextValue });
              }}
              value={value}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/25 px-4 py-3">
          <div className="min-w-0 flex-1">
            <label
              className="block cursor-pointer text-sm font-medium text-foreground"
              htmlFor="review-save-for-future"
            >
              {copy.review.saveForFuture.label}
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">{reuseNote}</p>
          </div>
          <Switch
            ariaLabel={copy.review.saveForFuture.label}
            checked={saveForFuture}
            id="review-save-for-future"
            onCheckedChange={(next) => {
              setDraft({
                ...currentDraft,
                forId: review.id,
                saveForFuture: next,
                touchedReuse: true,
              });
            }}
          />
        </div>

        <ReviewAffectedApps applications={review.applications} />
      </form>
    </SlideOverDrawer>
  );
}
