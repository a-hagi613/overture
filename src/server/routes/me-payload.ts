export interface MeUser {
  email: string;
  emailVerified: boolean;
  id: string;
  name: string;
  role: string;
}

export interface MeConfig {
  adminOrigin: string;
  adminOwnerEmail: string | null;
  socialProviders: readonly string[];
  turnstileScriptUrl: string;
  turnstileSiteKey: string;
}

/**
 * Builds the body of `GET /api/me`.
 *
 * The admin origin is returned to owners only. Anonymous visitors, regular users
 * and the demo account receive `null`, so the admin host never leaks to anyone
 * who could not use it (#512).
 * @param user The signed-in user, or null when nobody is signed in.
 * @param config The deployment values the response carries.
 * @returns The JSON body for `GET /api/me`.
 */
export function mePayload(user: MeUser | null, config: MeConfig) {
  return {
    user:
      user === null
        ? null
        : {
            email: user.email,
            emailVerified: user.emailVerified,
            id: user.id,
            name: user.name,
            role: user.role,
          },
    adminOrigin: user?.role === "owner" ? config.adminOrigin : null,
    adminOwnerEmail: config.adminOwnerEmail,
    socialProviders: config.socialProviders,
    turnstileScriptUrl: config.turnstileScriptUrl,
    turnstileSiteKey: config.turnstileSiteKey,
  };
}
