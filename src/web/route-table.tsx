import { Navigate } from "react-router";
import type { RouteObject } from "react-router";

import { BoardPage } from "./routes/board.tsx";
import { CalendarPage } from "./routes/calendar.tsx";
import { HomePage } from "./routes/home.tsx";
import { InboxThreadPage } from "./routes/inbox-thread.tsx";
import { InboxPage } from "./routes/inbox.tsx";
import { LandingPage } from "./routes/landing.tsx";
import { NotFoundPage } from "./routes/not-found.tsx";
import { NotificationsPage } from "./routes/notifications.tsx";
import { PreserveSearchRedirect } from "./components/preserve-search-redirect.tsx";
import { OnboardingPage } from "./routes/onboarding.tsx";
import { OnboardingFactsPage } from "./routes/onboarding-facts.tsx";
import { OnboardingForwardPage } from "./routes/onboarding-forward.tsx";
import { OnboardingResumePage } from "./routes/onboarding-resume.tsx";
import { OnboardingTargetsPage } from "./routes/onboarding-targets.tsx";
import { OnboardingTrialPage } from "./routes/onboarding-trial.tsx";
import { ProfileAccountPage } from "./routes/profile-account.tsx";
import { ProfileBillingPage } from "./routes/profile-billing.tsx";
import { ProfileDetailsPage } from "./routes/profile-details.tsx";
import { ProfilePreferencesPage } from "./routes/profile-preferences.tsx";
import { ProfileResumePage } from "./routes/profile-resume.tsx";
import { ReadyPage } from "./routes/ready.tsx";
import { ReviewPage } from "./routes/review.tsx";
import { SignInPage } from "./routes/signin.tsx";
import { SignUpPage } from "./routes/signup.tsx";
import { SupportPage } from "./routes/support.tsx";
import { ConsentPage } from "./routes/consent.tsx";
import { PrivacyPage } from "./routes/privacy.tsx";
import { TermsPage } from "./routes/terms.tsx";
import { AppShell } from "./app.tsx";
import { RootLayout } from "./components/root-layout.tsx";
import { AdminShell } from "./routes/admin/shell.tsx";
import { AuditLogPage } from "./routes/admin/audit.tsx";
import { AdminSettingsPage } from "./routes/admin/settings.tsx";
import { CatalogPage } from "./routes/admin/catalog.tsx";
import { MailHealthPage } from "./routes/admin/mail-health.tsx";
import { GrantsPage } from "./routes/admin/grants.tsx";
import { MarginPage } from "./routes/admin/margin.tsx";
import { BillingPage } from "./routes/admin/billing.tsx";
import { BillingUserPage } from "./routes/admin/billing-user.tsx";
import { BillingRefundPage } from "./routes/admin/billing-refund.tsx";
import { BillingReconciliationPage } from "./routes/admin/billing-reconciliation.tsx";
import { InvitesPage } from "./routes/admin/invites.tsx";
import { AttemptsPage } from "./routes/admin/attempts.tsx";
import { JobsPage } from "./routes/admin/jobs.tsx";
import { LlmUsagePage } from "./routes/admin/llm.tsx";
import { OverviewPage } from "./routes/admin/overview.tsx";
import { ProviderReportPage } from "./routes/admin/provider-report.tsx";
import { AdminSupportPage } from "./routes/admin/support.tsx";
import { SystemPage } from "./routes/admin/system.tsx";
import { UserPage } from "./routes/admin/user.tsx";
import { UsersPage } from "./routes/admin/users.tsx";

const appShellChildren: RouteObject[] = [
  { path: "/home", element: <HomePage /> },
  { path: "/ready", element: <ReadyPage /> },
  { path: "/board", element: <BoardPage /> },
  { path: "/review", element: <ReviewPage /> },
  { path: "/calendar", element: <CalendarPage /> },
  { path: "/inbox", element: <InboxPage /> },
  { path: "/inbox/:id", element: <InboxThreadPage /> },
  { path: "/notifications", element: <NotificationsPage /> },
  { path: "/profile", element: <Navigate replace to="/profile/resume" /> },
  { path: "/profile/resume", element: <ProfileResumePage /> },
  { path: "/profile/details", element: <ProfileDetailsPage /> },
  { path: "/profile/preferences", element: <ProfilePreferencesPage /> },
  { path: "/profile/account", element: <ProfileAccountPage /> },
  { path: "/profile/billing", element: <ProfileBillingPage /> },
  { path: "/support", element: <SupportPage /> },
  { path: "/settings", element: <PreserveSearchRedirect to="/profile/account" /> },
  { path: "/settings/billing", element: <PreserveSearchRedirect to="/profile/billing" /> },
  { path: "/settings/billing/plans", element: <PreserveSearchRedirect to="/profile/billing" /> },
  {
    path: "/settings/export",
    element: <PreserveSearchRedirect to="/profile/account#account-data" />,
  },
  {
    path: "/settings/delete",
    element: <PreserveSearchRedirect to="/profile/account#account-danger" />,
  },
  {
    path: "/settings/support-access",
    element: <PreserveSearchRedirect to="/profile/account#support-access" />,
  },
  { path: "/search", element: <PreserveSearchRedirect to="/board" /> },
  { path: "/inbox/address", element: <PreserveSearchRedirect to="/profile/account#forwarding" /> },
  { path: "*", element: <NotFoundPage /> },
];

const adminShellChildren: RouteObject[] = [
  { path: "/admin", element: <OverviewPage /> },
  { path: "/admin/support", element: <AdminSupportPage /> },
  { path: "/admin/jobs", element: <JobsPage /> },
  { path: "/admin/provider-report", element: <ProviderReportPage /> },
  { path: "/admin/attempts", element: <AttemptsPage /> },
  { path: "/admin/llm", element: <LlmUsagePage /> },
  { path: "/admin/settings", element: <AdminSettingsPage /> },
  { path: "/admin/catalog", element: <CatalogPage /> },
  { path: "/admin/system", element: <SystemPage /> },
  { path: "/admin/mail-health", element: <MailHealthPage /> },
  { path: "/admin/grants", element: <GrantsPage /> },
  { path: "/admin/billing/margin", element: <MarginPage /> },
  { path: "/admin/billing", element: <BillingPage /> },
  { path: "/admin/billing/reconciliation", element: <BillingReconciliationPage /> },
  { path: "/admin/billing/users/:id", element: <BillingUserPage /> },
  { path: "/admin/billing/users/:id/refund", element: <BillingRefundPage /> },
  { path: "/admin/users", element: <UsersPage /> },
  { path: "/admin/users/:id", element: <UserPage /> },
  { path: "/admin/invites", element: <InvitesPage /> },
  { path: "/admin/audit", element: <AuditLogPage /> },
];

const publicRoutes: RouteObject[] = [
  { path: "/", element: <LandingPage /> },
  { path: "/pricing", element: <PreserveSearchRedirect to="/#pricing" /> },
  { path: "/signin", element: <SignInPage /> },
  { path: "/signup", element: <SignUpPage /> },
  { path: "/terms", element: <TermsPage /> },
  { path: "/privacy", element: <PrivacyPage /> },
  { path: "/consent", element: <ConsentPage /> },
  { path: "/onboarding", element: <OnboardingPage /> },
  { path: "/onboarding/resume", element: <OnboardingResumePage /> },
  { path: "/onboarding/facts", element: <OnboardingFactsPage /> },
  { path: "/onboarding/targets", element: <OnboardingTargetsPage /> },
  { path: "/onboarding/forward", element: <OnboardingForwardPage /> },
  { path: "/onboarding/trial", element: <OnboardingTrialPage /> },
];

export const appRoutes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { element: <AppShell />, children: appShellChildren },
      { element: <AdminShell />, children: adminShellChildren },
      ...publicRoutes,
    ],
  },
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
