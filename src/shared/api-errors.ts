/**
 * The error codes every JSON route shares (SPEC §14). A route may add its own
 * conflict code (`not_ready`, `plan_changed`), but an authentication failure is
 * always `sign_in_required`, a missing row is always `not_found`, and a body
 * that fails validation is always `invalid_request` with the Zod issues beside
 * it, so one client branch serves every route.
 */
export const API_ERRORS = {
  internal: "internal_error",
  invalidRequest: "invalid_request",
  notFound: "not_found",
  rateLimited: "rate_limited",
  signInRequired: "sign_in_required",
} as const;
