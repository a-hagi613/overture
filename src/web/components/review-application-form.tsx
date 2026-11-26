import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, SkipForward, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { answerReviewBatch, dismissReview, sharedApplicationCount } from "../lib/review-api.ts";
import type { ReviewApplicationGroup } from "../lib/review-api.ts";
import { ReviewQuestionSection } from "./review-question-section.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { dsBody, dsCardTitle, dsMono } from "./ui/ds.ts";
import { SlideOverDrawer } from "./ui/slide-over-drawer.tsx";
import { Switch } from "./ui/switch.tsx";

export interface ReviewDrawerProps {
  count: number;
  group: ReviewApplicationGroup | null;
  index: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSaved: (applicationId: string) => Promise<void>;
}

function initialDrafts(group: ReviewApplicationGroup) {
  const drafts: Record<string, string> = {};

  for (const question of group.questions) {
    drafts[question.id] = "";
  }

  return drafts;
}

function defaultsToSaving(group: ReviewApplicationGroup) {
  return group.questions.every((question) => question.saveForFutureDefault);
}

function saveNoteFor(saveForFuture: boolean, mixedDefaults: boolean) {
  if (saveForFuture) {
    return copy.review.saveForFutureFormOn;
  }

  return mixedDefaults ? copy.review.saveForFutureFormMixed : copy.review.saveForFutureFormOff;
}

/**
 * One form for every question of a single Application. Shared questions are
 * answered here once and fill the other Applications waiting on them.
 * @param props The Application group, position, navigation and save callbacks.
 * @param props.count The number of Applications in the current list.
 * @param props.group The active Application and its open questions.
 * @param props.index The active Application's list position.
 * @param props.onClose Closes the form.
 * @param props.onNext Steps to the next Application.
 * @param props.onPrev Steps to the previous Application.
 * @param props.onSaved Runs after a successful save or skip.
 * @returns Slide-over form dialog for the Application's open questions.
 */
export function ReviewApplicationForm(
  props: ReviewDrawerProps & { group: ReviewApplicationGroup },
) {
  const { count, group, index, onClose, onNext, onPrev, onSaved } = props;
  const [drafts, setDrafts] = useState(() => initialDrafts(group));
  const [saveForFuture, setSaveForFuture] = useState(() => defaultsToSaving(group));
  const [pending, setPending] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { questions } = group;
  const complete = questions.every((question) => (drafts[question.id] ?? "").trim() !== "");
  const mixedDefaults = questions.some((question) => !question.saveForFutureDefault);
  const saveNote = saveNoteFor(saveForFuture, mixedDefaults);

  const refresh = async () => {
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
    if (!complete || pending) {
      return;
    }

    setPending(true);

    try {
      const result = await answerReviewBatch(
        questions.map((question) => ({
          reviewId: question.id,
          saveForFuture,
          value: (drafts[question.id] ?? "").trim(),
        })),
      );

      if (result.readyCount > 0) {
        toast.success(copy.review.savedGroupReady(result.readyCount), {
          action: {
            label: copy.review.openReady,
            onClick: () => {
              void navigate("/ready");
            },
          },
        });
      } else {
        toast.success(copy.review.savedGroupScoped);
      }

      await onSaved(group.applicationId);
      await refresh();
    } catch {
      toast.error(copy.review.saveFailed);
      setPending(false);
    }
  };

  const skip = async () => {
    if (pending) {
      return;
    }

    setPending(true);

    try {
      await Promise.all(questions.map(async (question) => dismissReview(question.id)));
      toast.success(copy.review.dismissedToast);
      await onSaved(group.applicationId);
      await refresh();
    } catch {
      toast.error(copy.review.dismissFailed);
      setPending(false);
    }
  };

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

      <h2 className={`${dsCardTitle} mt-3 break-words`}>{group.company}</h2>
      <p className="mt-0.5 break-words text-sm text-muted-foreground">{group.title}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge className="tabular-nums" variant="secondary">
          {copy.review.applicationQuestions(questions.length)}
        </Badge>
        <Badge variant="outline">{copy.review.needsYou}</Badge>
      </div>
    </div>
  );

  const footer = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="max-md:flex-1"
          disabled={pending || !complete}
          onClick={() => {
            void save();
          }}
          size="sm"
          variant="primary"
        >
          <Check aria-hidden="true" size={14} />
          <span>{pending ? copy.review.savingAnswers : copy.review.saveAndContinue}</span>
        </Button>
        <Button
          disabled={pending}
          onClick={() => {
            void skip();
          }}
          size="sm"
          variant="ghost"
        >
          <SkipForward aria-hidden="true" size={14} />
          <span>{copy.review.skipApplication}</span>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {complete ? copy.review.skipApplicationNote : copy.review.answerEveryQuestion}
      </p>
    </div>
  );

  return (
    <SlideOverDrawer
      description={copy.review.formIntro}
      footer={footer}
      header={header}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
      title={`${copy.review.drawerAria}: ${group.company}`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className={dsBody}>{copy.review.formIntro}</p>

        {questions.map((question, position) => (
          <ReviewQuestionSection
            key={question.id}
            onChange={(value) => {
              setDrafts((current) => ({ ...current, [question.id]: value }));
            }}
            position={position}
            question={question}
            sharedNumber={sharedApplicationCount(question, group.applicationId)}
            total={questions.length}
            value={drafts[question.id] ?? ""}
          />
        ))}

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/25 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="block text-sm font-medium text-foreground">
              {copy.review.saveForFutureForm}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground" id="review-save-for-future-note">
              {saveNote}
            </p>
          </div>
          <Switch
            ariaLabel={copy.review.saveForFutureForm}
            checked={saveForFuture}
            onCheckedChange={setSaveForFuture}
          />
        </div>
      </form>
    </SlideOverDrawer>
  );
}
