import { expect, test } from "@playwright/test";
import { setupServer } from "msw/node";

test("a request to an unmocked host fails", async () => {
  const interception = setupServer();

  interception.listen({ onUnhandledRequest: "error" });

  await expect(fetch("https://unmocked.invalid/probe")).rejects.toThrow();
  interception.close();
});
