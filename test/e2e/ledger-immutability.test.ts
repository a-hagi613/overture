import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

import { z } from "zod";

const sampleResponseSchema = z.object({ applicationsLeft: z.number() });

const tamperResponseSchema = z.object({
  refused: z.boolean(),
  refusal: z.string().nullable(),
});

const rowsResponseSchema = z.object({ rows: z.number() });

test("a direct ledger row change is refused by the database", async ({
  isolatedAppServer,
  request,
}) => {
  const url = isolatedAppServer.url;

  await requestMagicLink(url, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(url, request, authTestIdentity.ownerEmail);

  await request.get(link);

  const sampleResponse = await request.post(`${url}/__test__/ledger/sample`, {
    data: { email: authTestIdentity.ownerEmail },
  });
  const sample = sampleResponseSchema.parse(await sampleResponse.json());

  expect(sample.applicationsLeft).toBe(63);

  const rowsBefore = rowsResponseSchema.parse(
    await (await request.get(`${url}/__test__/ledger/rows`)).json(),
  );

  expect(rowsBefore.rows).toBe(15);

  const update = tamperResponseSchema.parse(
    await (
      await request.post(`${url}/__test__/ledger/tamper`, { data: { action: "update" } })
    ).json(),
  );

  expect(update.refused).toBe(true);
  expect(update.refusal).toContain("append-only");

  const deletion = tamperResponseSchema.parse(
    await (
      await request.post(`${url}/__test__/ledger/tamper`, { data: { action: "delete" } })
    ).json(),
  );

  expect(deletion.refused).toBe(true);
  expect(deletion.refusal).toContain("only when their user");

  const rowsAfter = rowsResponseSchema.parse(
    await (await request.get(`${url}/__test__/ledger/rows`)).json(),
  );

  expect(rowsAfter.rows).toBe(15);

  const resample = sampleResponseSchema.parse(
    await (
      await request.post(`${url}/__test__/ledger/sample`, {
        data: { email: authTestIdentity.ownerEmail },
      })
    ).json(),
  );

  expect(resample.applicationsLeft).toBe(63);
});

test("ledger rows go only when their user goes", async ({ isolatedAppServer, request }) => {
  const url = isolatedAppServer.url;

  await requestMagicLink(url, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(url, request, authTestIdentity.ownerEmail);

  await request.get(link);

  await request.post(`${url}/__test__/ledger/sample`, {
    data: { email: authTestIdentity.ownerEmail },
  });

  const ownerGone = tamperResponseSchema.parse(
    await (
      await request.post(`${url}/__test__/ledger/tamper`, { data: { action: "delete-owner" } })
    ).json(),
  );

  expect(ownerGone.refused).toBe(false);

  const rowsAfter = rowsResponseSchema.parse(
    await (await request.get(`${url}/__test__/ledger/rows`)).json(),
  );

  expect(rowsAfter.rows).toBe(0);
});
