import { z } from "zod";

import type { APIRequestContext, Browser } from "@playwright/test";

import { expect, test } from "./app.fixture.ts";
import {
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const DAY = 24 * 60 * 60_000;

const SENT_AT = Date.UTC(2026, 10, 20, 15, 0, 0);

const detailSchema = z.object({
  application: z.object({
    closedReason: z.string().nullable(),
    stage: z.string().nullable(),
    status: z.string(),
  }),
});

const homeSchema = z.object({
  checkInDue: z.number(),
  checkIns: z.array(
    z.object({
      applicationId: z.string(),
      company: z.string(),
      days: z.number(),
      id: z.string(),
      title: z.string(),
    }),
  ),
});

const notificationsSchema = z.object({
  notifications: z.array(z.object({ body: z.string(), title: z.string() })),
});

async function moveClockTo(request: APIRequestContext, target: number) {
  const current = z
    .object({ now: z.number(), offsetMs: z.number() })
    .parse(await (await request.get("/__test__/clock")).json());

  const moved = await request.post("/__test__/clock/offset", {
    data: { offsetMs: target - current.now + current.offsetMs },
  });

  expect(moved.ok()).toBe(true);
}

async function runCheckinSweep(request: APIRequestContext) {
  const response = await request.post("/__test__/jobs/run-now", {
    data: { kind: "checkin.sweep", payload: "{}" },
  });

  expect(response.ok()).toBe(true);
}

async function seededApplication(owner: APIRequestContext, userId: string, atsJobId: string) {
  const companyId = await seedCompany(owner, "Acme", "acme.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", atsJobId);

  const postingId = await seedPosting(owner, {
    atsJobId,
    boardId,
    companyId,
    title: "Senior Backend Engineer",
    url: `https://acme.example/${atsJobId}`,
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    sentAt: SENT_AT,
    status: "sent",
    userId,
  });

  return applicationId;
}

async function applicationOf(owner: APIRequestContext, applicationId: string) {
  return detailSchema.parse(
    await (await owner.get(`/api/applications/${encodeURIComponent(applicationId)}`)).json(),
  ).application;
}

async function homeOf(owner: APIRequestContext) {
  return homeSchema.parse(await (await owner.get("/api/home")).json());
}

async function notificationsOf(owner: APIRequestContext, userId: string) {
  return notificationsSchema.parse(
    await (await owner.get(`/__test__/notifications?userId=${encodeURIComponent(userId)}`)).json(),
  ).notifications;
}

async function openHome(
  browser: Browser,
  appServerUrl: string,
  storage: Awaited<ReturnType<APIRequestContext["storageState"]>>,
) {
  const context = await browser.newContext({ deviceScaleFactor: 1, storageState: storage });
  const page = await context.newPage();

  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto(`${appServerUrl}/`);
  await expect(
    page.getByRole("heading", { level: 1, name: /Good (?:morning|afternoon|evening),/u }),
  ).toBeVisible();

  return { context, page };
}

test("a Check-in opens at 21 days, the card closes as No response at 45, and Undo restores it", async ({
  isolatedAppServer: { url },
}) => {
  const { owner, userId } = await ownerContextFor(url);

  await moveClockTo(owner, SENT_AT);

  const applicationId = await seededApplication(owner, userId, "checkin-close-1");

  await moveClockTo(owner, SENT_AT + 20 * DAY);
  await runCheckinSweep(owner);

  expect((await homeOf(owner)).checkIns).toEqual([]);

  await moveClockTo(owner, SENT_AT + 21 * DAY);
  await runCheckinSweep(owner);

  const due = await homeOf(owner);

  expect(due.checkInDue).toBe(1);
  expect(due.checkIns).toHaveLength(1);
  expect(due.checkIns[0]?.applicationId).toBe(applicationId);
  expect(due.checkIns[0]?.company).toBe("Acme");
  expect(due.checkIns[0]?.days).toBe(21);

  await moveClockTo(owner, SENT_AT + 44 * DAY);
  await runCheckinSweep(owner);

  const beforeClose = await applicationOf(owner, applicationId);

  expect(beforeClose.stage).toBe("applied");
  expect(beforeClose.closedReason).toBeNull();

  await moveClockTo(owner, SENT_AT + 45 * DAY);
  await runCheckinSweep(owner);

  const closed = await applicationOf(owner, applicationId);

  expect(closed.stage).toBe("closed");
  expect(closed.closedReason).toBe("no_response");
  expect((await homeOf(owner)).checkIns).toEqual([]);

  const notifications = await notificationsOf(owner, userId);

  expect(notifications.at(-1)?.title).toBe("Closed as No response");

  const undone = await owner.post(
    `/api/applications/${encodeURIComponent(applicationId)}/undo-stage`,
  );

  expect(undone.ok()).toBe(true);

  const restored = await applicationOf(owner, applicationId);

  expect(restored.stage).toBe("applied");
  expect(restored.closedReason).toBeNull();

  await runCheckinSweep(owner);

  const afterUndo = await applicationOf(owner, applicationId);

  expect(afterUndo.stage).toBe("applied");
  expect((await homeOf(owner)).checkIns).toEqual([]);

  await owner.dispose();
});

test("the three Check-in answers move the card, and Still waiting restarts the wait", async ({
  isolatedAppServer: { url },
}) => {
  const { owner, userId } = await ownerContextFor(url);

  await moveClockTo(owner, SENT_AT);

  const rejectedId = await seededApplication(owner, userId, "checkin-answer-1");

  await moveClockTo(owner, SENT_AT + 21 * DAY);
  await runCheckinSweep(owner);

  const first = await homeOf(owner);

  expect(first.checkIns.map((checkIn) => checkIn.applicationId)).toContain(rejectedId);

  const rejectedCheckin = first.checkIns.find((checkIn) => checkIn.applicationId === rejectedId);

  const answered = await owner.post(
    `/api/checkins/${encodeURIComponent(rejectedCheckin?.id ?? "")}`,
    {
      data: { answer: "rejected" },
    },
  );

  expect(answered.ok()).toBe(true);

  const rejected = await applicationOf(owner, rejectedId);

  expect(rejected.stage).toBe("closed");
  expect(rejected.closedReason).toBe("rejected");

  const waitingId = await seededApplication(owner, userId, "checkin-answer-2");

  await moveClockTo(owner, SENT_AT + 22 * DAY);
  await runCheckinSweep(owner);

  const second = await homeOf(owner);
  const waiting = second.checkIns.find((checkIn) => checkIn.applicationId === waitingId);

  const stillWaiting = await owner.post(`/api/checkins/${encodeURIComponent(waiting?.id ?? "")}`, {
    data: { answer: "still_waiting" },
  });

  expect(stillWaiting.ok()).toBe(true);
  expect((await homeOf(owner)).checkIns).toEqual([]);
  expect((await applicationOf(owner, waitingId)).stage).toBe("applied");

  await moveClockTo(owner, SENT_AT + 44 * DAY);
  await runCheckinSweep(owner);

  const again = await homeOf(owner);

  expect(again.checkIns.map((checkIn) => checkIn.applicationId)).toEqual([waitingId]);
  expect(again.checkIns[0]?.days).toBe(44);

  const interviewing = await owner.post(
    `/api/checkins/${encodeURIComponent(again.checkIns[0]?.id ?? "")}`,
    { data: { answer: "interviewing" } },
  );

  expect(interviewing.ok()).toBe(true);

  const moved = await applicationOf(owner, waitingId);

  expect(moved.stage).toBe("interviewing");
  expect(moved.closedReason).toBeNull();
  expect((await homeOf(owner)).checkIns).toEqual([]);

  await owner.dispose();
});

test("linked employer mail prevents the Check-in and the close", async ({
  isolatedAppServer: { url },
}) => {
  const { owner, userId } = await ownerContextFor(url);

  await moveClockTo(owner, SENT_AT);

  const linkedId = await seededApplication(owner, userId, "checkin-mail-1");
  const lateId = await seededApplication(owner, userId, "checkin-mail-2");

  await owner.post("/__test__/mail/seed", {
    data: {
      applicationId: linkedId,
      at: SENT_AT + 2 * DAY,
      classification: "ack",
      from: "no-reply@us.greenhouse-mail.io",
      senderDomain: "us.greenhouse-mail.io",
      subject: "We received your application",
      text: "Thanks for applying to Acme. We have your application.",
      userId,
    },
  });

  await moveClockTo(owner, SENT_AT + 21 * DAY);
  await runCheckinSweep(owner);

  const withoutMail = await homeOf(owner);

  expect(withoutMail.checkIns.map((checkIn) => checkIn.applicationId)).toEqual([lateId]);

  await owner.post("/__test__/mail/seed", {
    data: {
      applicationId: lateId,
      at: SENT_AT + 22 * DAY,
      classification: "interview",
      from: "no-reply@us.greenhouse-mail.io",
      senderDomain: "us.greenhouse-mail.io",
      subject: "Interview invitation",
      text: "Can you meet the team next week?",
      userId,
    },
  });

  await moveClockTo(owner, SENT_AT + 23 * DAY);
  await runCheckinSweep(owner);

  expect((await homeOf(owner)).checkIns).toEqual([]);

  await moveClockTo(owner, SENT_AT + 60 * DAY);
  await runCheckinSweep(owner);

  const linked = await applicationOf(owner, linkedId);
  const late = await applicationOf(owner, lateId);

  expect(linked.stage).toBe("applied");
  expect(linked.closedReason).toBeNull();
  expect(late.stage).toBe("applied");
  expect(late.closedReason).toBeNull();

  await owner.dispose();
});

test("one tap on the Check-in card closes the card as Rejected", async ({
  browser,
  isolatedAppServer: { url },
}) => {
  const { owner, userId } = await ownerContextFor(url);

  await moveClockTo(owner, SENT_AT);

  const applicationId = await seededApplication(owner, userId, "checkin-tap-1");

  await moveClockTo(owner, SENT_AT + 21 * DAY);
  await runCheckinSweep(owner);

  const storage = await owner.storageState();
  const { context, page } = await openHome(browser, url, storage);

  const card = page.getByRole("region", { name: "How is the search going?" });

  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Start check-in" }).click();
  await expect(card.getByText("Senior Backend Engineer")).toBeVisible();
  await expect(card.getByText("Acme · twenty-one days in Applied")).toBeVisible();

  await card
    .getByRole("button", {
      name: "Rejected: Senior Backend Engineer at Acme",
    })
    .click();

  await expect(card).toHaveCount(0);

  const rejected = await applicationOf(owner, applicationId);

  expect(rejected.stage).toBe("closed");
  expect(rejected.closedReason).toBe("rejected");

  await context.close();
  await owner.dispose();
});
