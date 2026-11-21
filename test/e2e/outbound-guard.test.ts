import { z } from "zod";

import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import {
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const JOB_ID = "2c7db323-e4e8-4c07-8ec6-ad351b0f24eb";

const detailSchema = z.object({
  application: z.object({ status: z.string(), statusReason: z.string().nullable() }),
});

test("an unseeded Lever posting refuses the live host instead of reading the real form", async ({
  identityServer,
}) => {
  const server = await startFreshAppServer(identityServer);

  try {
    const { owner, userId } = await ownerContextFor(server.url);

    const companyId = await seedCompany(owner, "Pyka", "pyka.example");
    const boardId = await seedBoard(owner, companyId, "lever", "pyka");

    const postingId = await seedPosting(owner, {
      ats: "lever",
      atsJobId: JOB_ID,
      boardId,
      companyId,
      title: "Chief Of Staff",
      url: `https://jobs.lever.co/pyka/${JOB_ID}/apply`,
    });

    const applicationId = await seedApplication(owner, {
      postingId,
      status: "preparing",
      userId,
    });

    const refused = server.waitForStderr(/Refusing live traffic to jobs\.lever\.co/u);

    const response = await owner.post("/__test__/jobs/run-now", {
      data: {
        kind: "application.prepare",
        payload: JSON.stringify({ applicationId }),
      },
      timeout: 30_000,
    });

    expect(response.status()).toBe(500);
    expect(await refused).toContain("jobs.lever.co");

    const detail = detailSchema.parse(
      await (await owner.get(`/api/applications/${encodeURIComponent(applicationId)}`)).json(),
    );

    expect(detail.application.status).toBe("preparing");

    await owner.dispose();
  } finally {
    await server.stop();
  }
});
