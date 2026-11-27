import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import type { AppServer } from "./app-server.ts";

import { AxeBuilder } from "@axe-core/playwright";
import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test as appTest } from "./app.fixture.ts";
import {
  approveApplication,
  configureMatching,
  grantApplications,
  ownerContextFor,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const test = appTest.extend<{ homeServer: AppServer }>({
  homeServer: [
    async ({ isolatedAppServer }, provide) => {
      await provide(isolatedAppServer);
    },
    { scope: "test" },
  ],
});

const serverNow = Date.UTC(2026, 10, 17, 11, 15, 0);

const homeBoardSchema = z.object({
  applicationsLeft: z.number(),
  nextSendAt: z.number().nullable(),
  pauseReason: z.string().nullable(),
  planApplications: z.number(),
  queued: z.number(),
  ranges: z.object({
    "7D": z.object({
      applicationsSent: z.number(),
      chart: z.object({
        labels: z.array(z.string()),
        per: z.string(),
        points: z.array(z.object({ at: z.number(), count: z.number() })),
      }),
      interviewsBooked: z.number(),
      replies: z.number(),
      sentDelta: z.number(),
    }),
  }),
  recentInbox: z.array(
    z.object({
      company: z.string(),
      detail: z.string().nullable(),
      kind: z.string(),
      text: z.string(),
    }),
  ),
  reviews: z.object({
    applications: z.number(),
    list: z.array(
      z.object({
        companies: z.array(z.string()),
        companyCount: z.number(),
        prompt: z.string(),
        unlocked: z.number(),
      }),
    ),
    total: z.number(),
  }),
  running: z.boolean(),
  sentToday: z.number(),
});

async function moveClockTo(request: APIRequestContext, target: number) {
  const current = z
    .object({ now: z.number() })
    .parse(await (await request.get("/__test__/clock")).json());

  const moved = await request.post("/__test__/clock/offset", {
    data: { offsetMs: target - current.now },
  });

  expect(moved.ok()).toBe(true);
}

async function storeFor(appServerUrl: string) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post("/__test__/user/name", {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });

  return request;
}

async function seedReadyApplications(
  owner: Awaited<ReturnType<typeof ownerContextFor>>["owner"],
  userId: string,
  count: number,
) {
  await configureMatching(owner);
  await grantApplications(owner, 70);

  const companyId = await seedCompany(owner, "Northwind Labs", "northwind.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "northwind");

  return Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const postingId = await seedPosting(owner, {
        atsJobId: `home-${String(index)}`,
        boardId,
        companyId,
        title: "Platform Engineer",
        url: `https://northwind.example/${String(index)}`,
      });

      const response = await owner.post("/__test__/applications/seed", {
        data: {
          createdAt: index + 1,
          origin: "pick",
          postingId,
          status: "ready",
          userId,
        },
      });

      return z.object({ id: z.string() }).parse(await response.json()).id;
    }),
  );
}

test("the Start/Pause switch flips running and the page updates over SSE", async ({
  browser,
  homeServer,
}) => {
  const request = await storeFor(homeServer.url);

  await moveClockTo(request, serverNow);
  await request.post("/__test__/home/sample", { data: { email: authTestIdentity.ownerEmail } });

  const storageState = await request.storageState();

  const context = await browser.newContext({
    storageState,
    viewport: { height: 900, width: 1280 },
  });

  const page = await context.newPage();

  await page.clock.setFixedTime(new Date(2026, 10, 17, 11, 0, 0));
  await page.goto(`${homeServer.url}/home`);

  await expect(page.getByRole("heading", { name: "Application sending" })).toBeVisible();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Pause sending" }).click();

  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Application sending" })).toBeVisible();
  await expect(page.getByText("Nothing new will send until you resume.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();

  const paused = await request.get("/api/home");

  expect(z.object({ running: z.boolean() }).parse(await paused.json()).running).toBe(false);

  await page.getByRole("button", { name: "Resume" }).click();

  await expect(page.getByText("Active", { exact: true })).toBeVisible();

  await request.post("/api/running", { data: { running: false } });

  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();

  await context.close();
  await request.dispose();
});

test("Queue position and next send time match the planner", async ({ homeServer }) => {
  const { owner, userId } = await ownerContextFor(homeServer.url);

  await owner.post("/api/running", { data: { running: true } });
  await moveClockTo(owner, serverNow);

  await Promise.all(
    (await seedReadyApplications(owner, userId, 5)).map(async (applicationId) =>
      approveApplication(owner, applicationId),
    ),
  );

  const start = await owner.post("/api/running", { data: { running: true } });

  expect(z.object({ running: z.boolean() }).parse(await start.json()).running).toBe(true);

  const run = await owner.post("/__test__/jobs/run-now", {
    data: { kind: "planner.day", payload: JSON.stringify({ userId }) },
  });

  expect(run.ok()).toBe(true);

  const applications = z
    .object({
      applications: z.array(
        z.object({ id: z.string(), scheduledFor: z.number().nullable(), status: z.string() }),
      ),
    })
    .parse(await (await owner.get(`/__test__/applications?userId=${userId}`)).json());

  const approved = applications.applications.filter(
    (application) => application.status === "approved",
  );

  const slots = approved.flatMap((application) =>
    application.scheduledFor === null ? [] : [application.scheduledFor],
  );

  expect(slots.length).toBeGreaterThan(0);

  const home = homeBoardSchema.parse(await (await owner.get("/api/home")).json());

  expect(home.queued).toBe(5);
  expect(home.nextSendAt).toBe(Math.min(...slots));

  await owner.dispose();
});

test("the paused Home reports its activity, queue place, check-in and strengthen prompt", async ({
  homeServer,
}) => {
  const { owner } = await ownerContextFor(homeServer.url);

  await moveClockTo(owner, serverNow);
  await owner.post("/__test__/home/sample", {
    data: { email: authTestIdentity.ownerEmail, variant: "paused" },
  });

  const paused = z
    .object({
      activity: z.object({
        failed: z.array(z.object({ company: z.string(), reason: z.string(), title: z.string() })),
        sent: z.array(z.object({ company: z.string(), status: z.string(), title: z.string() })),
      }),
      applicationsLeft: z.number(),
      checkInDue: z.number(),
      pauseReason: z.string().nullable(),
      queue: z.object({ position: z.number().nullable(), sendAt: z.number().nullable() }),
      strengthen: z.object({ missing: z.number() }).nullable(),
    })
    .parse(await (await owner.get("/api/home")).json());

  expect(paused.pauseReason).toBe("user");
  expect(paused.queue).toEqual({ position: 3, sendAt: Date.UTC(2026, 10, 17, 14, 20, 0) });
  expect(paused.checkInDue).toBe(1);
  expect(paused.strengthen).toEqual({ missing: 2 });

  expect(paused.activity.sent).toEqual([
    { company: "Northwind Labs", status: "sent", title: "Site Reliability Engineer" },
    { company: "Halden Systems", status: "sent", title: "Platform Engineer" },
    { company: "Larkspur Health", status: "sent", title: "Backend Engineer" },
  ]);
  expect(paused.activity.failed).toEqual([
    {
      company: "Ferro Cloud",
      reason: "The form changed after we had filled it in, so we stopped before sending.",
      title: "DevOps Engineer",
    },
  ]);

  expect(paused.applicationsLeft).toBe(63);

  await owner.dispose();
});

test("Home reports the board ranges, the open Reviews and the recent Inbox", async ({
  homeServer,
}) => {
  const { owner } = await ownerContextFor(homeServer.url);

  await moveClockTo(owner, serverNow);
  await owner.post("/__test__/home/sample", { data: { email: authTestIdentity.ownerEmail } });

  const response = await owner.get("/api/home");
  const body: unknown = await response.json();
  const home = homeBoardSchema.parse(body);

  expect(body).not.toHaveProperty("nextPrepAt");
  expect(home.running).toBe(true);
  expect(home.applicationsLeft).toBe(63);
  expect(home.planApplications).toBe(70);
  expect(home.sentToday).toBe(7);
  expect(home.queued).toBe(12);
  expect(home.nextSendAt).toBe(Date.UTC(2026, 10, 17, 11, 40, 0));
  expect(home.ranges["7D"].applicationsSent).toBe(37);
  expect(home.ranges["7D"].sentDelta).toBe(6);
  expect(home.ranges["7D"].replies).toBe(9);
  expect(home.ranges["7D"].interviewsBooked).toBe(3);
  expect(home.ranges["7D"].chart.labels).toEqual(["Wed", "Thu", "Fri", "Sat", "Sun", "Mon", "Tue"]);
  expect(home.ranges["7D"].chart.points.map((point) => point.count)).toEqual([3, 5, 4, 6, 7, 5, 7]);

  expect(home.reviews.total).toBe(4);
  expect(home.reviews.applications).toBe(10);
  expect(home.reviews.list.map((review) => review.unlocked)).toEqual([4, 3, 2, 1]);
  expect(home.reviews.list[0]?.companies).toEqual(["Northwind Labs", "Ferro Cloud"]);
  expect(home.reviews.list[0]?.companyCount).toBe(4);

  expect(home.recentInbox).toHaveLength(4);
  expect(home.recentInbox[0]).toEqual({
    company: "Halden Systems",
    detail: "Moved from Screening to Interviewing",
    kind: "other",
    text: "replied: can you do Thursday at 2 pm?",
  });
  expect(home.recentInbox[1]).toEqual({
    company: "Northwind Labs",
    detail: "Filed under Applied",
    kind: "ack",
    text: "confirmed they received your application",
  });
  expect(home.recentInbox[2]?.detail).toBe("Moved from Applied to Screening");
  expect(home.recentInbox[3]?.detail).toBe("Moved to Closed");

  await owner.dispose();
});

test("Home puts actions above the chart and the outcomes strip follows 7D, 30D and 90D", async ({
  browser,
  homeServer,
}) => {
  const request = await storeFor(homeServer.url);

  await moveClockTo(request, serverNow);
  await request.post("/__test__/home/sample", { data: { email: authTestIdentity.ownerEmail } });

  const storageState = await request.storageState();

  await request.dispose();

  async function checkWidth(width: number) {
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      storageState,
      viewport: { height: 900, width },
    });

    const page = await context.newPage();

    try {
      await page.clock.setFixedTime(new Date(2026, 10, 17, 11, 0, 0));
      await page.goto(`${homeServer.url}/home`);

      await expect(page.getByText("Active", { exact: true })).toBeVisible();

      const chartCard = page.getByTestId("home-chart");

      await expect(chartCard).toBeVisible();
      await expect(chartCard.getByRole("heading", { name: "Applications sent" })).toBeVisible();
      await expect(chartCard.getByText("37", { exact: true })).toBeVisible();
      await expect(chartCard.getByText("applications", { exact: true })).toBeVisible();
      await expect(chartCard.getByText("+6", { exact: true })).toBeVisible();

      const chart = await chartCard.boundingBox();
      const failuresBox = await page.getByTestId("home-failures").boundingBox();

      expect(chart).not.toBeNull();
      expect(failuresBox).not.toBeNull();

      if (failuresBox !== null && chart !== null) {
        expect(failuresBox.y, `${String(width)}px failures above chart`).toBeLessThan(chart.y);
      }

      await expect(page.locator("#home-ready-title")).toBeVisible();
      await expect(page.locator("#home-needs-you")).toBeVisible();
      await expect(page.getByTestId("home-failures")).toContainText("Not sent");
      await expect(page.getByTestId("home-failures")).toContainText("Ferro Cloud, DevOps Engineer");

      await chartCard.getByRole("button", { name: "30D" }).click();
      await expect(chartCard.getByText("69", { exact: true })).toBeVisible();
      await expect(chartCard.getByText("+69", { exact: true })).toBeVisible();
      await expect(chartCard.getByText("applications", { exact: true })).toBeVisible();

      await chartCard.getByRole("button", { name: "90D" }).click();
      await expect(chartCard.getByText("69", { exact: true })).toBeVisible();
      await expect(chartCard.getByText("Weekly", { exact: true })).toBeVisible();

      await chartCard.getByRole("button", { name: "7D" }).click();
      await expect(chartCard.getByText("37", { exact: true })).toBeVisible();
      await expect(chartCard.getByText("Daily", { exact: true })).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );

      expect(overflow, `${String(width)}px`).toBe(false);
    } finally {
      await context.close();
    }
  }

  await Promise.all([checkWidth(1280), checkWidth(390)]);
});

test("Home shows All caught up when nothing waits", async ({ browser, homeServer }) => {
  const request = await storeFor(homeServer.url);

  await moveClockTo(request, serverNow);
  await request.post("/__test__/home/sample", {
    data: { email: authTestIdentity.ownerEmail, variant: "caught_up" },
  });

  const storageState = await request.storageState();

  await request.dispose();

  async function checkVariant(width: number, theme: string) {
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      storageState,
      viewport: { height: 900, width },
    });

    const page = await context.newPage();

    try {
      await page.clock.setFixedTime(new Date(2026, 10, 17, 11, 0, 0));

      if (theme === "dark") {
        await page.addInitScript(() => {
          globalThis.localStorage.setItem("overture.theme", "dark");
        });
      }

      await page.goto(`${homeServer.url}/home`);

      const caughtUp = page.getByTestId("home-caught-up");

      await expect(caughtUp).toBeVisible();
      await expect(page.getByRole("heading", { name: "All caught up" })).toBeVisible();
      await expect(caughtUp).not.toContainText("Next preparation run");
      await expect(page.getByTestId("home-failures")).toHaveCount(0);
      await expect(page.locator("#home-needs-you")).toHaveCount(0);
      await expect(page.locator("#home-ready-title")).toHaveCount(0);
      await expect(page.getByTestId("home-chart")).toBeVisible();

      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const results = await new AxeBuilder({ page }).analyze();

      expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );

      expect(overflow, `${String(width)}px ${theme}`).toBe(false);
    } finally {
      await context.close();
    }
  }

  await Promise.all([
    checkVariant(1280, "light"),
    checkVariant(1280, "dark"),
    checkVariant(390, "light"),
    checkVariant(390, "dark"),
  ]);
});
