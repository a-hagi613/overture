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

test("Ready sends only on approval, and Skip, Undo, Send all and Edit work", async ({
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
  await expect(page.getByRole("heading", { level: 1, name: "Ready to send" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Send all" }).getByText("2", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "applications ready to send" }),
  ).toBeVisible();
  await expect(page.getByText("1 scheduled")).toBeVisible();

  const northwind = page
    .locator('section[aria-label="Applications ready to send"] > section')
    .filter({
      has: page.getByRole("heading", { level: 2, name: "Platform Engineer" }),
    });

  const halden = page.locator('section[aria-label="Applications ready to send"] > section').filter({
    has: page.getByRole("heading", { level: 2, name: "Site Reliability Engineer" }),
  });

  const northwindScheduled = page
    .locator('section[aria-label="Scheduled applications"] section')
    .filter({ hasText: "Northwind Labs" });

  const before = await readyOf(request);

  expect(before.ready).toBe(2);
  expect(before.approved).toBe(1);

  await halden.getByRole("button", { name: "Show answers, Halden Systems" }).click();
  await expect(halden.getByRole("button", { name: "Hide answers" })).toBeVisible();

  await halden
    .getByRole("button", {
      name: "Edit answer: Are you comfortable with a weekly on-call rotation?",
    })
    .click();

  const edited = "Yes. I have kept a weekly rotation for three years and would keep this one.";

  await halden
    .getByRole("textbox", {
      name: "Your answer to Are you comfortable with a weekly on-call rotation?",
    })
    .fill(edited);

  const saved = page.waitForResponse(
    (candidate) => candidate.request().method() === "PUT" && candidate.url().includes("/answers/"),
  );

  await halden.getByRole("button", { name: "Save" }).click();
  await saved;
  await expect(
    halden.getByRole("textbox", {
      name: "Your answer to Are you comfortable with a weekly on-call rotation?",
    }),
  ).toHaveCount(0);
  await expect(halden.getByText(edited, { exact: true })).toBeVisible();
  await expect(page.getByText("Answer saved.")).toBeVisible();

  const afterEdit = await readyOf(request);

  expect(afterEdit.ready).toBe(2);
  expect(afterEdit.approved).toBe(1);

  const skipped = page.waitForResponse(
    (candidate) => candidate.request().method() === "POST" && candidate.url().includes("/withdraw"),
  );

  await halden.getByRole("button", { name: "Skip" }).click();
  await skipped;
  await expect(halden).toHaveCount(0);

  const afterSkip = await readyOf(request);

  expect(afterSkip.ready).toBe(1);
  expect(afterSkip.cards.map((card) => card.company)).not.toContain("Halden Systems");

  const approved = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      /\/api\/applications\/[^/]+\/approve$/u.test(candidate.url()),
  );

  await northwind.getByRole("button", { name: "Send application" }).click();
  await page.getByRole("button", { name: "Yes, send application" }).click();
  await approved;
  await expect(northwindScheduled.getByText(/^Approved/u)).toBeVisible();
  await expect(page.getByText("Scheduled to send to Northwind Labs.")).toBeVisible();

  const afterSend = await readyOf(request);

  expect(afterSend.ready).toBe(0);
  expect(afterSend.approved).toBe(2);

  const undone = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" && candidate.url().includes("/unapprove"),
  );

  await northwindScheduled.getByRole("button", { name: "Undo" }).click();
  await undone;
  await expect(northwind.getByRole("button", { name: "Send application" })).toBeVisible();

  const afterUndo = await readyOf(request);

  expect(afterUndo.ready).toBe(1);
  expect(afterUndo.approved).toBe(1);

  const all = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" && candidate.url().endsWith("/api/ready/approve"),
  );

  await page.getByRole("button", { name: "Send all (1)" }).click();
  await page.getByRole("button", { name: "Yes, send all (1)" }).click();
  await all;
  await expect(northwindScheduled.getByText(/^Approved/u)).toBeVisible();

  const afterAll = await readyOf(request);

  expect(afterAll.ready).toBe(0);
  expect(afterAll.approved).toBe(2);

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
