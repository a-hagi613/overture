import { copy } from "../../shared/copy.ts";
import { timeText } from "../lib/home-time.ts";
import { StatusStrip } from "./ui/status-strip.tsx";

export function HomeQueue(props: { position: number | null; sendAt: number | null; zone: string }) {
  const { position, sendAt, zone } = props;

  const title =
    position === null
      ? copy.home.queue.noPosition
      : `${copy.home.queue.inLine(position)} ${copy.home.queue.inLineTail}`;

  const description =
    sendAt === null ? copy.home.queue.waiting : copy.home.queue.nextAt(timeText(sendAt, zone));

  return (
    <StatusStrip
      ariaLabelledBy="home-queue"
      className="mt-3"
      description={description}
      title={title}
      titleId="home-queue"
    />
  );
}
