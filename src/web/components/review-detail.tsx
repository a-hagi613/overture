import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import type { Review } from "../lib/review-api";

import { copy } from "../../shared/copy.ts";
import { answerReview, dismissReview } from "../lib/review-api.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { ReviewAnswer } from "./review-answer.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsEyebrow } from "./ui/ds.ts";
import { Separator } from "./ui/separator.tsx";
import { Switch } from "./ui/switch.tsx";

export function ReviewDetail({
  hiddenOnMobile = false,
  onBack,
  review,
  position,
  total,
  onResolved,
}: {
  hiddenOnMobile?: boolean;
  onBack: () => void;
  review: Review;
  position: number;
  total: number;
  onResolved: (id: string) => void;
}) {
  const [value, setValue] = useState("");
  const [saveForFuture, setSaveForFuture] = useState(review.saveForFutureDefault);
  const [pending, setPending] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function refresh() {
    onResolved(review.id);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["reviews"] }),
      queryClient.invalidateQueries({ queryKey: ["home"] }),
      queryClient.invalidateQueries({ queryKey: ["board"] }),
      queryClient.invalidateQueries({ queryKey: ["ready"] }),
      queryClient.invalidateQueries({ queryKey: ["nav"] }),
      queryClient.invalidateQueries({ queryKey: ["profile-facts"] }),
    ]);
  }

  async function save() {
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
  }

  async function dismiss() {
    if (pending) {
      return;
    }

    setPending(true);

    try {
      await dismissReview(review.id);
      toast.success("Question skipped.");
      await refresh();
    } catch {
      toast.error(copy.review.dismissFailed);
    }

    setPending(false);
  }

  const { factLabel } = review;

  return (
    <Card
      ariaLabelledBy="rev-q"
      className={
        hiddenOnMobile
          ? "min-w-0 flex-[999_1_520px] p-5 max-md:hidden md:p-7"
          : "min-w-0 flex-[999_1_520px] p-5 md:p-7"
      }
      variant="elevated"
    >
      <Button
        className="-ml-2 mb-3 max-md:min-h-11 md:hidden"
        onClick={onBack}
        size="sm"
        variant="ghost"
      >
        <ArrowLeft aria-hidden="true" size={15} />
        <span>{copy.review.back}</span>
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="signal">{copy.review.blockedBadge}</Badge>
          <Badge variant="outline">{copy.review.categories[review.category]}</Badge>
        </div>
        <span className="font-serif text-sm italic text-muted-foreground">
          {copy.review.questionOf(position, total)}
        </span>
      </div>

      <div className="mt-5">
        <p className={dsEyebrow}>{copy.review.blockedRolesTitle(review.applications.length)}</p>
        <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {review.applications.map((application) => (
            <Card
              className="flex items-center gap-3 border-border bg-background p-3.5 shadow-none"
              key={application.applicationId}
            >
              <CompanyAvatar company={application.company} tone="signal" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {application.company}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{application.title}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <Separator className="my-5" />

      <Card className="border-border bg-background p-4 shadow-none md:p-5">
        <p className={`${dsEyebrow} text-signal-text`}>{copy.review.missingFieldEyebrow}</p>
        <h2 className="mt-1.5 font-serif text-page-title leading-tight text-foreground" id="rev-q">
          {review.prompt}
        </h2>
        <p className={`${dsBody} mt-2`}>
          {factLabel === null
            ? copy.review.detailNote(review.unlocked)
            : copy.review.closestFactKnown(factLabel)}
        </p>
      </Card>

      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="mb-2 block text-xs font-semibold text-foreground" id="rev-lbl">
          {copy.review.yourAnswer}
        </p>
        <ReviewAnswer field={review} onChange={setValue} value={value} />

        <div className="mt-4 rounded-lg border border-border bg-background p-3.5">
          <div className="flex items-start gap-3">
            <Switch
              ariaLabel={copy.review.saveForFuture.label}
              checked={saveForFuture}
              id="review-save-for-future"
              onCheckedChange={setSaveForFuture}
            />
            <div className="min-w-0">
              <label
                className="block cursor-pointer text-sm font-semibold text-foreground"
                htmlFor="review-save-for-future"
              >
                {copy.review.saveForFuture.label}
              </label>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {saveForFuture
                  ? copy.review.saveForFuture.onNote
                  : copy.review.saveForFuture.offNote}
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {review.saveForFutureDefault
              ? copy.review.saveForFuture.reusableNote
              : copy.review.saveForFuture.specificNote}
          </p>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {copy.review.answerNote}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
          <Button
            className="max-md:w-full"
            disabled={pending || value.trim() === ""}
            size="default"
            submit
            variant="primary"
          >
            <Check aria-hidden="true" size={16} />
            <span>{copy.review.saveUnblock(review.applications.length)}</span>
          </Button>
          <Button
            className="max-md:w-full"
            disabled={pending}
            onClick={() => {
              void dismiss();
            }}
            size="default"
            variant="outline"
          >
            {copy.review.dismiss}
          </Button>
          <p className="flex-[1_1_200px] text-xs leading-relaxed text-muted-foreground">
            {copy.review.dismissNote(review.unlocked)}
          </p>
        </div>
      </form>
    </Card>
  );
}
