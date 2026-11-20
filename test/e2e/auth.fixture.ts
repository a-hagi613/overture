const ownerEmail = "maya.okafor@example.com";

export const testAuthEnvironment = {
  BETTER_AUTH_SECRET: "e2e-auth-secret-0123456789abcdef",
  GOOGLE_CLIENT_ID: "e2e-google-client-id",
  GOOGLE_CLIENT_SECRET: "e2e-google-client-secret",
  LINKEDIN_CLIENT_ID: "e2e-linkedin-client-id",
  LINKEDIN_CLIENT_SECRET: "e2e-linkedin-client-secret",
  OWNER_EMAIL: ownerEmail,
  TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
} as const;

export const authTestIdentity = {
  ownerEmail,
  ownerName: "Maya Okafor",
  secret: "e2e-auth-secret-0123456789abcdef",
  turnstileSiteKey: "1x00000000000000000000AA",
  turnstilePassToken: "XXXX.DUMMY.TOKEN.XXXX",
  masterKey: Buffer.from("overture e2e master key v1".padEnd(32, "1"), "binary").toString("base64"),
};

export const personas = {
  owner: (sub: string) => ({
    sub,
    name: authTestIdentity.ownerName,
    email: ownerEmail,
    emailVerified: true,
    picture: null,
  }),
  outsider: (sub: string) => ({
    sub,
    name: "Someone Else",
    email: "someone.else@example.com",
    emailVerified: true,
    picture: null,
  }),
  unverified: (sub: string) => ({
    sub,
    name: "Unverified",
    email: ownerEmail,
    emailVerified: false,
    picture: null,
  }),
};

export { startIdentityServer } from "./identity-server-test.fixture.ts";

export type { IdentityPersona } from "./identity-persona.ts";

export type { IdentityServer } from "./identity-server-test.fixture.ts";
