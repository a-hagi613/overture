import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { copy } from "../shared/copy.ts";
import { ThemeProvider } from "./lib/theme.tsx";
import { appRoutes } from "./route-table.tsx";

const PRELOAD_RELOAD_KEY = "overture.preload-reloaded";

globalThis.addEventListener("vite:preloadError", (event) => {
  const marker = `${globalThis.location.pathname}${globalThis.location.search}`;

  try {
    if (globalThis.sessionStorage.getItem(PRELOAD_RELOAD_KEY) === marker) {
      return;
    }

    globalThis.sessionStorage.setItem(PRELOAD_RELOAD_KEY, marker);
  } catch {
    return;
  }

  event.preventDefault();
  globalThis.location.reload();
});

const router = createBrowserRouter(appRoutes);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
});

const rootElement = document.querySelector("#root");

if (rootElement === null) {
  throw new Error(copy.app.rootMissing);
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js", { type: "module" });
}
