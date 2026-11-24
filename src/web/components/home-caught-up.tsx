import { copy } from "../../shared/copy.ts";
import { timeText } from "../lib/home-time.ts";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsMono } from "./ui/ds.ts";

export function HomeCaughtUp(props: { nextPrepAt: number; zone: string }) {
  const { nextPrepAt, zone } = props;

  return (
    <Card ariaLabelledBy="home-caught-up" className="mt-5 p-5 md:p-6" dataTestId="home-caught-up">
      <h2 className={dsCardTitle} id="home-caught-up">
        {copy.home.control.readyEmptyTitle}
      </h2>
      <p className={`${dsBody} mt-1.5`}>{copy.home.control.readyEmptyDetail}</p>
      <p className={`${dsBody} mt-3`}>
        {copy.home.caughtUp.nextLabel}{" "}
        <span className={`${dsMono} text-foreground`}>{timeText(nextPrepAt, zone)}</span>
      </p>
    </Card>
  );
}
