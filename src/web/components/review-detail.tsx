import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { Review } from "../lib/review-api";

import { copy } from "../../shared/copy.ts";
import { factLabelFor } from "../../shared/facts.ts";
import { answerReview, dismissReview } from "../lib/review-api.ts";
import { ReviewAnswer } from "./review-answer.tsx";

export function ReviewDetail({
  review,
  position,
  total,
  onResolved,
}: {
  review: Review;
  position: number;
  total: number;
  onResolved: () => void;
}) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const queryClient = useQueryClient();

  async function refresh() {
    onResolved();
    await queryClient.invalidateQueries({ queryKey: ["reviews"] });
    await queryClient.invalidateQueries({ queryKey: ["home"] });
  }

  async function save() {
    if (value.trim() === "" || pending) {
      return;
    }

    setPending(true);

    const saved = await answerReview(review.id, value.trim())
      .then(() => true)
      .catch(() => false);

    if (saved) {
      await refresh();
    }

    setPending(false);
  }

  async function dismiss() {
    if (pending) {
      return;
    }

    setPending(true);

    const dismissed = await dismissReview(review.id)
      .then(() => true)
      .catch(() => false);

    if (dismissed) {
      await refresh();
    }

    setPending(false);
  }

  const factLabel = review.factKey === null ? null : factLabelFor(review.factKey);

  return (
    <section
      aria-labelledby="rev-q"
      className="min-w-0 flex-[999_1_500px] rounded-lg border border-border bg-card p-[20px_16px_18px] shadow-sh md:p-[26px_28px_24px]"
    >
      <button
        className="-ml-2.5 mb-2 inline-flex min-h-11 items-center gap-2 rounded-md px-2.5 text-[13.5px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
        onClick={onResolved}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="16"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
          width="16"
        >
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
        {copy.review.back}
      </button>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center rounded-full bg-need-soft px-2.5 py-0.5 text-[11.5px] font-semibold text-need">
            {copy.review.needsYou}
          </span>
          <span className="text-[11px] font-semibold uppercase leading-[13px] tracking-[.15em] text-muted-foreground">
            {copy.review.categories[review.category]}
          </span>
        </div>
        <span className="font-serif text-sm italic text-muted-foreground">
          {copy.review.questionOf(position, total)}
        </span>
      </div>
      <h2
        className="mt-4 font-serif text-[30px] leading-[1.08] md:text-[36px] min-[1700px]:text-[42px]"
        id="rev-q"
      >
        {review.prompt}
      </h2>
      <p className="mt-2.5 max-w-[62ch] text-sm leading-[1.5] text-muted-foreground">
        {copy.review.detailNote(review.unlocked)}
      </p>
      <div className="mt-[22px] grid grid-cols-2 border-y border-border">
        <div className="py-3.5 pr-4">
          <p className="text-[11px] font-semibold uppercase leading-[13px] tracking-[.15em] text-muted-foreground">
            {copy.review.unlocks}
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="font-serif text-[44px] leading-none tabular-nums">
              {review.unlocked}
            </span>
            <span className="text-[13.5px] font-semibold">{copy.review.jobs}</span>
          </p>
        </div>
        <div className="border-l border-border py-3.5 pl-5">
          <p className="text-[11px] font-semibold uppercase leading-[13px] tracking-[.15em] text-muted-foreground">
            {copy.review.askedBy}
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="font-serif text-[44px] leading-none tabular-nums">
              {review.companies}
            </span>
            <span className="text-[13.5px] font-semibold">{copy.review.companies}</span>
          </p>
        </div>
      </div>
      <h3 className="mt-6 text-[11px] font-semibold uppercase leading-[13px] tracking-[.15em] text-muted-foreground">
        {copy.review.queued}
      </h3>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {review.applications.map((application) => (
          <span
            className="inline-flex min-h-[34px] max-w-full items-center gap-2 rounded-full border border-input bg-card py-[5px] pl-1.5 pr-[13px] text-[13px]"
            key={application.applicationId}
          >
            <span
              aria-hidden="true"
              className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[5px] bg-foreground font-serif text-[14px] italic text-background"
            >
              {application.company.slice(0, 1)}
            </span>
            <span className="min-w-0">
              <b className="font-semibold">{application.company}</b>
              {" · "}
              {application.title}
            </span>
          </span>
        ))}
      </div>
      <div className="mt-[26px] rounded-lg border border-border bg-background px-[18px] py-4">
        <h3 className="text-[11px] font-semibold uppercase leading-[13px] tracking-[.15em] text-muted-foreground">
          {copy.review.closestFact}
        </h3>
        <p className="mt-2 max-w-[56ch] text-sm leading-[1.5] text-muted-foreground">
          {factLabel === null
            ? copy.review.closestFactNote
            : copy.review.closestFactKnown(factLabel)}
        </p>
      </div>
      <div className="mt-[22px]">
        <p className="block text-[12.5px] font-semibold leading-[16px]" id="rev-lbl">
          {copy.review.yourAnswer}
        </p>
        <ReviewAnswer onChange={setValue} review={review} value={value} />
        <p className="mt-2 text-[12.5px] leading-[1.5] text-muted-foreground">
          {copy.review.answerNote}
        </p>
      </div>
      <div className="mt-[22px] flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <button
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-foreground bg-foreground px-[22px] text-[13.5px] font-semibold text-primary-ink hover:bg-btn-hover disabled:opacity-[.45] max-md:min-h-12 max-md:flex-[1_1_100%]"
          disabled={pending}
          onClick={() => {
            void save();
          }}
          type="button"
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="16"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
            width="16"
          >
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          {copy.review.save(review.unlocked)}
        </button>
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-card px-4 text-[13.5px] font-semibold hover:bg-muted disabled:opacity-[.45] max-md:min-h-12 max-md:flex-[1_1_100%]"
          disabled={pending}
          onClick={() => {
            void dismiss();
          }}
          type="button"
        >
          {copy.review.dismiss}
        </button>
        <p className="flex-[1_1_220px] text-[12.5px] leading-[1.5] text-muted-foreground">
          {copy.review.dismissNote(review.unlocked)}
        </p>
      </div>
    </section>
  );
}
