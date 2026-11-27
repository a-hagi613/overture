/**
 * Paths a signed-in account may open before onboarding finishes. The Tracker is allowed only when it carries the
 * Stripe return parameters, because that page runs the settle that finishes onboarding (ADR 0050).
 */
const UNONBOARDED_ALLOWED_PATHS = new Set([
  "/profile/account",
  "/profile/billing",
  "/settings",
  "/settings/billing",
  "/settings/billing/plans",
  "/settings/delete",
  "/settings/export",
  "/settings/support-access",
]);

/**
 * Whether the workspace shell should render one path for an account that has not finished onboarding.
 * @param pathname The current route path.
 * @param search The current query string, including its leading `?` when present.
 * @returns True when the page owns the reason, such as Checkout or the Tracker settle.
 */
export function allowsUnonboarded(pathname: string, search: string) {
  if (UNONBOARDED_ALLOWED_PATHS.has(pathname)) {
    return true;
  }

  if (pathname !== "/tracker") {
    return false;
  }

  const params = new URLSearchParams(search);

  return params.get("card") === "verified" || params.get("billing") === "success";
}
