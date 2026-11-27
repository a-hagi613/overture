import { describe, expect, test } from "bun:test";

import type { SecretConfig } from "better-auth/crypto";

import {
  symmetricDecodeJWT,
  symmetricEncodeJWT,
  symmetricDecrypt,
  symmetricEncrypt,
} from "better-auth/crypto";

Bun.env.BETTER_AUTH_SECRET ??= "env-test-secret-value-1234";

Bun.env.MASTER_KEY_V1 ??= Buffer.from(new Uint8Array(32).fill(3)).toString("base64");

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";

Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

const {
  betterAuthSecretOptions,
  checkedEnvSchema,
  emailListFromValue,
  parseBetterAuthSecrets,
  resolveTurnstileHostnames,
  turnstileDefaultHostnames,
} = await import("./env.ts");

const productionEnv = {
  ADMIN_ORIGIN: "https://admin.tryoverture.com",
  APP_ORIGIN: "https://tryoverture.com",
  BETTER_AUTH_SECRET: "env-test-secret-value-1234",
  CF_ACCESS_AUD: "access-audience",
  CF_ACCESS_TEAM_DOMAIN: "overture.cloudflareaccess.com",
  NODE_ENV: "production",
  OWNER_EMAIL: "owner@example.test",
  TURNSTILE_SECRET: "turnstile-secret",
  TURNSTILE_SITE_KEY: "turnstile-site",
} as const;

describe("turnstileDefaultHostnames", () => {
  test("both the app host and the admin host are allowed", () => {
    expect(
      turnstileDefaultHostnames("https://tryoverture.com", "https://admin.tryoverture.com"),
    ).toEqual(["tryoverture.com", "admin.tryoverture.com"]);
  });

  test("an origin shared by both hosts is named once", () => {
    expect(turnstileDefaultHostnames("https://tryoverture.com", "https://tryoverture.com")).toEqual(
      ["tryoverture.com"],
    );
  });

  test("no app origin falls back to the local development hosts", () => {
    expect(turnstileDefaultHostnames(undefined, "https://admin.tryoverture.com")).toEqual([
      "localhost",
      "127.0.0.1",
    ]);
  });
});

describe("resolveTurnstileHostnames", () => {
  test("an explicit allowlist wins over the origins", () => {
    expect(
      resolveTurnstileHostnames(
        ["admin.tryoverture.com"],
        "https://tryoverture.com",
        "https://admin.tryoverture.com",
      ),
    ).toEqual(["admin.tryoverture.com"]);
  });

  test("no explicit allowlist and no app origin keeps the local development hosts", () => {
    expect(
      resolveTurnstileHostnames(undefined, undefined, "https://admin.tryoverture.com"),
    ).toEqual(["localhost", "127.0.0.1"]);
  });
});

describe("production Turnstile hosts", () => {
  test("the two production origins boot", () => {
    expect(() => {
      checkedEnvSchema.parse(productionEnv);
    }).not.toThrow();
  });

  test("neither origin configured is still refused before the local fallback is used", () => {
    expect(() => {
      checkedEnvSchema.parse({ ...productionEnv, APP_ORIGIN: undefined });
    }).toThrow("Production needs APP_ORIGIN or TURNSTILE_HOSTNAMES");
  });

  test("a localhost app origin is refused", () => {
    expect(() => {
      checkedEnvSchema.parse({ ...productionEnv, APP_ORIGIN: "http://localhost:3000" });
    }).toThrow("must not include localhost");
  });

  test("a loopback admin origin is refused", () => {
    expect(() => {
      checkedEnvSchema.parse({ ...productionEnv, ADMIN_ORIGIN: "http://127.0.0.1:3000" });
    }).toThrow("must not include 127.0.0.1");
  });
});

describe("production Cloudflare Access issuer", () => {
  test("the admin host needs both the audience and the team domain", () => {
    expect(() => {
      checkedEnvSchema.parse({ ...productionEnv, CF_ACCESS_AUD: undefined });
    }).toThrow("needs CF_ACCESS_AUD");

    expect(() => {
      checkedEnvSchema.parse({ ...productionEnv, CF_ACCESS_TEAM_DOMAIN: undefined });
    }).toThrow("needs CF_ACCESS_TEAM_DOMAIN");
  });

  test("a JWKS URL cannot replace the team domain that names the issuer", () => {
    expect(() => {
      checkedEnvSchema.parse({
        ...productionEnv,
        CF_ACCESS_JWKS_URL: "https://overture.cloudflareaccess.com/cdn-cgi/access/certs",
        CF_ACCESS_TEAM_DOMAIN: undefined,
      });
    }).toThrow("CF_ACCESS_JWKS_URL alone cannot name the issuer");
  });

  test("development and test may omit both", () => {
    expect(() => {
      checkedEnvSchema.parse({
        ...productionEnv,
        CF_ACCESS_AUD: undefined,
        CF_ACCESS_TEAM_DOMAIN: undefined,
        NODE_ENV: "test",
      });
    }).not.toThrow();
  });
});

describe("ALLOWED_SIGNUP_EMAILS", () => {
  test("a comma-separated list is trimmed, lowercased and stripped of blanks", () => {
    expect(emailListFromValue(" Admin@Example.com , , second@example.com ")).toEqual([
      "admin@example.com",
      "second@example.com",
    ]);
  });

  test("an unset or empty value parses to an empty allowlist", () => {
    expect(emailListFromValue(undefined)).toEqual([]);
    expect(emailListFromValue("   ")).toEqual([]);

    expect(
      checkedEnvSchema.parse({ ...productionEnv, ALLOWED_SIGNUP_EMAILS: "", NODE_ENV: "test" })
        .ALLOWED_SIGNUP_EMAILS,
    ).toEqual([]);
    expect(
      checkedEnvSchema.parse({ ...productionEnv, NODE_ENV: "test" }).ALLOWED_SIGNUP_EMAILS,
    ).toEqual([]);
  });

  test("each entry must be an email address", () => {
    expect(() =>
      checkedEnvSchema.parse({
        ...productionEnv,
        ALLOWED_SIGNUP_EMAILS: "not-an-email,second@example.com",
        NODE_ENV: "test",
      }),
    ).toThrow();
  });
});

describe("FREEHIRE_API_KEY", () => {
  test("the free plan boots with the key unset or empty, and the API plan carries a value", () => {
    expect(
      checkedEnvSchema.parse({ ...productionEnv, NODE_ENV: "test" }).FREEHIRE_API_KEY,
    ).toBeUndefined();
    expect(
      checkedEnvSchema.parse({ ...productionEnv, FREEHIRE_API_KEY: "", NODE_ENV: "test" })
        .FREEHIRE_API_KEY,
    ).toBe("");
    expect(
      checkedEnvSchema.parse({
        ...productionEnv,
        FREEHIRE_API_KEY: "fh_live_test_key",
        NODE_ENV: "test",
      }).FREEHIRE_API_KEY,
    ).toBe("fh_live_test_key");
  });
});

describe("OVERTURE_DRY_SUBMIT", () => {
  test("is off by default", () => {
    expect(checkedEnvSchema.parse({ ...productionEnv, NODE_ENV: "test" }).OVERTURE_DRY_SUBMIT).toBe(
      false,
    );
  });

  test("1 and true turn it on outside production", () => {
    expect(
      checkedEnvSchema.parse({ ...productionEnv, NODE_ENV: "test", OVERTURE_DRY_SUBMIT: "1" })
        .OVERTURE_DRY_SUBMIT,
    ).toBe(true);
    expect(
      checkedEnvSchema.parse({
        ...productionEnv,
        NODE_ENV: "development",
        OVERTURE_DRY_SUBMIT: "true",
      }).OVERTURE_DRY_SUBMIT,
    ).toBe(true);
  });

  test("production refuses it at config parse", () => {
    expect(() => checkedEnvSchema.parse({ ...productionEnv, OVERTURE_DRY_SUBMIT: "1" })).toThrow(
      "local-only",
    );

    expect(() => checkedEnvSchema.parse({ ...productionEnv, OVERTURE_DRY_SUBMIT: "true" })).toThrow(
      "local-only",
    );
  });

  test("Fly counts as production", () => {
    expect(() =>
      checkedEnvSchema.parse({
        ...productionEnv,
        FLY_APP_NAME: "overture-web",
        NODE_ENV: "test",
        OVERTURE_DRY_SUBMIT: "1",
      }),
    ).toThrow("local-only");
  });

  test("a value it does not understand is refused instead of guessed", () => {
    expect(() =>
      checkedEnvSchema.parse({ ...productionEnv, NODE_ENV: "test", OVERTURE_DRY_SUBMIT: "yes" }),
    ).toThrow("OVERTURE_DRY_SUBMIT must be one of");
  });
});

describe("better-auth secrets", () => {
  const oldSecret = "old-secret-value-0123456789";
  const newSecret = "new-secret-value-9876543210";

  test("a single BETTER_AUTH_SECRET keeps the unchanged deployment", () => {
    expect(parseBetterAuthSecrets({ BETTER_AUTH_SECRET: oldSecret })).toStrictEqual({
      accepted: [oldSecret],
      current: oldSecret,
    });
  });

  test("versioned secrets are current first and keep the legacy secret readable", () => {
    const parsed = parseBetterAuthSecrets({
      BETTER_AUTH_SECRET: oldSecret,
      BETTER_AUTH_SECRETS: `2:${newSecret},1:${oldSecret}`,
    });

    expect(parsed.current).toBe(newSecret);
    expect(parsed.legacy).toBe(oldSecret);
    expect(parsed.secrets).toStrictEqual([
      { version: 2, value: newSecret },
      { version: 1, value: oldSecret },
    ]);
    expect(parsed.accepted).toEqual([newSecret, oldSecret]);
  });

  test("a rotation without the legacy single secret still lists every version", () => {
    const parsed = parseBetterAuthSecrets({ BETTER_AUTH_SECRETS: `2:${newSecret},1:${oldSecret}` });

    expect(parsed.legacy).toBeUndefined();
    expect(parsed.accepted).toEqual([newSecret, oldSecret]);
  });

  test("a malformed or incomplete list is refused", () => {
    expect(() => parseBetterAuthSecrets({})).toThrow("Set BETTER_AUTH_SECRET");
    expect(() => parseBetterAuthSecrets({ BETTER_AUTH_SECRETS: newSecret })).toThrow(
      "<version>:<secret>",
    );
    expect(() => parseBetterAuthSecrets({ BETTER_AUTH_SECRETS: `0:${newSecret}` })).toThrow(
      "<version>:<secret>",
    );
    expect(() =>
      parseBetterAuthSecrets({ BETTER_AUTH_SECRETS: `2:${newSecret},2:${oldSecret}` }),
    ).toThrow("more than once");
    expect(() => parseBetterAuthSecrets({ BETTER_AUTH_SECRETS: "2:short" })).toThrow(
      "at least 16 characters",
    );
    expect(() =>
      parseBetterAuthSecrets({ BETTER_AUTH_SECRETS: `1:${oldSecret},2:${newSecret}` }),
    ).toThrow("versions highest first");
  });
});

const ROTATION_OLD = "old-secret-value-0123456789";
const ROTATION_NEW = "new-secret-value-9876543210";

function secretConfig(parsed: ReturnType<typeof parseBetterAuthSecrets>) {
  if (parsed.secrets === undefined) {
    return parsed.current;
  }

  const [first] = parsed.secrets;

  if (first === undefined) {
    throw new Error("a versioned secret list cannot be empty");
  }

  const config: SecretConfig = {
    currentVersion: first.version,
    keys: new Map(parsed.secrets.map((secret) => [secret.version, secret.value])),
  };

  if (parsed.legacy !== undefined) {
    config.legacySecret = parsed.legacy;
  }

  return config;
}

describe("non-destructive Better Auth secret rotation", () => {
  test("the options wire the current chain and the legacy fallback into better-auth", () => {
    expect(
      betterAuthSecretOptions(parseBetterAuthSecrets({ BETTER_AUTH_SECRET: ROTATION_OLD })),
    ).toStrictEqual({ secret: ROTATION_OLD, secrets: undefined });

    expect(
      betterAuthSecretOptions(
        parseBetterAuthSecrets({
          BETTER_AUTH_SECRET: ROTATION_OLD,
          BETTER_AUTH_SECRETS: `2:${ROTATION_NEW},1:${ROTATION_OLD}`,
        }),
      ),
    ).toStrictEqual({
      secret: ROTATION_OLD,
      secrets: [
        { version: 2, value: ROTATION_NEW },
        { version: 1, value: ROTATION_OLD },
      ],
    });
  });

  test("a session token encrypted under the old single secret still opens after the rotation", async () => {
    const before = parseBetterAuthSecrets({ BETTER_AUTH_SECRET: ROTATION_OLD });

    const during = parseBetterAuthSecrets({
      BETTER_AUTH_SECRET: ROTATION_OLD,
      BETTER_AUTH_SECRETS: `2:${ROTATION_NEW},1:${ROTATION_OLD}`,
    });

    const token = await symmetricEncodeJWT({ session: "before" }, secretConfig(before), "session");

    expect(
      await symmetricDecodeJWT<{ session: string }>(token, secretConfig(during), "session"),
    ).toMatchObject({ session: "before" });
  });

  test("a new token keeps opening through the dual-read window and after the old key is retired", async () => {
    const during = parseBetterAuthSecrets({
      BETTER_AUTH_SECRET: ROTATION_OLD,
      BETTER_AUTH_SECRETS: `2:${ROTATION_NEW},1:${ROTATION_OLD}`,
    });

    const token = await symmetricEncodeJWT({ session: "after" }, secretConfig(during), "session");

    expect(
      await symmetricDecodeJWT<{ session: string }>(token, secretConfig(during), "session"),
    ).toMatchObject({ session: "after" });

    const v2Only = parseBetterAuthSecrets({ BETTER_AUTH_SECRETS: `2:${ROTATION_NEW}` });

    expect(
      await symmetricDecodeJWT<{ session: string }>(token, secretConfig(v2Only), "session"),
    ).toMatchObject({ session: "after" });
  });

  test("the legacy single secret opens bare-hex payloads during the transition", async () => {
    const during = parseBetterAuthSecrets({
      BETTER_AUTH_SECRET: ROTATION_OLD,
      BETTER_AUTH_SECRETS: `2:${ROTATION_NEW},1:${ROTATION_OLD}`,
    });

    const payload = await symmetricEncrypt({
      data: "stored before the rotation",
      key: ROTATION_OLD,
    });

    expect(await symmetricDecrypt({ data: payload, key: secretConfig(during) })).toBe(
      "stored before the rotation",
    );
  });
});
