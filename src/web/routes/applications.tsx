import { lazy } from "react";
import { useSearchParams } from "react-router";

import { copy } from "../../shared/copy.ts";
import { PageHeader } from "../components/page-header.tsx";
import { SegmentedControl } from "../components/ui/segmented-control.tsx";
import { SegmentedControlItem } from "../components/ui/segmented-control-item.tsx";
import { useMediaQuery } from "../lib/media-query.ts";

const BoardPage = lazy(async () => {
  const loaded = await import("./board.tsx");

  return { default: loaded.BoardPage };
});

const CalendarPage = lazy(async () => {
  const loaded = await import("./calendar.tsx");

  return { default: loaded.CalendarPage };
});

type ApplicationsView = "board" | "list" | "calendar";

function viewFrom(value: string | null) {
  if (value === "board" || value === "list" || value === "calendar") {
    return value;
  }

  return null;
}

function leadFor(view: ApplicationsView) {
  if (view === "calendar") {
    return copy.calendar.lead;
  }

  if (view === "list") {
    return copy.board.listLead;
  }

  return copy.board.trackerLead;
}

/**
 * The canonical Applications destination.
 *
 * One view at a time, chosen by `?view=board|list|calendar`. With no view in the
 * URL the desktop opens the Board and the phone opens the scannable List; the
 * Board stays one tap away on the phone. The page header and the switcher are
 * rendered here once so the Calendar does not repeat the page chrome.
 *
 * @returns The header, the view switcher and the selected view.
 */
export function ApplicationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const requested = viewFrom(searchParams.get("view"));
  const view: ApplicationsView = requested ?? (desktop ? "board" : "list");

  const changeView = (next: string) => {
    const target = viewFrom(next);

    if (target === null) {
      return;
    }

    const params = new URLSearchParams(searchParams);

    params.set("view", target);

    if (target === "calendar") {
      params.delete("filter");
    } else {
      params.delete("month");
    }

    setSearchParams(params, { replace: true });
  };

  const calendar = view === "calendar";
  const lead = leadFor(view);

  return (
    <div>
      <PageHeader
        lead={lead}
        titleNode={
          calendar ? (
            <>
              {copy.calendar.titlePlain}{" "}
              <em className="italic text-signal">{copy.calendar.titleItalic}</em>
            </>
          ) : (
            <>
              {copy.board.trackerTitlePlain}{" "}
              <em className="italic text-signal">{copy.board.trackerTitleItalic}</em>
            </>
          )
        }
      />

      <SegmentedControl
        ariaLabel={copy.board.views.label}
        className="mt-5 w-full gap-1 md:w-auto"
        onValueChange={changeView}
        value={view}
      >
        <SegmentedControlItem className="flex-1 md:flex-none" value="board">
          {copy.board.views.board}
        </SegmentedControlItem>
        <SegmentedControlItem className="flex-1 md:flex-none" value="list">
          {copy.board.views.list}
        </SegmentedControlItem>
        <SegmentedControlItem className="flex-1 md:flex-none" value="calendar">
          {copy.board.views.calendar}
        </SegmentedControlItem>
      </SegmentedControl>

      {calendar ? <CalendarPage /> : <BoardPage view={view} />}
    </div>
  );
}
