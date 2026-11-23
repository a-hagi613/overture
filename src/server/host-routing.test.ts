import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  dispatchByHost,
  hostnameFromHeader,
  isAdminHost,
  mainHostAdminApiRefusal,
} from "./host-routing.ts";

const adminOrigin = "https://admin.tryoverture.com";

function createTestApp() {
  const adminHost = new Hono();

  adminHost.all("/admin/api/*", (context) => context.json({ handled: "admin" }));

  const app = new Hono();

  app.use("*", dispatchByHost(adminHost, adminOrigin));
  app.all("/admin/api/*", mainHostAdminApiRefusal);
  app.get("*", (context) => context.text("main"));

  return app;
}

describe("hostnameFromHeader", () => {
  test("reads a hostname with or without a port", () => {
    expect(hostnameFromHeader("tryoverture.com")).toBe("tryoverture.com");
    expect(hostnameFromHeader("tryoverture.com:8080")).toBe("tryoverture.com");
    expect(hostnameFromHeader("admin.tryoverture.com:443")).toBe("admin.tryoverture.com");
    expect(hostnameFromHeader("127.0.0.1:3000")).toBe("127.0.0.1");
    expect(hostnameFromHeader("[::1]:3000")).toBe("[::1]");
  });

  test("a malformed or missing Host header resolves to an empty hostname", () => {
    expect(hostnameFromHeader(undefined)).toBe("");
    expect(hostnameFromHeader("")).toBe("");
    expect(hostnameFromHeader("bad host")).toBe("");
    expect(hostnameFromHeader("exa mple.com:3000")).toBe("");
  });
});

describe("isAdminHost", () => {
  test("matches the admin origin hostname only", () => {
    expect(isAdminHost("admin.tryoverture.com", adminOrigin)).toBe(true);
    expect(isAdminHost("tryoverture.com", adminOrigin)).toBe(false);
    expect(isAdminHost("", adminOrigin)).toBe(false);
  });

  test("an unreadable admin origin never matches", () => {
    expect(isAdminHost("admin.tryoverture.com", "not a url")).toBe(false);
  });
});

describe("host dispatch fallbacks", () => {
  test("the admin host reaches the admin app", async () => {
    const response = await createTestApp().request(
      "http://admin.tryoverture.com/admin/api/overview",
      {
        headers: { host: "admin.tryoverture.com" },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handled: "admin" });
  });

  test("a main-host admin API request is refused with JSON, never the HTML shell", async () => {
    const response = await createTestApp().request("http://tryoverture.com/admin/api/overview", {
      headers: { host: "tryoverture.com" },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "access_required" });
  });

  test("a main-host admin API request of any method is refused", async () => {
    const response = await createTestApp().request("http://tryoverture.com/admin/api/overview", {
      method: "POST",
      headers: { host: "tryoverture.com" },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "access_required" });
  });

  test("other main-host paths fall through to the static shell", async () => {
    const response = await createTestApp().request("http://tryoverture.com/dashboard", {
      headers: { host: "tryoverture.com" },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("main");
  });

  test("a malformed Host header falls through instead of throwing", async () => {
    const response = await createTestApp().request("http://tryoverture.com/", {
      headers: { host: "bad host" },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("main");
  });
});
