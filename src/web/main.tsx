import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { copy } from "../shared/copy.ts";
import { AppShell } from "./app.tsx";
import { BoardPage } from "./routes/board.tsx";
import { HomePage } from "./routes/home.tsx";
import { InboxPage } from "./routes/inbox.tsx";
import { NotFoundPage } from "./routes/not-found.tsx";
import { ProfilePage } from "./routes/profile.tsx";
import { ReviewPage } from "./routes/review.tsx";
import { SearchPage } from "./routes/search.tsx";
import { SettingsPage } from "./routes/settings.tsx";
import { SignInPage } from "./routes/signin.tsx";
import { ThemeProvider } from "./lib/theme.tsx";
import { AdminShell } from "./routes/admin/shell.tsx";
import { AdminSettingsPage } from "./routes/admin/settings.tsx";
import { CatalogPage } from "./routes/admin/catalog.tsx";
import { OverviewPage } from "./routes/admin/overview.tsx";
import { GrantsPage } from "./routes/admin/grants.tsx";

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/board", element: <BoardPage /> },
      { path: "/review", element: <ReviewPage /> },
      { path: "/inbox", element: <InboxPage /> },
      { path: "/profile", element: <ProfilePage /> },
      { path: "/search", element: <SearchPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  {
    element: <AdminShell />,
    children: [
      { path: "/admin", element: <OverviewPage /> },
      { path: "/admin/settings", element: <AdminSettingsPage /> },
      { path: "/admin/catalog", element: <CatalogPage /> },
      { path: "/admin/grants", element: <GrantsPage /> },
    ],
  },
  { path: "/signin", element: <SignInPage /> },
]);

const queryClient = new QueryClient();
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
