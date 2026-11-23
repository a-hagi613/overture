import { describe, expect, test } from "bun:test";

Bun.env.BETTER_AUTH_SECRET ??= "env-test-secret-value-1234";

Bun.env.MASTER_KEY_V1 ??= Buffer.from(new Uint8Array(32).fill(3)).toString("base64");

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";

Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

const { checkedEnvSchema, resolveTurnstileHostnames, turnstileDefaultHostnames } =
  await import("./env.ts");

const productionEnv = {
  ADMIN_ORIGIN: "https://admin.tryoverture.com",
  APP_ORIGIN: "https://tryoverture.com",
  BETTER_AUTH_SECRET: "env-test-secret-value-1234",
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
