import { Buffer } from "node:buffer";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { zonedTimeToEpoch } from "../../src/server/platform/local-time.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";

const createdSchema = z.object({ id: z.string() });
const seedSchema = z.object({ messageId: z.string(), threadId: z.string() });

const TIME_ZONE = "America/Toronto";
const DAY_MS = 24 * 60 * 60_000;

export const referenceNow = zonedTimeToEpoch({ day: 21, month: 11, year: 2025 }, 11, 0, TIME_ZONE);

function at(day: number, hour: number, minute: number) {
  return zonedTimeToEpoch({ day, month: 11, year: 2025 }, hour, minute, TIME_ZONE);
}

interface ThreadSeed {
  applicationId: string | null;
  at: number;
  auth: "fail" | "none" | "pass";
  classification: "ack" | "code" | "interview" | "rejection" | "screening" | "offer" | "other";
  from: string;
  readAt?: number;
  senderDomain: string;
  subject: string;
  text: string;
  withAttachment?: boolean;
}

export async function seedInboxOwner(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post(`${appServerUrl}/__test__/user/name`, {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });

  const clock = z
    .object({ now: z.number() })
    .parse(await (await request.get("/__test__/clock")).json());

  await request.post("/__test__/clock/offset", { data: { offsetMs: referenceNow - clock.now } });
  await request.put("/api/profile/settings", {
    data: { languages: ["en"], timezone: TIME_ZONE },
  });

  const state = await verifyAuthState(appServerUrl, request);
  const owner = state.users.find((user) => user.email === authTestIdentity.ownerEmail);

  if (owner === undefined) {
    throw new Error("the owner was not created");
  }

  return owner.id;
}

async function seedApplication(
  request: APIRequestContext,
  userId: string,
  company: string,
  title: string,
  index: number,
) {
  const companyId = createdSchema.parse(
    await (
      await request.post("/__test__/catalog/companies", {
        data: {
          domain: `${company.toLowerCase().replaceAll(/[^a-z]+/gu, "-")}.example`,
          name: company,
        },
      })
    ).json(),
  ).id;

  const boardId = createdSchema.parse(
    await (
      await request.post("/__test__/catalog/boards", {
        data: { ats: "greenhouse", boardToken: `inbox-${String(index)}`, companyId },
      })
    ).json(),
  ).id;

  const postingId = createdSchema.parse(
    await (
      await request.post("/__test__/catalog/postings", {
        data: {
          ats: "greenhouse",
          atsJobId: `inbox-${String(index)}`,
          boardId,
          city: "Toronto",
          companyId,
          countryCode: "CA",
          employmentType: "full_time",
          language: "en",
          locationRaw: "Toronto, ON",
          tags: [
            { dimension: "seniority", value: "senior" },
            { dimension: "subrole", value: "Backend" },
          ],
          title,
          url: `https://${company.toLowerCase().replaceAll(/[^a-z]+/gu, "-")}.example/${String(index)}`,
          workplace: "remote",
        },
      })
    ).json(),
  ).id;

  return createdSchema.parse(
    await (
      await request.post("/__test__/applications/seed", {
        data: {
          createdAt: referenceNow - 9 * DAY_MS,
          origin: "auto",
          postingId,
          sentAt: referenceNow - 9 * DAY_MS,
          stage: "applied",
          status: "sent",
          userId,
        },
      })
    ).json(),
  ).id;
}

async function seedThread(request: APIRequestContext, userId: string, seed: ThreadSeed) {
  return seedSchema.parse(
    await (
      await request.post("/__test__/mail/seed", {
        data: {
          applicationId: seed.applicationId,
          attachments: seed.withAttachment
            ? [
                {
                  base64: Buffer.alloc(217_088).toString("base64"),
                  filename: "Platform_Interview_Brief.pdf",
                  mime: "application/pdf",
                },
              ]
            : [],
          at: seed.at,
          auth: seed.auth,
          classification: seed.classification,
          from: seed.from,
          localPart: "in-3f9c2a1d-7b4e",
          readAt: seed.readAt ?? null,
          senderDomain: seed.senderDomain,
          subject: seed.subject,
          text: seed.text,
          userId,
        },
      })
    ).json(),
  );
}

export async function seedInboxThreads(request: APIRequestContext, userId: string) {
  const halden = await seedApplication(
    request,
    userId,
    "Halden Systems",
    "Senior Backend Engineer",
    1,
  );

  const quillon = await seedApplication(
    request,
    userId,
    "Quillon Payments",
    "Senior Payments Engineer",
    2,
  );

  const brightwave = await seedApplication(
    request,
    userId,
    "Brightwave Analytics",
    "Staff Data Engineer",
    3,
  );

  const fenwick = await seedApplication(request, userId, "Fenwick & Marsh", "Platform Engineer", 4);

  await seedThread(request, userId, {
    applicationId: halden,
    at: at(21, 10, 10),
    auth: "pass",
    classification: "interview",
    from: "Halden Systems <no-reply@us.greenhouse-mail.io>",
    senderDomain: "us.greenhouse-mail.io",
    subject: "Re: next steps for your application",
    text: "Could you share two times next week for a 30-minute call?",
  });

  await seedThread(request, userId, {
    applicationId: quillon,
    at: at(20, 9, 2),
    auth: "pass",
    classification: "code",
    from: "Quillon Payments <no-reply@us.greenhouse-mail.io>",
    senderDomain: "us.greenhouse-mail.io",
    subject: "Security code for your application",
    text: "Code used. Overture entered it and submitted the form.",
  });

  await seedThread(request, userId, {
    applicationId: brightwave,
    at: at(19, 15, 30),
    auth: "pass",
    classification: "ack",
    from: "Brightwave Analytics <no-reply@us.greenhouse-mail.io>",
    readAt: at(19, 16, 0),
    senderDomain: "us.greenhouse-mail.io",
    subject: "We received your application",
    text: "Thanks for applying. Our team reviews every application in order.",
  });

  const fenwickThread = await seedThread(request, userId, {
    applicationId: fenwick,
    at: at(18, 7, 45),
    auth: "fail",
    classification: "interview",
    from: "Fenwick & Marsh recruiting <recruiting@fenwick.example>",
    senderDomain: "fenwick.example",
    subject: "Interview invitation: Platform Engineer",
    text:
      "Hi Maya,\n\n" +
      "Thanks for applying for Platform Engineer. We would like to invite you to a 45-minute technical interview. The brief and the times we can offer are attached.\n\n" +
      "Best,\nOwen, Talent team",
    withAttachment: true,
  });

  return { fenwickThreadId: fenwickThread.threadId };
}
