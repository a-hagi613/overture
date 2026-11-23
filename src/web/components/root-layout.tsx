import { Suspense } from "react";
import { Outlet } from "react-router";

import { copy } from "../../shared/copy.ts";
import { RouteFallback } from "./route-fallback.tsx";

export function RootLayout() {
  return (
    <>
      <a
        data-no-hover
        className="sr-only z-50 rounded-md bg-card px-3 py-2 text-sm font-semibold text-foreground shadow-lift focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        href="#main-content"
      >
        {copy.shell.skipToContent}
      </a>
      <Suspense fallback={<RouteFallback fullScreen />}>
        <Outlet />
      </Suspense>
    </>
  );
}
