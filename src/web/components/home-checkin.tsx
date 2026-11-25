import { useState } from "react";

import type { CheckinAnswer } from "../../shared/checkins.ts";
import type { HomeCheckin } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { useAnswerCheckIn } from "../lib/home-api.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";

const ANSWERS: { answer: CheckinAnswer; label: string }[] = [
  { answer: "rejected", label: copy.home.checkIn.rejected },
  { answer: "interviewing", label: copy.home.checkIn.interviewing },
  { answer: "still_waiting", label: copy.home.checkIn.stillWaiting },
];

export function HomeCheckIn({ checkIns }: { checkIns: HomeCheckin[] }) {
  const answer = useAnswerCheckIn();
  const [started, setStarted] = useState(false);

  return (
    <Card
      ariaLabelledBy="home-checkin"
      className="flex min-w-0 flex-[2_1_420px] flex-wrap items-center justify-between gap-x-5 gap-y-3.5 p-5 md:p-6"
    >
      <div className="min-w-0">
        <p className={dsEyebrow}>{copy.home.checkIn.eyebrow}</p>
        <h2 className={`${dsCardTitle} mt-2`} id="home-checkin">
          {copy.home.checkIn.title}
        </h2>
        <p className={`${dsBody} mt-1.5`}>{copy.home.checkIn.note}</p>
      </div>
      {started ? (
        <ul className="flex w-full list-none flex-col divide-y divide-border p-0">
          {checkIns.map((checkIn) => (
            <li
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
              key={checkIn.id}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug text-foreground">
                  {checkIn.title}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {`${checkIn.company} · ${copy.home.checkIn.row(checkIn.days)}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {ANSWERS.map(({ answer: value, label }) => (
                  <Button
                    ariaLabel={copy.home.checkIn.answerAria(label, checkIn.company, checkIn.title)}
                    disabled={answer.isPending}
                    key={value}
                    onClick={() => {
                      answer.mutate({ answer: value, id: checkIn.id });
                    }}
                    size="sm"
                    variant="secondary"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Button
          onClick={() => {
            setStarted(true);
          }}
          size="default"
          variant="secondary"
        >
          {copy.home.checkIn.start}
        </Button>
      )}
      {answer.isError ? (
        <p className="w-full text-xs leading-relaxed text-need" role="alert">
          {copy.home.checkIn.failed}
        </p>
      ) : null}
    </Card>
  );
}
