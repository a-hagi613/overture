import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";

test("every response carries the security headers and the app breaks no policy", async ({
  isolatedAppServer,
  page,
  request,
}) => {
  const violations: string[] = [];

  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) {
      violations.push(message.text());
    }
  });

  const [home, api] = await Promise.all([
    request.get(isolatedAppServer.url),
    request.get(`${isolatedAppServer.url}/api/health`),
  ]);

  for (const response of [home, api]) {
    const headers = response.headers();

    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  }

  await page.goto(`${isolatedAppServer.url}/signin`);
  await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Link sent to")).toBeVisible();

  expect(violations).toEqual([]);
});
