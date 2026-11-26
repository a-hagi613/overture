import { copy } from "../../shared/copy.ts";
import type { ReviewApplicationGroup } from "../lib/review-api.ts";
import { sharedApplicationCount } from "../lib/review-api.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody } from "./ui/ds.ts";

/**
 * One Application waiting on Review answers: employer, role, how many questions
 * it needs and the first question, with one Answer action that opens the form.
 * @param props The Application group and its open handler.
 * @param props.group The Application and its open questions.
 * @param props.onOpen Opens the Application form.
 * @returns Review Application card.
 */
export function ReviewApplicationCard({
  group,
  onOpen,
}: {
  group: ReviewApplicationGroup;
  onOpen: (group: ReviewApplicationGroup) => void;
}) {
  const shared = group.questions.filter(
    (question) => sharedApplicationCount(question, group.applicationId) > 0,
  ).length;

  const [first] = group.questions;
  const questionCount = group.questions.length;

  return (
    <li>
      <Card className="p-4 sm:p-5" variant="interactive">
        <div className="flex items-start gap-3">
          <CompanyAvatar company={group.company} />

          <div className="min-w-0 flex-1">
            <h2 className="min-w-0 text-sm font-semibold text-foreground">
              <button
                className="block line-clamp-2 w-full cursor-pointer break-words rounded-md text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                onClick={() => {
                  onOpen(group);
                }}
                type="button"
              >
                {group.company}
                {" · "}
                {group.title}
              </button>
            </h2>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge className="tabular-nums" variant="secondary">
                {copy.review.applicationQuestions(questionCount)}
              </Badge>
              {shared > 0 ? (
                <Badge variant="outline">{copy.review.applicationShared(shared)}</Badge>
              ) : null}
            </div>

            {first === undefined ? null : (
              <p className={`${dsBody} mt-2 line-clamp-2`}>
                {copy.review.applicationNext(first.prompt)}
              </p>
            )}
          </div>

          <Button
            ariaLabel={copy.review.openApplication(group.company, group.title)}
            className="shrink-0"
            onClick={() => {
              onOpen(group);
            }}
            size="sm"
            variant="primary"
          >
            {copy.review.answerApplication}
          </Button>
        </div>
      </Card>
    </li>
  );
}
