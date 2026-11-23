import { describe, expect, test } from "bun:test";

import { isDemoAllowedAuthPath } from "./demo-paths.ts";

describe("the demo account's auth endpoint allowlist", () => {
  test("allows only reading the session, signing out and the demo sign-in", () => {
    for (const path of ["/get-session", "/sign-out", "/demo/sign-in", "/get-session/"]) {
      expect(isDemoAllowedAuthPath(path), path).toBe(true);
    }
  });

  test("refuses session listing, session revocation, account linking and every passkey endpoint", () => {
    const refused = [
      "/list-sessions",
      "/revoke-session",
      "/revoke-sessions",
      "/revoke-other-sessions",
      "/oauth2/link",
      "/link-social",
      "/passkey/add-passkey",
      "/passkey/list-user-passkeys",
      "/passkey/generate-register-options",
      "/passkey/verify-registration",
      "/change-email",
      "/delete-user",
    ];

    for (const path of refused) {
      expect(isDemoAllowedAuthPath(path), path).toBe(false);
    }
  });
});
