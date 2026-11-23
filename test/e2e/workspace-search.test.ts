import { request as apiRequest } from "@playwright/test";
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

const createdSchema = z.object({ id: z.string() });
const reviewSeedSchema = z.object({ questionId: z.string(), reviewId: z.string() });
const mailSchema = z.object({ messageId: z.string(), threadId: z.string() });

const workspaceSearchResponse = z.object({
  applications: z.array(
    z.object({
      company: z.string(),
      id: z.string(),
      location: z.string().nullable(),
      score: z.number().nullable(),
      stage: z.string().nullable(),
      status: z.string(),
      title: z.string(),
    }),
  ),
  emails: z.array(
    z.object({
      company: z.string().nullable(),
      id: z.string(),
      receivedAt: z.number(),
      snippet: z.string(),
      subject: z.string(),
      threadId: z.string(),
    }),
  ),
  interviews: z.array(
    z.object({
      applicationId: z.string(),
      company: z.string(),
      endsAt: z.number().nullable(),
      id: z.string(),
      location: z.string().nullable(),
      startsAt: z.number(),
      summary: z.string(),
      title: z.string(),
    }),
  ),
  query: z.string(),
  reviews: z.array(
    z.object({
      category: z.string(),
      id: z.string(),
      prompt: z.string(),
      unlockedCount: z.number(),
    }),
  ),
});

const START = Date.UTC(2026, 10, 22, 15, 0, 0);
const HOUR = 60 * 60_000;

async function searchOf(request: APIRequestContext, query: string, limit?: number) {
  const suffix = limit === undefined ? "" : `&limit=${String(limit)}`;

  const response = await request.get(
    `/api/workspace/search?q=${encodeURIComponent(query)}${suffix}`,
  );

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");

  return workspaceSearchResponse.parse(await response.json());
}

async function createOtherUser(owner: APIRequestContext, email: string) {
  return createdSchema.parse(
    await (await owner.post("/__test__/users", { data: { email, name: "Other Person" } })).json(),
  ).id;
}

async function seedMail(
  owner: APIRequestContext,
  input: { applicationId: string; from: string; subject: string; text: string; userId: string },
) {
  return mailSchema.parse(
    await (
      await owner.post("/__test__/mail/seed", {
        data: {
          applicationId: input.applicationId,
          auth: "pass",
          classification: "screening",
          direction: "in",
          from: input.from,
          senderDomain: "acme.example",
          subject: input.subject,
          text: input.text,
          userId: input.userId,
        },
      })
    ).json(),
  );
}

async function seedReview(
  owner: APIRequestContext,
  input: { applicationId: string; prompt: string; userId: string },
) {
  return reviewSeedSchema.parse(
    await (
      await owner.post("/__test__/reviews/seed", {
        data: {
          applicationIds: [input.applicationId],
          fieldType: "text",
          factKey: "salary_expectation",
          prompt: input.prompt,
          userId: input.userId,
        },
      })
    ).json(),
  );
}

async function seedInterview(
  owner: APIRequestContext,
  input: { applicationId: string; messageId: string; uid: string; userId: string },
) {
  return createdSchema.parse(
    await (
      await owner.post("/__test__/interviews/seed", {
        data: {
          applicationId: input.applicationId,
          endsAt: START + HOUR,
          messageId: input.messageId,
          startsAt: START,
          uid: input.uid,
          userId: input.userId,
        },
      })
    ).json(),
  );
}

test("an unauthenticated or empty search answers safely", async ({ isolatedAppServer }) => {
  const anonymous = await apiRequest.newContext({ baseURL: isolatedAppServer.url });

  const refused = await anonymous.get("/api/workspace/search?q=test");

  expect(refused.status()).toBe(401);
  expect(await refused.json()).toEqual({ error: "sign_in_required" });

  const missingQuery = await anonymous.get("/api/workspace/search");

  expect(missingQuery.status()).toBe(401);

  await anonymous.dispose();

  const { owner } = await ownerContextFor(isolatedAppServer.url);

  const blank = await searchOf(owner, "   ");

  expect(blank).toEqual({
    applications: [],
    emails: [],
    interviews: [],
    query: "",
    reviews: [],
  });

  const absent = await searchOf(owner, "");

  expect(absent).toEqual({
    applications: [],
    emails: [],
    interviews: [],
    query: "",
    reviews: [],
  });

  const tooLong = await owner.get(`/api/workspace/search?q=${"a".repeat(121)}`);

  expect(tooLong.status()).toBe(400);

  const badLimit = await owner.get("/api/workspace/search?q=test&limit=0");

  expect(badLimit.status()).toBe(400);

  const hugeLimit = await owner.get("/api/workspace/search?q=test&limit=21");

  expect(hugeLimit.status()).toBe(400);

  await owner.dispose();
});

test("a signed-in user finds their own Applications, Reviews, mail and interviews", async ({
  isolatedAppServer,
}) => {
  const { owner, userId } = await ownerContextFor(isolatedAppServer.url);

  const companyId = await seedCompany(owner, "Acme", "acme.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "workspace-search");

  const postingId = await seedPosting(owner, {
    atsJobId: "workspace-search",
    boardId,
    companyId,
    title: "Senior Backend Engineer",
    url: "https://acme.example/workspace-search",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    sentAt: START,
    status: "sent",
    userId,
  });

  const mail = await seedMail(owner, {
    applicationId,
    from: "Acme Recruiting <jobs@acme.example>",
    subject: "Your interview with Acme",
    text: "We would like to book a 45-minute technical architecture interview with you.",
    userId,
  });

  const { reviewId } = await seedReview(owner, {
    applicationId,
    prompt: "What are your salary expectations for this role?",
    userId,
  });

  const { id: interviewId } = await seedInterview(owner, {
    applicationId,
    messageId: mail.messageId,
    uid: `${crypto.randomUUID()}@acme.example`,
    userId,
  });

  const byCompany = await searchOf(owner, "ACME");

  expect(byCompany.query).toBe("ACME");
  expect(byCompany.applications).toEqual([
    {
      company: "Acme",
      id: applicationId,
      location: "Remote, Canada",
      score: null,
      stage: "applied",
      status: "sent",
      title: "Senior Backend Engineer",
    },
  ]);
  expect(byCompany.emails).toEqual([
    {
      company: "Acme",
      id: mail.messageId,
      receivedAt: expect.any(Number),
      snippet: "We would like to book a 45-minute technical architecture interview with you.",
      subject: "Your interview with Acme",
      threadId: mail.threadId,
    },
  ]);
  expect(byCompany.interviews).toEqual([
    {
      applicationId,
      company: "Acme",
      endsAt: START + HOUR,
      id: interviewId,
      location: "Remote, Canada",
      startsAt: START,
      summary: "Acme — Senior Backend Engineer",
      title: "Senior Backend Engineer",
    },
  ]);

  const byTitle = await searchOf(owner, "senior backend");

  expect(byTitle.applications.map((row) => row.id)).toEqual([applicationId]);
  expect(byTitle.interviews.map((row) => row.id)).toEqual([interviewId]);

  const byCategory = await searchOf(owner, "availability");

  expect(byCategory.reviews).toEqual([
    {
      category: "availability",
      id: reviewId,
      prompt: "What are your salary expectations for this role?",
      unlockedCount: 1,
    },
  ]);

  const byStatus = await searchOf(owner, "sent");

  expect(byStatus.applications.map((row) => row.id)).toEqual([applicationId]);

  const limited = await searchOf(owner, "acme", 1);

  expect(limited.applications).toHaveLength(1);
  expect(limited.emails).toHaveLength(1);
  expect(limited.interviews).toHaveLength(1);
  expect(limited.reviews).toHaveLength(0);

  await owner.dispose();
});

test("another user's rows never enter a search result", async ({ isolatedAppServer }) => {
  const { owner, userId } = await ownerContextFor(isolatedAppServer.url);
  const otherUserId = await createOtherUser(owner, "other.workspace@example.com");

  const companyId = await seedCompany(owner, "Acme", "acme.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "workspace-search-scope");

  const postingId = await seedPosting(owner, {
    atsJobId: "workspace-search-scope",
    boardId,
    companyId,
    title: "Senior Backend Engineer",
    url: "https://acme.example/workspace-search-scope",
  });

  const mineApplication = await seedApplication(owner, {
    postingId,
    sentAt: START,
    status: "sent",
    userId,
  });

  const theirApplication = await seedApplication(owner, {
    postingId,
    sentAt: START,
    status: "sent",
    userId: otherUserId,
  });

  const mineMail = await seedMail(owner, {
    applicationId: mineApplication,
    from: "Acme Recruiting <jobs@acme.example>",
    subject: "Your interview with Acme",
    text: "A technical interview with Acme is booked.",
    userId,
  });

  const theirMail = await seedMail(owner, {
    applicationId: theirApplication,
    from: "Globex Talent <talent@globex.example>",
    subject: "Globex screening call",
    text: "Globex would like to book a screening call.",
    userId: otherUserId,
  });

  await seedReview(owner, {
    applicationId: mineApplication,
    prompt: "What are your salary expectations for this role?",
    userId,
  });

  const { reviewId: theirReview } = await seedReview(owner, {
    applicationId: theirApplication,
    prompt: "Do you hold a Globex security clearance?",
    userId: otherUserId,
  });

  const { id: mineInterview } = await seedInterview(owner, {
    applicationId: mineApplication,
    messageId: mineMail.messageId,
    uid: `${crypto.randomUUID()}@acme.example`,
    userId,
  });

  const { id: theirInterview } = await seedInterview(owner, {
    applicationId: theirApplication,
    messageId: theirMail.messageId,
    uid: `${crypto.randomUUID()}@globex.example`,
    userId: otherUserId,
  });

  const mine = await searchOf(owner, "acme");

  expect(mine.applications.map((row) => row.id)).toEqual([mineApplication]);
  expect(mine.emails.map((row) => row.id)).toEqual([mineMail.messageId]);
  expect(mine.interviews.map((row) => row.id)).toEqual([mineInterview]);
  expect(mine.reviews).toHaveLength(0);

  const theirApplicationRows = mine.applications.filter((row) => row.id === theirApplication);
  const theirMailRows = mine.emails.filter((row) => row.id === theirMail.messageId);
  const theirReviewRows = mine.reviews.filter((row) => row.id === theirReview);
  const theirInterviewRows = mine.interviews.filter((row) => row.id === theirInterview);

  expect(theirApplicationRows).toHaveLength(0);
  expect(theirMailRows).toHaveLength(0);
  expect(theirReviewRows).toHaveLength(0);
  expect(theirInterviewRows).toHaveLength(0);

  const foreign = await searchOf(owner, "globex");

  expect(foreign.applications).toHaveLength(0);
  expect(foreign.emails).toHaveLength(0);
  expect(foreign.interviews).toHaveLength(0);
  expect(foreign.reviews).toHaveLength(0);

  await owner.dispose();
});
