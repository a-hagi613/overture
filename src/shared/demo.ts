/**
 * The demo account. Anyone who enters this email on the sign-in page signs in
 * as the demo user with one click when `DEMO_LOGIN_ENABLED=true`; no mail is
 * sent and the account can never send an Application (SPEC §13.1, #278).
 */
export const demoLoginEmail = "test@email.com";

export const demoRole = "demo";

export function isDemoEmail(email: string) {
  return email.trim().toLowerCase() === demoLoginEmail;
}

export function isDemoRole(role: string | null | undefined) {
  return role === demoRole;
}
