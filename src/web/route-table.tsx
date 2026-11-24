import { lazy } from "react";
import type { ComponentType } from "react";
import type { RouteObject } from "react-router";

import { PreserveSearchRedirect } from "./components/preserve-search-redirect.tsx";
import { RootLayout } from "./components/root-layout.tsx";
import { RouteErrorElement } from "./components/route-error-element.tsx";
import { RouteErrorPage } from "./components/route-error-page.tsx";
import { ConsentPage } from "./routes/consent.tsx";
import { LandingPage } from "./routes/landing.tsx";
import { NotFoundPage } from "./routes/not-found.tsx";
import { PrivacyPage } from "./routes/privacy.tsx";
import { SignInPage } from "./routes/signin.tsx";
import { SignUpPage } from "./routes/signup.tsx";
import { TermsPage } from "./routes/terms.tsx";

function lazyRoute<TKey extends string>(
  load: () => Promise<Record<TKey, ComponentType>>,
  exportName: TKey,
) {
  return lazy(async () => {
    const loaded = await load();

    return { default: loaded[exportName] };
  });
}

const AppShell = lazyRoute(async () => import("./app.tsx"), "AppShell");
const AdminShell = lazyRoute(async () => import("./routes/admin/shell.tsx"), "AdminShell");

const HomePage = lazyRoute(async () => import("./routes/home.tsx"), "HomePage");

const ApplicationsPage = lazyRoute(
  async () => import("./routes/applications.tsx"),
  "ApplicationsPage",
);

const ReadyPage = lazyRoute(async () => import("./routes/ready.tsx"), "ReadyPage");
const ReviewPage = lazyRoute(async () => import("./routes/review.tsx"), "ReviewPage");

const InboxPage = lazyRoute(async () => import("./routes/inbox.tsx"), "InboxPage");

const InboxThreadPage = lazyRoute(
  async () => import("./routes/inbox-thread.tsx"),
  "InboxThreadPage",
);

const NotificationsPage = lazyRoute(
  async () => import("./routes/notifications.tsx"),
  "NotificationsPage",
);

const ProfileLandingPage = lazyRoute(
  async () => import("./routes/profile-landing.tsx"),
  "ProfileLandingPage",
);

const ProfileResumePage = lazyRoute(
  async () => import("./routes/profile-resume.tsx"),
  "ProfileResumePage",
);

const ProfileDetailsPage = lazyRoute(
  async () => import("./routes/profile-details.tsx"),
  "ProfileDetailsPage",
);

const ProfilePreferencesPage = lazyRoute(
  async () => import("./routes/profile-preferences.tsx"),
  "ProfilePreferencesPage",
);

const ProfileAccountPage = lazyRoute(
  async () => import("./routes/profile-account.tsx"),
  "ProfileAccountPage",
);

const ProfileBillingPage = lazyRoute(
  async () => import("./routes/profile-billing.tsx"),
  "ProfileBillingPage",
);

const SupportPage = lazyRoute(async () => import("./routes/support.tsx"), "SupportPage");

const OnboardingPage = lazyRoute(async () => import("./routes/onboarding.tsx"), "OnboardingPage");

const OnboardingResumePage = lazyRoute(
  async () => import("./routes/onboarding-resume.tsx"),
  "OnboardingResumePage",
);

const OnboardingTargetsPage = lazyRoute(
  async () => import("./routes/onboarding-targets.tsx"),
  "OnboardingTargetsPage",
);

const OnboardingMatchesPage = lazyRoute(
  async () => import("./routes/onboarding-matches.tsx"),
  "OnboardingMatchesPage",
);

const OnboardingTrialPage = lazyRoute(
  async () => import("./routes/onboarding-trial.tsx"),
  "OnboardingTrialPage",
);

const OverviewPage = lazyRoute(async () => import("./routes/admin/overview.tsx"), "OverviewPage");

const AdminSupportPage = lazyRoute(
  async () => import("./routes/admin/support.tsx"),
  "AdminSupportPage",
);

const JobsPage = lazyRoute(async () => import("./routes/admin/jobs.tsx"), "JobsPage");

const ProviderReportPage = lazyRoute(
  async () => import("./routes/admin/provider-report.tsx"),
  "ProviderReportPage",
);

const AttemptsPage = lazyRoute(async () => import("./routes/admin/attempts.tsx"), "AttemptsPage");
const LlmUsagePage = lazyRoute(async () => import("./routes/admin/llm.tsx"), "LlmUsagePage");

const AdminSettingsPage = lazyRoute(
  async () => import("./routes/admin/settings.tsx"),
  "AdminSettingsPage",
);

const CatalogPage = lazyRoute(async () => import("./routes/admin/catalog.tsx"), "CatalogPage");
const SystemPage = lazyRoute(async () => import("./routes/admin/system.tsx"), "SystemPage");

const MailHealthPage = lazyRoute(
  async () => import("./routes/admin/mail-health.tsx"),
  "MailHealthPage",
);

const GrantsPage = lazyRoute(async () => import("./routes/admin/grants.tsx"), "GrantsPage");
const MarginPage = lazyRoute(async () => import("./routes/admin/margin.tsx"), "MarginPage");
const BillingPage = lazyRoute(async () => import("./routes/admin/billing.tsx"), "BillingPage");

const BillingReconciliationPage = lazyRoute(
  async () => import("./routes/admin/billing-reconciliation.tsx"),
  "BillingReconciliationPage",
);

const BillingUserPage = lazyRoute(
  async () => import("./routes/admin/billing-user.tsx"),
  "BillingUserPage",
);

const BillingRefundPage = lazyRoute(
  async () => import("./routes/admin/billing-refund.tsx"),
  "BillingRefundPage",
);

const UsersPage = lazyRoute(async () => import("./routes/admin/users.tsx"), "UsersPage");
const UserPage = lazyRoute(async () => import("./routes/admin/user.tsx"), "UserPage");
const InvitesPage = lazyRoute(async () => import("./routes/admin/invites.tsx"), "InvitesPage");
const WaitlistPage = lazyRoute(async () => import("./routes/admin/waitlist.tsx"), "WaitlistPage");
const AuditLogPage = lazyRoute(async () => import("./routes/admin/audit.tsx"), "AuditLogPage");

const withRouteError = (routes: RouteObject[]) =>
  routes.map((route) => ({ ...route, errorElement: <RouteErrorElement /> }));

const appShellChildren: RouteObject[] = withRouteError([
  { path: "/home", element: <HomePage /> },
  { path: "/ready", element: <ReadyPage /> },
  { path: "/board", element: <PreserveSearchRedirect to="/applications" /> },
  { path: "/review", element: <ReviewPage /> },
  { path: "/calendar", element: <PreserveSearchRedirect to="/applications?view=calendar" /> },
  { path: "/inbox", element: <InboxPage /> },
  { path: "/inbox/:id", element: <InboxThreadPage /> },
  { path: "/notifications", element: <NotificationsPage /> },
  { path: "/applications", element: <ApplicationsPage /> },
  { path: "/profile", element: <ProfileLandingPage /> },
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
  { path: "/search", element: <PreserveSearchRedirect to="/applications" /> },
  { path: "/inbox/address", element: <PreserveSearchRedirect to="/profile/account#forwarding" /> },
  { path: "*", element: <NotFoundPage /> },
]);

const adminShellChildren: RouteObject[] = withRouteError([
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
  { path: "/admin/waitlist", element: <WaitlistPage /> },
  { path: "/admin/audit", element: <AuditLogPage /> },
]);

const publicRoutes: RouteObject[] = withRouteError([
  { path: "/", element: <LandingPage /> },
  { path: "/pricing", element: <PreserveSearchRedirect to="/#pricing" /> },
  { path: "/signin", element: <SignInPage /> },
  { path: "/signup", element: <SignUpPage /> },
  { path: "/terms", element: <TermsPage /> },
  { path: "/privacy", element: <PrivacyPage /> },
  { path: "/consent", element: <ConsentPage /> },
  { path: "/onboarding", element: <OnboardingPage /> },
  { path: "/onboarding/resume", element: <OnboardingResumePage /> },
  { path: "/onboarding/targets", element: <OnboardingTargetsPage /> },
  { path: "/onboarding/matches", element: <OnboardingMatchesPage /> },
  { path: "/onboarding/trial", element: <OnboardingTrialPage /> },
]);

export const appRoutes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { element: <AppShell />, errorElement: <RouteErrorPage />, children: appShellChildren },
      {
        element: <AdminShell />,
        errorElement: <RouteErrorPage />,
        children: adminShellChildren,
      },
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
