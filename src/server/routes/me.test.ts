import { describe, expect, test } from "bun:test";

import type { MeConfig, MeUser } from "./me-payload.ts";

import { mePayload } from "./me-payload.ts";

const config: MeConfig = {
  adminOrigin: "https://admin.tryoverture.com",
  adminOwnerEmail: null,
  publicSignupEnabled: true,
  socialProviders: ["google"],
  turnstileScriptUrl: "/turnstile.js",
  turnstileSiteKey: "site-key",
};

function userOf(role: string) {
  return {
    email: "person@example.com",
    emailVerified: true,
    id: "user-1",
    name: "Person",
    role,
  } satisfies MeUser;
}

describe("GET /api/me admin origin scoping", () => {
  test("the owner receives the admin origin", () => {
    expect(mePayload(userOf("owner"), config).adminOrigin).toBe("https://admin.tryoverture.com");
  });

  test("a regular user never receives the admin origin", () => {
    expect(mePayload(userOf("user"), config).adminOrigin).toBeNull();
  });

  test("the demo account never receives the admin origin", () => {
    expect(mePayload(userOf("demo"), config).adminOrigin).toBeNull();
  });

  test("an anonymous visitor never receives the admin origin", () => {
    const payload = mePayload(null, config);

    expect(payload.adminOrigin).toBeNull();
    expect(payload.user).toBeNull();
  });

  test("any role other than owner is refused the admin origin", () => {
    for (const role of ["", "Owner", "admin", "owner "]) {
      expect(mePayload(userOf(role), config).adminOrigin).toBeNull();
    }
  });
});

describe("GET /api/me public sign-up flag", () => {
  test("the waitlist page can tell that public sign-up is closed", () => {
    expect(mePayload(null, { ...config, publicSignupEnabled: false }).publicSignupEnabled).toBe(
      false,
    );
  });

  test("an open sign-up passes the flag through", () => {
    expect(mePayload(null, { ...config, publicSignupEnabled: true }).publicSignupEnabled).toBe(
      true,
    );
  });
});

describe("GET /api/me owner hint on the admin host", () => {
  test("the admin host carries the owner email for the sign-in screen", () => {
    const payload = mePayload(null, { ...config, adminOwnerEmail: "owner@tryoverture.com" });

    expect(payload.adminOwnerEmail).toBe("owner@tryoverture.com");
  });

  test("every other host carries no owner email", () => {
    expect(mePayload(userOf("owner"), config).adminOwnerEmail).toBeNull();
    expect(mePayload(null, config).adminOwnerEmail).toBeNull();
  });
});

describe("GET /api/me keeps the existing body", () => {
  test("the signed-in user is returned field by field", () => {
    expect(mePayload(userOf("owner"), config).user).toEqual({
      email: "person@example.com",
      emailVerified: true,
      id: "user-1",
      name: "Person",
      role: "owner",
    });
  });

  test("the turnstile and social provider values are passed through", () => {
    const payload = mePayload(userOf("user"), config);

    expect(payload.turnstileSiteKey).toBe("site-key");
    expect(payload.turnstileScriptUrl).toBe("/turnstile.js");
    expect(payload.socialProviders).toEqual(["google"]);
  });
});
