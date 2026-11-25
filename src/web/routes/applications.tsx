import { lazy } from "react";
import { Navigate, useSearchParams } from "react-router";

import { useMediaQuery } from "../lib/media-query.ts";

const BoardPage = lazy(async () => {
  const loaded = await import("./board.tsx");

  return { default: loaded.BoardPage };
});

type ApplicationsView = "board" | "list";

function viewFrom(value: string | null) {
  if (value === "board" || value === "list") {
    return value;
  }

  return null;
}

/**
 * The canonical Application Tracker destination (`/tracker`).
 *
 * One view at a time (`board` or `list`), synced with `?view=board|list`. Desktop opens Board
 * and phone opens List when neither is requested; legacy `?view=calendar` links redirect to the
 * standalone `/calendar` route.
 *
 * @returns Tracker workspace page or calendar redirect.
 */
export function ApplicationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const rawView = searchParams.get("view");

  if (rawView === "calendar") {
    const next = new URLSearchParams(searchParams);

    next.delete("view");
    const query = next.toString();

    return <Navigate replace to={query === "" ? "/calendar" : `/calendar?${query}`} />;
  }

  const requested = viewFrom(rawView);
  const view: ApplicationsView = requested ?? (desktop ? "board" : "list");

  const changeView = (next: string) => {
    const target = viewFrom(next);

    if (target === null) {
      return;
    }

    const params = new URLSearchParams(searchParams);

    params.set("view", target);
    params.delete("month");
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BoardPage onChangeView={changeView} view={view} />
    </div>
  );
}
