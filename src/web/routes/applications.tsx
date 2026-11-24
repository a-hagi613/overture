import { lazy } from "react";
import { useSearchParams } from "react-router";

const BoardPage = lazy(async () => {
  const loaded = await import("./board.tsx");

  return { default: loaded.BoardPage };
});

const CalendarPage = lazy(async () => {
  const loaded = await import("./calendar.tsx");

  return { default: loaded.CalendarPage };
});

/**
 * The canonical Applications destination.
 *
 * `?view=calendar` mounts the month grid; board is the default until WS-15 adds
 * the List | Board | Calendar switch. Unknown views fall back to the board.
 *
 * @returns The board, or the month grid when the URL asks for the calendar view.
 */
export function ApplicationsPage() {
  const [searchParams] = useSearchParams();

  if (searchParams.get("view") === "calendar") {
    return <CalendarPage />;
  }

  return <BoardPage />;
}
