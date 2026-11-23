import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { copy } from "../shared/copy.ts";
import {
  adminOwnerRefusalPage,
  adminRootLocation,
  dispatchByHost,
  hostnameFromHeader,
  isAdminHost,
  isAdminPageRequest,
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

describe("adminRootLocation", () => {
  test("a bare root goes to the portal", () => {
    expect(adminRootLocation(new URL("https://admin.tryoverture.com/"))).toBe("/admin");
  });

  test("the query string is kept and the hash never reaches the server", () => {
    expect(
      adminRootLocation(new URL("https://admin.tryoverture.com/?from=profile&tab=users")),
    ).toBe("/admin?from=profile&tab=users");
  });
});

describe("isAdminPageRequest", () => {
  test("a browser navigation to an admin page is a page request", () => {
    expect(isAdminPageRequest("GET", "/admin", "text/html,application/xhtml+xml,*/*;q=0.8")).toBe(
      true,
    );
    expect(isAdminPageRequest("GET", "/", "text/html")).toBe(true);
    expect(isAdminPageRequest("GET", "/signin", "text/html")).toBe(true);
  });

  test("the admin API, the me API and the test routes are never page requests", () => {
    expect(isAdminPageRequest("GET", "/admin/api/overview", "text/html")).toBe(false);
    expect(isAdminPageRequest("GET", "/api/me", "text/html")).toBe(false);
    expect(isAdminPageRequest("GET", "/__test__/auth/state", "text/html")).toBe(false);
  });

  test("assets, fetches and writes are not page requests", () => {
    expect(isAdminPageRequest("GET", "/assets/app-123.js", "*/*")).toBe(false);
    expect(isAdminPageRequest("GET", "/admin", "*/*")).toBe(false);
    expect(isAdminPageRequest("POST", "/admin", "text/html")).toBe(false);
  });
});

describe("adminOwnerRefusalPage", () => {
  test("names the owner account with the portal copy", () => {
    const page = adminOwnerRefusalPage("owner@tryoverture.com");

    expect(page).toContain(copy.admin.ownerRefusalTitle);
    expect(page).toContain("Sign out and use owner@tryoverture.com.");
    expect(page).toContain(copy.admin.adminPill);
    expect(page).toContain("<h1>");
    expect(page).toContain('lang="en"');
  });

  test("escapes the owner email instead of rendering it as markup", () => {
    const page = adminOwnerRefusalPage('<script>alert("x")</script>');

    expect(page).not.toContain("<script>alert");
    expect(page).toContain("&lt;script&gt;");
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
