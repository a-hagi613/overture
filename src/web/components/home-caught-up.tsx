import { copy } from "../../shared/copy.ts";
import { StatusStrip } from "./ui/status-strip.tsx";

export function HomeCaughtUp() {
  return (
    <StatusStrip
      ariaLabelledBy="home-caught-up"
      className="mt-3"
      dataTestId="home-caught-up"
      description={copy.home.control.readyEmptyDetail}
      title={copy.home.control.readyEmptyTitle}
      titleId="home-caught-up"
    />
  );
}
