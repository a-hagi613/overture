import { useState } from "react";

import type { CheckinAnswer } from "../../shared/checkins.ts";
import type { HomeCheckin } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { useAnswerCheckIn } from "../lib/home-api.ts";

const ANSWERS: { answer: CheckinAnswer; label: string }[] = [
  { answer: "rejected", label: copy.home.checkIn.rejected },
  { answer: "interviewing", label: copy.home.checkIn.interviewing },
  { answer: "still_waiting", label: copy.home.checkIn.stillWaiting },
];

const BUTTON =
  "inline-flex min-h-10 max-[767px]:min-h-11 items-center justify-center rounded-md border border-input bg-card px-3 text-[13px] font-semibold hover:bg-muted disabled:opacity-60";

export function HomeCheckIn({ checkIns }: { checkIns: HomeCheckin[] }) {
  const answer = useAnswerCheckIn();
  const [started, setStarted] = useState(false);

  return (
    <section
      aria-labelledby="home-checkin"
      className="flex min-w-0 flex-[2_1_420px] flex-wrap items-center justify-between gap-x-5 gap-y-3.5 rounded-lg border border-border bg-card px-4 pt-[22px] pb-5 shadow-sh min-[768px]:px-6"
    >
      <div className="min-w-0">
        <p className="text-[11px] font-semibold tracking-[0.15em] text-muted-foreground uppercase leading-[normal]">
          {copy.home.checkIn.eyebrow}
        </p>
        <h2 className="mt-2 font-serif text-[26px] leading-[1.15]" id="home-checkin">
          {copy.home.checkIn.title}
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">
          {copy.home.checkIn.note}
        </p>
      </div>
      {started ? (
        <ul className="flex w-full list-none flex-col gap-3">
          {checkIns.map((checkIn) => (
            <li
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-border border-t pt-3 first:border-t-0 first:pt-0"
              key={checkIn.id}
            >
              <div className="min-w-0">
                <p className="font-serif text-[18px] leading-[1.25]">{checkIn.title}</p>
                <p className="text-[12.5px] leading-[1.5] text-muted-foreground">
                  {`${checkIn.company} · ${copy.home.checkIn.row(checkIn.days)}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {ANSWERS.map(({ answer: value, label }) => (
                  <button
                    aria-label={copy.home.checkIn.answerAria(label, checkIn.company, checkIn.title)}
                    className={BUTTON}
                    disabled={answer.isPending}
                    key={value}
                    onClick={() => {
                      answer.mutate({ answer: value, id: checkIn.id });
                    }}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <button
          className="inline-flex min-h-10 max-[767px]:min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-card px-4 text-[13.5px] font-semibold hover:bg-muted"
          onClick={() => {
            setStarted(true);
          }}
          type="button"
        >
          {copy.home.checkIn.start}
        </button>
      )}
      {answer.isError ? (
        <p className="w-full text-[12.5px] leading-[1.5] text-destructive" role="alert">
          {copy.home.checkIn.failed}
        </p>
      ) : null}
    </section>
  );
}
