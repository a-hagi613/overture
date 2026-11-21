import { copy } from "../../shared/copy.ts";
import { timeText } from "../lib/home-time.ts";

export function HomeQueue(props: { position: number | null; sendAt: number | null; zone: string }) {
  const { position, sendAt, zone } = props;

  return (
    <section
      aria-labelledby="home-queue"
      className="min-w-0 flex-[1_1_240px] rounded-lg border border-border bg-card px-4 pt-[22px] pb-5 shadow-sh min-[768px]:px-6"
    >
      <p className="text-[11px] font-semibold tracking-[0.15em] text-muted-foreground uppercase leading-[normal]">
        {copy.home.queue.eyebrow}
      </p>
      <h2 className="mt-2 font-serif text-[30px] leading-[1.1]" id="home-queue">
        {position === null ? copy.home.queue.noPosition : copy.home.queue.inLine(position)}{" "}
        <span className="font-serif italic">{copy.home.queue.inLineTail}</span>
      </h2>
      <p className="mt-2 text-[13.5px] leading-[1.5] text-muted-foreground">
        {sendAt === null ? copy.home.queue.waiting : copy.home.queue.nextAt(timeText(sendAt, zone))}
      </p>
    </section>
  );
}
