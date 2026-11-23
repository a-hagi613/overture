import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check } from "lucide-react";
import { useState } from "react";
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

export function ReviewDetail({
  review,
  position,
  total,
  onResolved,
}: {
  review: Review;
  position: number;
  total: number;
  onResolved: (id: string) => void;
}) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const queryClient = useQueryClient();

  async function refresh() {
    onResolved(review.id);
    await queryClient.invalidateQueries({ queryKey: ["reviews"] });
    await queryClient.invalidateQueries({ queryKey: ["home"] });
    await queryClient.invalidateQueries({ queryKey: ["board"] });
    await queryClient.invalidateQueries({ queryKey: ["ready"] });
  }

  async function save() {
    if (value.trim() === "" || pending) {
      return;
    }

    setPending(true);

    const companyNames = review.applications.map((app) => app.company).join(" & ");

    await answerReview(review.id, value.trim()).catch(() => false);
    toast.success(`Answer saved — ${companyNames} unblocked.`);
    await refresh();

    setPending(false);
  }

  async function dismiss() {
    if (pending) {
      return;
    }

    setPending(true);

    await dismissReview(review.id).catch(() => false);
    toast.success("Question skipped.");
    await refresh();

    setPending(false);
  }

  const { factLabel } = review;

  return (
    <Card
      ariaLabelledBy="rev-q"
      className="min-w-0 flex-[999_1_520px] p-5 md:p-7"
      variant="elevated"
    >
      <Button
        className="-ml-2 mb-3 md:hidden"
        onClick={() => {
          onResolved(review.id);
        }}
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
