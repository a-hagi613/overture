import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "./app.fixture.ts";
import {
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const detailSchema = z.object({
  application: z.object({
    readyAt: z.number().nullable(),
    stage: z.string().nullable(),
    status: z.string(),
  }),
});

async function applicationOf(owner: APIRequestContext, applicationId: string) {
  return detailSchema.parse(
    await (await owner.get(`/api/applications/${encodeURIComponent(applicationId)}`)).json(),
  ).application;
}

async function moveTo(owner: APIRequestContext, applicationId: string, status: string) {
  const response = await owner.post("/__test__/applications/status", {
    data: { applicationId, status },
  });

  expect(response.ok()).toBe(true);
}

test("the Ready Stage holds ready, approved, sending and confirming, and a failure leaves the Board", async ({
  isolatedAppServer: { url },
}) => {
  const { owner, userId } = await ownerContextFor(url);
  const companyId = await seedCompany(owner, "Stage Co", "stage.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "stage-co");

  const postingId = await seedPosting(owner, {
    atsJobId: "stage-1",
    boardId,
    companyId,
    url: "https://stage.example/1",
  });

  const applicationId = await seedApplication(owner, { postingId, status: "ready", userId });

  expect((await applicationOf(owner, applicationId)).stage).toBe("ready");

  await moveTo(owner, applicationId, "approved");

  expect((await applicationOf(owner, applicationId)).stage).toBe("ready");

  await moveTo(owner, applicationId, "sending");

  expect((await applicationOf(owner, applicationId)).stage).toBe("ready");

  await moveTo(owner, applicationId, "confirming");

  expect((await applicationOf(owner, applicationId)).stage).toBe("ready");

  await moveTo(owner, applicationId, "sent");

  expect((await applicationOf(owner, applicationId)).stage).toBe("applied");

  await moveTo(owner, applicationId, "failed");

  expect((await applicationOf(owner, applicationId)).stage).toBeNull();

  await owner.dispose();
});
