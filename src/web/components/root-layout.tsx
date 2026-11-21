import { Outlet } from "react-router";

import { copy } from "../../shared/copy.ts";

export function RootLayout() {
  return (
    <>
      <a
        data-no-hover
        className="fixed left-3 top-3 z-50 -translate-y-[200%] rounded-md border border-input bg-card px-4 py-3.5 text-[13.5px] font-semibold text-foreground shadow-sh focus-visible:translate-y-0"
        href="#main"
      >
        {copy.shell.skipToMain}
      </a>
      <Outlet />
    </>
  );
}
