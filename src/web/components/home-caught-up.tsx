import { copy } from "../../shared/copy.ts";
import { timeText } from "../lib/home-time.ts";
import { dsMono } from "./ui/ds.ts";
import { StatusStrip } from "./ui/status-strip.tsx";

export function HomeCaughtUp(props: { nextPrepAt: number; zone: string }) {
  const { nextPrepAt, zone } = props;

  return (
    <StatusStrip
      action={
        <span className={`${dsMono} text-foreground`}>
          {`${copy.home.caughtUp.nextLabel} ${timeText(nextPrepAt, zone)}`}
        </span>
      }
      ariaLabelledBy="home-caught-up"
      className="mt-3"
      dataTestId="home-caught-up"
      description={copy.home.control.readyEmptyDetail}
      title={copy.home.control.readyEmptyTitle}
      titleId="home-caught-up"
    />
  );
}
