import { copy } from "../../shared/copy.ts";
import { timeText } from "../lib/home-time.ts";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";

export function HomeQueue(props: { position: number | null; sendAt: number | null; zone: string }) {
  const { position, sendAt, zone } = props;

  return (
    <Card ariaLabelledBy="home-queue" className="min-w-0 flex-1 p-5 md:p-6">
      <p className={dsEyebrow}>{copy.home.queue.eyebrow}</p>
      <h2 className={`${dsCardTitle} mt-2`} id="home-queue">
        {position === null ? copy.home.queue.noPosition : copy.home.queue.inLine(position)}{" "}
        <span className="italic">{copy.home.queue.inLineTail}</span>
      </h2>
      <p className={`${dsBody} mt-1.5`}>
        {sendAt === null ? copy.home.queue.waiting : copy.home.queue.nextAt(timeText(sendAt, zone))}
      </p>
    </Card>
  );
}
