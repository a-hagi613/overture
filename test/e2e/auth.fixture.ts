const ownerEmail = "owner@example.com";

export const authTestIdentity = {
  ownerEmail,
  ownerName: "Maya Okafor",
  secret: "e2e-auth-secret-0123456789abcdef",
  turnstileSiteKey: "1x00000000000000000000AA",
  turnstilePassToken: "XXXX.DUMMY.TOKEN.XXXX",
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
