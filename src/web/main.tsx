import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { copy } from "../shared/copy.ts";
import { AppShell } from "./app.tsx";
import { HomePage } from "./routes/home.tsx";
import { NotFoundPage } from "./routes/not-found.tsx";
import { SearchPage } from "./routes/search.tsx";

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/search", element: <SearchPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

const queryClient = new QueryClient();
const rootElement = document.querySelector("#root");

if (rootElement === null) {
  throw new Error(copy.app.rootMissing);
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
