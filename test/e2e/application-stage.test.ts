import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { BOARD_STAGES } from "../../src/shared/board.ts";
import { applications } from "../../src/server/platform/db/schema.ts";
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

async function moveStage(owner: APIRequestContext, applicationId: string, stage: string) {
  return owner.patch(`/api/applications/${encodeURIComponent(applicationId)}/stage`, {
    data: { position: null, stage },
  });
}

async function withdraw(owner: APIRequestContext, applicationId: string) {
  return owner.post(`/api/applications/${encodeURIComponent(applicationId)}/withdraw`);
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

async function expectInFlightRefusal(
  owner: APIRequestContext,
  input: { boardId: string; companyId: string; status: "confirming" | "sending"; userId: string },
) {
  const postingId = await seedPosting(owner, {
    atsJobId: `inflight-${input.status}`,
    boardId: input.boardId,
    companyId: input.companyId,
    url: `https://inflight.example/${input.status}`,
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: input.status,
    userId: input.userId,
  });

  expect((await moveStage(owner, applicationId, "screening")).status()).toBe(409);
  expect((await withdraw(owner, applicationId)).status()).toBe(409);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.status).toBe(input.status);
  expect(detail.stage).toBe("ready");
}

test("an in-flight sending or confirming Application cannot be dragged or withdrawn", async ({
  isolatedAppServer: { url },
}) => {
  const { owner, userId } = await ownerContextFor(url);
  const companyId = await seedCompany(owner, "In Flight Co", "inflight.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "inflight-co");

  await expectInFlightRefusal(owner, { boardId, companyId, status: "sending", userId });
  await expectInFlightRefusal(owner, { boardId, companyId, status: "confirming", userId });

  await owner.dispose();
});

test("a sent Application moves within Applied…Closed but never back to Queued, and cannot be withdrawn", async ({
  isolatedAppServer: { url },
}) => {
  const { owner, userId } = await ownerContextFor(url);
  const companyId = await seedCompany(owner, "Sent Co", "sent.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "sent-co");

  const postingId = await seedPosting(owner, {
    atsJobId: "sent-1",
    boardId,
    companyId,
    url: "https://sent.example/1",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    sentAt: 1_700_000_000_000,
    status: "sent",
    userId,
  });

  expect((await applicationOf(owner, applicationId)).stage).toBe("applied");

  expect((await moveStage(owner, applicationId, "queued")).status()).toBe(409);
  expect((await moveStage(owner, applicationId, "ready")).status()).toBe(409);

  const afterRefusedMove = await applicationOf(owner, applicationId);

  expect(afterRefusedMove.stage).toBe("applied");
  expect(afterRefusedMove.status).toBe("sent");

  expect((await withdraw(owner, applicationId)).status()).toBe(409);

  const afterRefusedWithdraw = await applicationOf(owner, applicationId);

  expect(afterRefusedWithdraw.status).toBe("sent");

  expect((await moveStage(owner, applicationId, "closed")).status()).toBe(200);
  expect((await applicationOf(owner, applicationId)).stage).toBe("closed");

  await owner.dispose();
});

test("a Ready Application can be withdrawn before its send starts", async ({
  isolatedAppServer: { url },
}) => {
  const { owner, userId } = await ownerContextFor(url);
  const companyId = await seedCompany(owner, "Ready Co", "ready.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "ready-co");

  const postingId = await seedPosting(owner, {
    atsJobId: "ready-1",
    boardId,
    companyId,
    url: "https://ready.example/1",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "ready",
    userId,
  });

  expect((await moveStage(owner, applicationId, "queued")).status()).toBe(409);
  expect((await moveStage(owner, applicationId, "applied")).status()).toBe(409);
  expect((await applicationOf(owner, applicationId)).stage).toBe("ready");

  const response = await withdraw(owner, applicationId);

  expect(response.status()).toBe(200);

  const withdrawn = await applicationOf(owner, applicationId);

  expect(withdrawn.status).toBe("withdrawn");
  expect(withdrawn.stage).toBeNull();

  await owner.dispose();
});

test("the Board stages are the schema's stages", () => {
  expect(applications.stage.enumValues).toEqual([...BOARD_STAGES]);
});
