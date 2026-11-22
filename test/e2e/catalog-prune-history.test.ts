import { z } from "zod";

import { test } from "./admin.fixture.ts";
import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect } from "./app.fixture.ts";
import {
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const DAY_MS = 86_400_000;
const NOW = 1_800_000_000_000;

const cardSchema = z.object({
  company: z.string(),
  location: z.string().nullable(),
  title: z.string(),
});

const boardSchema = z.object({
  columns: z.array(z.object({ cards: z.array(cardSchema), stage: z.string() })),
});

const readySchema = z.object({
  cards: z.array(
    z.object({
      company: z.string(),
      location: z.string().nullable(),
      title: z.string().nullable(),
    }),
  ),
});

const homeSchema = z.object({
  activity: z.object({
    sent: z.array(z.object({ company: z.string(), title: z.string() })),
  }),
  ready: z.object({ companies: z.array(z.string()) }),
});

const threadsSchema = z.object({
  threads: z.array(
    z.object({ company: z.string().nullable(), subject: z.string(), title: z.string().nullable() }),
  ),
});

const providerReportSchema = z.object({
  providers: z.array(
    z.object({
      ats: z.string(),
      attempted: z.number(),
      attemptCount: z.number(),
      completed: z.number(),
      costMicrosPerCompleted: z.number().nullable(),
    }),
  ),
});

const postingsSchema = z.object({ postings: z.array(z.object({ id: z.string() })) });

const COMPANY = "Ferro Cloud";
const TITLE = "Senior Platform Engineer";

interface Card {
  company: string;
  location: string | null;
  title: string | null;
}

function displayOf(cards: readonly Card[]) {
  const card = cards.find((candidate) => candidate.company === COMPANY);

  if (card === undefined) {
    throw new Error(`${COMPANY} is not on the page`);
  }

  return { company: card.company, location: card.location, title: card.title };
}

test("Board, Ready, Inbox and the cost report keep reading user history after the catalog is pruned", async ({
  page,
  captureAppServer,
  captureAppUrl,
  accessServer,
}) => {
  const { owner, userId } = await ownerContextFor(captureAppServer.url);

  const companyId = await seedCompany(owner, COMPANY, "ferro.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "ferro");

  const postingId = await seedPosting(owner, {
    atsJobId: "ferro-1",
    boardId,
    companyId,
    locationRaw: "Remote — Canada",
    salaryCurrency: "CAD",
    salaryMinMinor: 16_000_000,
    salaryPeriod: "year",
    title: TITLE,
    url: "https://boards.example/jobs/1",
  });

  const sentId = await seedApplication(owner, {
    createdAt: NOW - 3 * DAY_MS,
    postingId,
    sentAt: NOW - 2 * DAY_MS,
    status: "sent",
    userId,
  });

  await seedApplication(owner, {
    createdAt: NOW - 2 * DAY_MS,
    postingId: await seedPosting(owner, {
      atsJobId: "ferro-2",
      boardId,
      companyId,
      locationRaw: "Remote — Canada",
      title: TITLE,
      url: "https://boards.example/jobs/2",
    }),
    readyAt: NOW - DAY_MS,
    status: "ready",
    userId,
  });

  const mail = await owner.post("/__test__/mail/seed", {
    data: {
      applicationId: sentId,
      auth: "pass",
      classification: "interview",
      direction: "in",
      from: "Recruiting <jobs@ferro.example>",
      senderDomain: "ferro.example",
      subject: `Next step for ${TITLE}`,
      text: `We would like to talk about the ${TITLE} role.`,
      userId,
    },
  });

  expect(mail.ok()).toBe(true);

  const attempt = await owner.post("/__test__/attempts/seed", {
    data: {
      applicationId: sentId,
      browserMs: 60_000,
      costMicros: 20_000,
      n: 1,
      outcome: "sent",
      provider: "browser_use",
      proxyBytes: 1_000_000,
      startedAt: NOW - 2 * DAY_MS,
      userId,
    },
  });

  expect(attempt.ok()).toBe(true);

  async function views() {
    const board = boardSchema.parse(await (await owner.get("/api/board")).json());
    const ready = readySchema.parse(await (await owner.get("/api/ready")).json());
    const home = homeSchema.parse(await (await owner.get("/api/home")).json());
    const threads = threadsSchema.parse(await (await owner.get("/api/threads")).json());

    return {
      board: displayOf(board.columns.flatMap((column) => column.cards)),
      home: {
        readyCompanies: home.ready.companies,
        sent: home.activity.sent
          .filter((row) => row.company === COMPANY)
          .map((row) => ({ company: row.company, title: row.title })),
      },
      ready: displayOf(ready.cards).company,
      threads: threads.threads
        .filter((thread) => thread.company === COMPANY)
        .map((thread) => ({ company: thread.company, title: thread.title })),
    };
  }

  const before = await views();

  expect(before.board).toEqual({ company: COMPANY, location: "Remote — Canada", title: TITLE });
  expect(before.ready).toBe(COMPANY);
  expect(before.home.sent).toEqual([{ company: COMPANY, title: TITLE }]);
  expect(before.home.readyCompanies).toContain(COMPANY);
  expect(before.threads).toEqual([{ company: COMPANY, title: TITLE }]);

  await openAdminAsOwner(page, captureAppUrl, accessServer.issueToken);

  const report = providerReportSchema.parse(
    await (await page.request.get(`${captureAppUrl}/admin/api/provider-report`)).json(),
  );

  const greenhouse = report.providers.find((row) => row.ats === "greenhouse");

  expect(greenhouse).toMatchObject({ attempted: 1, attemptCount: 1, completed: 1 });

  const pruned = await owner.post("/__test__/catalog/prune", { data: {} });

  expect(pruned.ok()).toBe(true);
  expect(
    postingsSchema.parse(await (await owner.get("/__test__/catalog/postings")).json()),
  ).toEqual({
    postings: [],
  });

  expect(await views()).toEqual(before);

  const after = providerReportSchema.parse(
    await (await page.request.get(`${captureAppUrl}/admin/api/provider-report`)).json(),
  );

  expect(after.providers.find((row) => row.ats === "greenhouse")).toEqual(greenhouse);

  await page.goto(`${captureAppUrl}/board`);
  await expect(page.getByText(COMPANY).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(TITLE).filter({ visible: true }).first()).toBeVisible();

  await page.locator(`section[aria-label="Applied"] button[data-card="${sentId}"]`).click();

  const sheet = page.locator('aside[aria-label="Application detail"]');

  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText(TITLE);
  await expect(sheet.getByText(COMPANY).first()).toBeVisible();

  await page.goto(`${captureAppUrl}/ready`);
  await expect(page.getByText(COMPANY).filter({ visible: true }).first()).toBeVisible();

  await page.goto(`${captureAppUrl}/inbox`);
  await expect(page.getByText(COMPANY).filter({ visible: true }).first()).toBeVisible();

  await page.goto(`${captureAppUrl}/admin/provider-report`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("greenhouse").filter({ visible: true }).first()).toBeVisible();
});
