import { copy } from "../../shared/copy.ts";
import type { Review } from "../lib/review-api.ts";
import { ReviewAnswer } from "./review-answer.tsx";
import { Badge } from "./ui/badge.tsx";
import { dsCardTitle, dsMono } from "./ui/ds.ts";

/**
 * One numbered question inside an Application form: topic, shared-use badge,
 * prompt and the interactive answer control.
 * @param props The question, its position and current answer.
 * @param props.question The Review question to render.
 * @param props.position Zero-based position in the form.
 * @param props.total Number of questions in the form.
 * @param props.sharedNumber Number of other Applications the answer also fills.
 * @param props.value The current answer.
 * @param props.onChange Receives the new answer.
 * @returns Question section with a visible heading and an input.
 */
export function ReviewQuestionSection({
  onChange,
  position,
  question,
  sharedNumber,
  total,
  value,
}: {
  onChange: (value: string) => void;
  position: number;
  question: Review;
  sharedNumber: number;
  total: number;
  value: string;
}) {
  const headingId = `rev-q-${question.id}`;

  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={dsMono}>{copy.review.questionPosition(position + 1, total)}</span>
        <Badge variant="secondary">{copy.review.categories[question.category]}</Badge>
        {sharedNumber > 0 ? (
          <Badge variant="outline">{copy.review.alsoUsedFor(sharedNumber)}</Badge>
        ) : null}
      </div>

      <h3 className={`${dsCardTitle} mt-2 break-words`} id={headingId}>
        {question.prompt}
      </h3>

      {question.factLabel === null ? null : (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {copy.review.closestFactKnown(question.factLabel)}
        </p>
      )}

      <div className="mt-2.5">
        <ReviewAnswer
          field={question}
          label={question.prompt}
          labelledBy={headingId}
          onChange={onChange}
          value={value}
        />
      </div>
    </section>
  );
}
