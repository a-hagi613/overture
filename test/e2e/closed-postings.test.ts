import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "@playwright/test";
import { startCatalogHarness } from "./catalog-harness.ts";
import { ownerContextFor, seedApplication, seedPosting } from "./matching-harness.ts";

const BOARD_TOKEN = "vercel";

const applicationDetailSchema = z.object({
  application: z.object({
    stage: z.string().nullable(),
    status: z.string(),
    statusReason: z.string().nullable(),
  }),
  timeline: z.array(
    z.object({
      detail: z.string().nullable(),
      fromValue: z.string().nullable(),
      kind: z.string(),
      toValue: z.string().nullable(),
    }),
  ),
});

const homeActivitySchema = z.object({
  activity: z.object({
    failed: z.array(
      z.object({
        company: z.string(),
        id: z.string(),
        reason: z.string(),
        title: z.string(),
      }),
    ),
  }),
});

const postingClosedReason = "The role closed before Overture could send.";

async function applicationDetailFor(owner: APIRequestContext, applicationId: string) {
  const response = await owner.get(`/api/applications/${encodeURIComponent(applicationId)}`);

  return applicationDetailSchema.parse(await response.json());
}

async function homeActivity(owner: APIRequestContext) {
  return homeActivitySchema.parse(await (await owner.get("/api/home")).json());
}

test("the catalog sweep skips ready and approved Applications whose Posting closes, and Home says why", async () => {
  const harness = await startCatalogHarness([BOARD_TOKEN]);

  try {
    const { owner, userId } = await ownerContextFor(harness.app.url);
    const boardId = harness.boardIds[BOARD_TOKEN] ?? "";

    const readyPosting = await seedPosting(owner, {
      atsJobId: "9000001",
      boardId,
      companyId: harness.companyId,
      title: "Ready Role That Closes",
      url: `${harness.fixture.url}/vercel/jobs/9000001`,
    });

    const approvedPosting = await seedPosting(owner, {
      atsJobId: "9000002",
      boardId,
      companyId: harness.companyId,
      title: "Approved Role That Closes",
      url: `${harness.fixture.url}/vercel/jobs/9000002`,
    });

    const readyApplication = await seedApplication(owner, {
      postingId: readyPosting,
      status: "ready",
      userId,
    });

    const approvedApplication = await seedApplication(owner, {
      postingId: approvedPosting,
      status: "approved",
      userId,
    });

    await harness.runBackfillCycle();

    const afterFirstPoll = (await harness.postings()).filter(
      (posting) => posting.atsJobId === "9000001" || posting.atsJobId === "9000002",
    );

    expect(afterFirstPoll).toHaveLength(2);
    expect(afterFirstPoll.map((posting) => posting.closedAt)).toEqual([null, null]);
    expect((await applicationDetailFor(owner, readyApplication)).application.status).toBe("ready");
    expect((await applicationDetailFor(owner, approvedApplication)).application.status).toBe(
      "approved",
    );

    await harness.runBackfillCycle();

    const afterSecondPoll = (await harness.postings()).filter(
      (posting) => posting.atsJobId === "9000001" || posting.atsJobId === "9000002",
    );

    expect(afterSecondPoll).toHaveLength(2);
    expect(afterSecondPoll.every((posting) => posting.closedAt !== null)).toBe(true);

    const readyDetail = await applicationDetailFor(owner, readyApplication);
    const approvedDetail = await applicationDetailFor(owner, approvedApplication);

    for (const detail of [readyDetail, approvedDetail]) {
      expect(detail.application.status).toBe("skipped");
      expect(detail.application.statusReason).toBe("posting_closed");
      expect(detail.application.stage).toBeNull();

      const reasonEvent = detail.timeline.find(
        (event) => event.kind === "status" && event.toValue === "skipped",
      );

      expect(reasonEvent?.detail).toBe(postingClosedReason);
    }

    expect(readyDetail.timeline.at(-1)?.fromValue).toBe("ready");
    expect(approvedDetail.timeline.at(-1)?.fromValue).toBe("approved");

    const home = await homeActivity(owner);

    expect(home.activity.failed).toHaveLength(1);
    expect(home.activity.failed[0]?.reason).toBe(postingClosedReason);
    expect(["Ready Role That Closes", "Approved Role That Closes"]).toContain(
      home.activity.failed[0]?.title,
    );

    await owner.dispose();
  } finally {
    await harness.close();
  }
});
