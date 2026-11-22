import type { RouteObject } from "react-router";

import { BoardPage } from "./routes/board.tsx";
import { CalendarPage } from "./routes/calendar.tsx";
import { HomePage } from "./routes/home.tsx";
import { InboxAddressPage } from "./routes/inbox-address.tsx";
import { InboxThreadPage } from "./routes/inbox-thread.tsx";
import { InboxPage } from "./routes/inbox.tsx";
import { NotFoundPage } from "./routes/not-found.tsx";
import { NotificationsPage } from "./routes/notifications.tsx";
import { OnboardingPage } from "./routes/onboarding.tsx";
import { OnboardingFactsPage } from "./routes/onboarding-facts.tsx";
import { OnboardingForwardPage } from "./routes/onboarding-forward.tsx";
import { OnboardingResumePage } from "./routes/onboarding-resume.tsx";
import { OnboardingTargetsPage } from "./routes/onboarding-targets.tsx";
import { ProfilePage } from "./routes/profile.tsx";
import { ReadyPage } from "./routes/ready.tsx";
import { ReviewPage } from "./routes/review.tsx";
import { SearchPage } from "./routes/search.tsx";
import { SettingsDeletePage } from "./routes/settings-delete.tsx";
import { SettingsExportPage } from "./routes/settings-export.tsx";
import { SettingsSupportAccessPage } from "./routes/settings-support-access.tsx";
import { SettingsPage } from "./routes/settings.tsx";
import { SignInPage } from "./routes/signin.tsx";
import { ConsentPage } from "./routes/consent.tsx";
import { PricingPage } from "./routes/pricing.tsx";
import { PrivacyPage } from "./routes/privacy.tsx";
import { TermsPage } from "./routes/terms.tsx";
import { AppShell } from "./app.tsx";
import { AdminShell } from "./routes/admin/shell.tsx";
import { AdminSettingsPage } from "./routes/admin/settings.tsx";
import { CatalogPage } from "./routes/admin/catalog.tsx";
import { MailHealthPage } from "./routes/admin/mail-health.tsx";
import { GrantsPage } from "./routes/admin/grants.tsx";
import { InvitesPage } from "./routes/admin/invites.tsx";
import { OverviewPage } from "./routes/admin/overview.tsx";
import { ProviderReportPage } from "./routes/admin/provider-report.tsx";
import { UserPage } from "./routes/admin/user.tsx";
import { UsersPage } from "./routes/admin/users.tsx";

const appShellChildren: RouteObject[] = [
  { path: "/", element: <HomePage /> },
  { path: "/ready", element: <ReadyPage /> },
  { path: "/board", element: <BoardPage /> },
  { path: "/review", element: <ReviewPage /> },
  { path: "/calendar", element: <CalendarPage /> },
  { path: "/inbox", element: <InboxPage /> },
  { path: "/inbox/address", element: <InboxAddressPage /> },
  { path: "/inbox/:id", element: <InboxThreadPage /> },
  { path: "/notifications", element: <NotificationsPage /> },
  { path: "/profile", element: <ProfilePage /> },
  { path: "/search", element: <SearchPage /> },
  { path: "/settings", element: <SettingsPage /> },
  { path: "/settings/delete", element: <SettingsDeletePage /> },
  { path: "/settings/export", element: <SettingsExportPage /> },
  { path: "/settings/support-access", element: <SettingsSupportAccessPage /> },
  { path: "*", element: <NotFoundPage /> },
];

const adminShellChildren: RouteObject[] = [
  { path: "/admin", element: <OverviewPage /> },
  { path: "/admin/provider-report", element: <ProviderReportPage /> },
  { path: "/admin/settings", element: <AdminSettingsPage /> },
  { path: "/admin/catalog", element: <CatalogPage /> },
  { path: "/admin/mail-health", element: <MailHealthPage /> },
  { path: "/admin/grants", element: <GrantsPage /> },
  { path: "/admin/users", element: <UsersPage /> },
  { path: "/admin/users/:id", element: <UserPage /> },
  { path: "/admin/invites", element: <InvitesPage /> },
];

const publicRoutes: RouteObject[] = [
  { path: "/signin", element: <SignInPage /> },
  { path: "/terms", element: <TermsPage /> },
  { path: "/privacy", element: <PrivacyPage /> },
  { path: "/pricing", element: <PricingPage /> },
  { path: "/consent", element: <ConsentPage /> },
  { path: "/onboarding", element: <OnboardingPage /> },
  { path: "/onboarding/resume", element: <OnboardingResumePage /> },
  { path: "/onboarding/facts", element: <OnboardingFactsPage /> },
  { path: "/onboarding/targets", element: <OnboardingTargetsPage /> },
  { path: "/onboarding/forward", element: <OnboardingForwardPage /> },
];

export const appRoutes: RouteObject[] = [
  { element: <AppShell />, children: appShellChildren },
  { element: <AdminShell />, children: adminShellChildren },
  ...publicRoutes,
];

export const routePaths = collectPaths(appRoutes);

function collectPaths(routes: RouteObject[]) {
  const paths: string[] = [];
  const queue = [...routes];

  while (queue.length > 0) {
    const route = queue.shift();

    if (route === undefined) {
      break;
    }

    if (route.path !== undefined) {
      paths.push(route.path);
    }

    if (route.children !== undefined) {
      queue.push(...route.children);
    }
  }

  return paths;
}
