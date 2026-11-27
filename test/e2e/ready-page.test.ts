import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedReady } from "./ready-harness.ts";

const test = appTest.extend<{ readyServer: AppServer }>({
  readyServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const readySchema = z.object({
  approved: z.number(),
  cards: z.array(
    z.object({
      company: z.string(),
      id: z.string(),
      status: z.enum(["ready", "approved"]),
    }),
  ),
  ready: z.number(),
});

async function readyOf(request: APIRequestContext) {
  return readySchema.parse(await (await request.get("/api/ready")).json());
}

test("Ready sends only on approval, and the two layers, Edit, Skip, Undo and saved-only batch work", async ({
  browser,
  readyServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: readyServer.url });

  await seedReady(request, readyServer.url);

  const storageState = await request.storageState();

  const context = await browser.newContext({
    storageState,
    timezoneId: "America/Toronto",
    viewport: { height: 900, width: 1280 },
  });

  const page = await context.newPage();

  await page.goto(`${readyServer.url}/ready`);
  await expect(page.getByRole("heading", { level: 1, name: "Approval Queue" })).toBeVisible();

  const summary = page.getByRole("region", { name: "Ready summary" });

  await expect(summary.getByText("Pending approval")).toBeVisible();
  await expect(summary.getByText("2", { exact: true })).toBeVisible();
  await expect(summary.getByText("Scheduled", { exact: true })).toBeVisible();
  await expect(summary.getByText("1", { exact: true })).toBeVisible();
  await expect(page.getByText("1 scheduled")).toBeVisible();

  const queue = page.locator('section[aria-label="Applications ready to send"]');

  const northwind = queue.locator("article").filter({
    has: page.getByRole("heading", { level: 2, name: "Platform Engineer" }),
  });

  const halden = queue.locator("article").filter({
    has: page.getByRole("heading", { level: 2, name: "Site Reliability Engineer" }),
  });

  const scheduled = page.locator('section[aria-label="Scheduled applications"]');

  const before = await readyOf(request);

  expect(before.ready).toBe(2);
  expect(before.approved).toBe(1);

  await northwind.getByRole("button", { name: "Inspect Northwind Labs" }).click();

  const drawer = page.getByRole("dialog", { name: "Inspect prepared application" });

  expect(await drawer.evaluate((element) => element.tagName)).toBe("DIALOG");
  await expect(drawer).toHaveAttribute("aria-modal", "true");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(northwind.getByRole("button", { name: "Inspect Northwind Labs" })).toBeFocused();

  await northwind.getByRole("button", { name: "Inspect Northwind Labs" }).click();
  await expect(drawer).toBeVisible();

  await expect(drawer.getByText("Drafted from your resume").first()).toBeVisible();

  await drawer.getByRole("button", { name: "Next application" }).click();
  await expect(drawer.getByText("Your answer").first()).toBeVisible();
  await expect(drawer.getByText("Saved answers only")).toBeVisible();
  await expect(drawer.getByText("Saved answer").first()).toBeVisible();

  await drawer.getByRole("button", { name: /Show more/u }).click();
  await expect(drawer.getByRole("button", { name: "Show less" })).toBeVisible();
  await expect(drawer.getByText("maya-okafor-2026.pdf")).toBeVisible();

  await drawer
    .getByRole("button", {
      name: "Edit answer: Are you comfortable with a weekly on-call rotation?",
    })
    .click();

  const edited = "Yes. I have kept a weekly rotation for three years and would keep this one.";

  await drawer
    .getByRole("textbox", {
      name: "Your answer to Are you comfortable with a weekly on-call rotation?",
    })
    .fill(edited);

  const saved = page.waitForResponse(
    (candidate) => candidate.request().method() === "PUT" && candidate.url().includes("/answers/"),
  );

  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await saved;
  await expect(
    drawer.getByRole("textbox", {
      name: "Your answer to Are you comfortable with a weekly on-call rotation?",
    }),
  ).toHaveCount(0);
  await expect(drawer.getByText(edited, { exact: true })).toBeVisible();
  await expect(page.getByText("Answer saved.")).toBeVisible();

  const afterEdit = await readyOf(request);

  expect(afterEdit.ready).toBe(2);
  expect(afterEdit.approved).toBe(1);

  await drawer.getByRole("button", { name: "Skip" }).click();
  await expect(halden).toHaveCount(0);

  const skipToast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Skipped Halden Systems." });

  await skipToast.getByRole("button", { name: "Undo" }).click();
  await expect(halden).toBeVisible();

  await drawer.getByRole("button", { name: "Close", exact: true }).click();

  const approved = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      /\/api\/applications\/[^/]+\/approve$/u.test(candidate.url()),
  );

  await northwind.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Approve & schedule" }).click();
  await approved;
  await expect(page.getByText("Scheduled to send to Northwind Labs.")).toBeVisible();

  const approvalToast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Scheduled to send to Northwind Labs." });

  await expect(approvalToast.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(scheduled.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(scheduled.getByText("Northwind Labs", { exact: true }).first()).toBeVisible();
  await expect(scheduled.getByText(/^(?:Scheduled ·|Queued$)/u).first()).toBeVisible();

  const afterSend = await readyOf(request);

  expect(afterSend.ready).toBe(1);
  expect(afterSend.approved).toBe(2);

  const all = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      /\/api\/applications\/[^/]+\/approve$/u.test(candidate.url()),
  );

  await halden.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Approve & schedule" }).click();
  await all;

  const afterAll = await readyOf(request);

  expect(afterAll.ready).toBe(0);
  expect(afterAll.approved).toBe(3);

  const detail = z
    .object({ application: z.object({ status: z.string() }) })
    .parse(
      await (
        await request.get(
          `/api/applications/${encodeURIComponent(
            afterAll.cards.find((card) => card.company === "Northwind Labs")?.id ?? "",
          )}`,
        )
      ).json(),
    );

  expect(detail.application.status).toBe("approved");

  await context.close();
  await request.dispose();
});
