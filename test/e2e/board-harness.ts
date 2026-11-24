import { z } from "zod";

import type { APIRequestContext, Page } from "@playwright/test";

import { zonedTimeToEpoch } from "../../src/server/platform/local-time.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { seedUnreadNotifications } from "./notification-seed.ts";
import { latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";

const createdSchema = z.object({ id: z.string() });

const DAY_MS = 24 * 60 * 60_000;
const TIME_ZONE = "America/Toronto";

const referenceNow = zonedTimeToEpoch({ day: 17, month: 11, year: 2026 }, 12, 0, TIME_ZONE);

interface CardSeed {
  company: string;
  title: string;
  location: string;
  ageDays: number;
  score: number;
  stage: "queued" | "ready" | "applied" | "screening" | "interviewing" | "offer" | "closed";
  status: "needs_review" | "confirming" | "ready" | "approved" | "sent";
  note?: string;
  closedReason?: "rejected" | "no_response" | "withdrawn" | "offer_declined";
  salary?: { min: number; max: number };
  createdAt?: number;
}

const queuedVisible: CardSeed[] = [
  {
    ageDays: 1,
    company: "Ferro Cloud",
    location: "Montréal, QC",
    score: 77,
    stage: "queued",
    status: "needs_review",
    title: "DevOps Engineer",
  },
  {
    ageDays: 2,
    company: "Larkspur Health",
    location: "Vancouver, BC",
    score: 83,
    stage: "queued",
    status: "needs_review",
    title: "Platform Engineer",
  },
  {
    ageDays: 3,
    company: "Northwind Labs",
    location: "Remote, Canada",
    score: 79,
    stage: "queued",
    status: "needs_review",
    title: "Site Reliability Engineer",
  },
  {
    ageDays: 1,
    company: "Tideline Software",
    location: "Calgary, AB",
    score: 82,
    stage: "queued",
    status: "confirming",
    title: "Platform Engineer",
  },
  {
    ageDays: 1,
    company: "Ostrander Freight",
    location: "Vancouver, BC",
    score: 78,
    stage: "queued",
    status: "ready",
    title: "Senior Backend Engineer",
  },
];

const appliedVisible: CardSeed[] = [
  {
    ageDays: 1,
    company: "Northwind Labs",
    location: "Toronto, ON",
    score: 86,
    stage: "applied",
    status: "sent",
    title: "Platform Engineer",
  },
  {
    ageDays: 2,
    company: "Ferro Cloud",
    location: "Remote, US",
    score: 74,
    stage: "applied",
    status: "sent",
    title: "Backend Engineer",
  },
  {
    ageDays: 3,
    company: "Larkspur Health",
    location: "Seattle, WA",
    score: 81,
    stage: "applied",
    status: "sent",
    title: "Senior Backend Engineer",
  },
  {
    ageDays: 4,
    company: "Halden Systems",
    location: "Calgary, AB",
    score: 72,
    stage: "applied",
    status: "sent",
    title: "DevOps Engineer",
  },
];

const rest: CardSeed[] = [
  {
    ageDays: 6,
    company: "Halden Systems",
    createdAt: zonedTimeToEpoch({ day: 11, month: 11, year: 2026 }, 8, 2, TIME_ZONE),
    location: "Toronto, ON",
    note: "Reply received",
    salary: { max: 17_500_000, min: 15_000_000 },
    score: 88,
    stage: "screening",
    status: "sent",
    title: "Senior Backend Engineer",
  },
  {
    ageDays: 9,
    company: "Larkspur Health",
    location: "Austin, TX",
    note: "Call invited",
    score: 80,
    stage: "screening",
    status: "sent",
    title: "Infrastructure Engineer",
  },
  {
    ageDays: 12,
    company: "Northwind Labs",
    location: "Toronto, ON",
    note: "Thu 2 pm",
    score: 91,
    stage: "interviewing",
    status: "sent",
    title: "Staff Platform Engineer",
  },
  {
    ageDays: 15,
    company: "Ferro Cloud",
    location: "Remote, US",
    note: "Round two",
    score: 85,
    stage: "interviewing",
    status: "sent",
    title: "Senior Backend Engineer",
  },
  {
    ageDays: 21,
    company: "Halden Systems",
    location: "Ottawa, ON",
    note: "Offer received",
    score: 89,
    stage: "offer",
    status: "sent",
    title: "Platform Engineer",
  },
  {
    ageDays: 10,
    closedReason: "rejected",
    company: "Ferro Cloud",
    location: "Austin, TX",
    score: 58,
    stage: "closed",
    status: "sent",
    title: "DevOps Engineer",
  },
  {
    ageDays: 18,
    closedReason: "withdrawn",
    company: "Larkspur Health",
    location: "Denver, CO",
    score: 66,
    stage: "closed",
    status: "sent",
    title: "Backend Engineer",
  },
  {
    ageDays: 27,
    closedReason: "offer_declined",
    company: "Northwind Labs",
    location: "Remote, Canada",
    score: 76,
    stage: "closed",
    status: "sent",
    title: "DevOps Engineer",
  },
  {
    ageDays: 34,
    closedReason: "no_response",
    company: "Tideline Software",
    location: "Calgary, AB",
    score: 71,
    stage: "closed",
    status: "sent",
    title: "Site Reliability Engineer",
  },
  {
    ageDays: 41,
    closedReason: "no_response",
    company: "Ostrander Freight",
    location: "Vancouver, BC",
    score: 69,
    stage: "closed",
    status: "sent",
    title: "Backend Engineer",
  },
];

const filler: CardSeed[] = [
  ...Array.from(
    { length: 2 },
    () =>
      ({
        ageDays: 2,
        company: "Tideline Software",
        location: "Calgary, AB",
        score: 75,
        stage: "queued",
        status: "ready",
        title: "Backend Engineer",
      }) satisfies CardSeed,
  ),
  ...Array.from(
    { length: 8 },
    () =>
      ({
        ageDays: 5,
        company: "Brightwave Analytics",
        location: "Toronto, ON",
        score: 70,
        stage: "applied",
        status: "sent",
        title: "Infrastructure Engineer",
      }) satisfies CardSeed,
  ),
];

const readyVisible: CardSeed[] = [
  {
    ageDays: 1,
    company: "Northwind Labs",
    location: "Remote, London",
    score: 86,
    stage: "ready",
    status: "ready",
    title: "Platform Engineer",
  },
  {
    ageDays: 2,
    company: "Halden Systems",
    location: "Manchester, hybrid",
    score: 81,
    stage: "ready",
    status: "ready",
    title: "Site Reliability Engineer",
  },
  {
    ageDays: 3,
    company: "Larkspur Health",
    location: "Remote, UK",
    score: 78,
    stage: "ready",
    status: "approved",
    title: "Senior Backend Engineer",
  },
];

const cards = [...queuedVisible, ...appliedVisible, ...rest, ...filler, ...readyVisible];

export async function seedBoardOwner(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post(`${appServerUrl}/__test__/user/name`, {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });
  await setReferenceClock(request);
  await request.post(`${appServerUrl}/__test__/ledger/sample`, {
    data: { email: authTestIdentity.ownerEmail },
  });
  await seedUnreadNotifications(request, appServerUrl);
  const homeProbe = await request.get("/api/home");

  if (!homeProbe.ok()) {
    throw new Error(`home probe failed: ${String(homeProbe.status())} ${await homeProbe.text()}`);
  }

  await request.post("/api/running", { data: { running: true } });
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

async function setReferenceClock(request: APIRequestContext) {
  const clock = z
    .object({ now: z.number() })
    .parse(await (await request.get("/__test__/clock")).json());

  await request.post("/__test__/clock/offset", {
    data: { offsetMs: referenceNow - clock.now },
  });
}

async function seedCompany(request: APIRequestContext, name: string, index: number) {
  const slug = name.toLowerCase().replaceAll(/[^a-z]+/gu, "-");

  return createdSchema.parse(
    await (
      await request.post("/__test__/catalog/companies", {
        data: { domain: `${slug}-${String(index)}.example`, name },
      })
    ).json(),
  ).id;
}

async function seedCard(request: APIRequestContext, userId: string, card: CardSeed, index: number) {
  const companyId = await seedCompany(request, card.company, index);

  const boardId = createdSchema.parse(
    await (
      await request.post("/__test__/catalog/boards", {
        data: { ats: "greenhouse", boardToken: `board-${String(index)}`, companyId },
      })
    ).json(),
  ).id;

  const postingId = createdSchema.parse(
    await (
      await request.post("/__test__/catalog/postings", {
        data: {
          ats: "greenhouse",
          atsJobId: `board-${String(index)}`,
          boardId,
          city: card.location.split(",")[0],
          companyId,
          countryCode: "CA",
          employmentType: "full_time",
          language: "en",
          locationRaw: card.location,
          salaryCurrency: card.salary === undefined ? null : "CAD",
          salaryMaxMinor: card.salary?.max ?? null,
          salaryMinMinor: card.salary?.min ?? null,
          salaryPeriod: card.salary === undefined ? null : "year",
          tags: [
            { dimension: "seniority", value: "senior" },
            { dimension: "subrole", value: "Platform" },
          ],
          title: card.title,
          url: `https://${card.company.toLowerCase().replaceAll(/[^a-z]+/gu, "-")}.example/${String(index)}`,
          workplace: "hybrid",
        },
      })
    ).json(),
  ).id;

  const createdAt = card.createdAt ?? referenceNow - card.ageDays * DAY_MS - 2 * 60 * 60_000;

  let scheduledFor: number | null = null;

  if (card.stage === "ready" && card.status === "approved") {
    scheduledFor = zonedTimeToEpoch({ day: 17, month: 11, year: 2026 }, 14, 20, TIME_ZONE);
  } else if (card.stage === "queued" && card.status === "ready") {
    scheduledFor = zonedTimeToEpoch({ day: 17, month: 11, year: 2026 }, 13, 10, TIME_ZONE);
  }

  const applicationId = createdSchema.parse(
    await (
      await request.post("/__test__/applications/seed", {
        data: {
          boardPosition: index,
          closedReason: card.closedReason ?? null,
          createdAt,
          origin: "auto",
          postingId,
          scheduledFor,
          sentAt: card.stage === "queued" || card.stage === "ready" ? null : createdAt,
          stage: card.stage,
          status: card.status,
          userId,
        },
      })
    ).json(),
  ).id;

  await request.post("/__test__/matches/seed", {
    data: {
      codeRank: index,
      postingId,
      reason:
        card.score >= 80
          ? "Strong match against your resume. Over the usual bar for sending."
          : "Senior platform work in the same stack.",
      score: card.score,
      userId,
    },
  });

  return { applicationId, createdAt };
}

export async function seedBoard(request: APIRequestContext, userId: string) {
  const seeded = await Promise.all(
    cards.map(async (card, index) => seedCard(request, userId, card, index + 1)),
  );

  const reviewIds = seeded.slice(0, 3).map((entry) => entry.applicationId);

  await request.post("/__test__/reviews/seed", {
    data: {
      applicationIds: reviewIds,
      fieldType: "text",
      options: [],
      prompt: "Are you comfortable with a weekly on-call rotation?",
      userId,
    },
  });

  const selected = seeded.at(9);

  if (selected === undefined) {
    throw new Error("the selected card was not seeded");
  }

  await request.post("/__test__/applications/events/seed", {
    data: {
      applicationId: selected.applicationId,
      events: [
        {
          at: zonedTimeToEpoch({ day: 11, month: 11, year: 2026 }, 8, 20, TIME_ZONE),
          detail: "Eleven answers from your profile. Cover letter written for this role.",
          fromValue: null,
          kind: "status",
          source: "system",
          toValue: "preparing",
        },
        {
          at: zonedTimeToEpoch({ day: 11, month: 11, year: 2026 }, 8, 21, TIME_ZONE),
          detail: "Passed. Nothing waiting on a Review, resume attached unchanged.",
          fromValue: "preparing",
          kind: "status",
          source: "system",
          toValue: "ready",
        },
        {
          at: zonedTimeToEpoch({ day: 11, month: 11, year: 2026 }, 8, 24, TIME_ZONE),
          detail: "Sent to Halden Systems with Maya_Okafor_Resume.pdf and the cover letter.",
          fromValue: "ready",
          kind: "status",
          source: "system",
          toValue: "sending",
        },
        {
          at: zonedTimeToEpoch({ day: 11, month: 11, year: 2026 }, 8, 27, TIME_ZONE),
          detail: "Halden Systems confirmed it received your application.",
          fromValue: "sending",
          kind: "status",
          source: "system",
          toValue: "sent",
        },
        {
          at: zonedTimeToEpoch({ day: 16, month: 11, year: 2026 }, 15, 10, TIME_ZONE),
          detail: "A recruiter asked for your availability. Moved to Screening.",
          fromValue: null,
          kind: "email",
          source: "email",
          toValue: "Reply received",
        },
      ],
    },
  });

  await Promise.all(
    (
      [
        [1, "Call invited"],
        [2, "Thu 2 pm"],
        [3, "Round two"],
        [4, "Offer received"],
      ] as const
    ).map(async ([offset, note]) => {
      const entry = seeded.at(9 + offset);

      if (entry === undefined) {
        return;
      }

      await request.post("/__test__/applications/events/seed", {
        data: {
          applicationId: entry.applicationId,
          events: [
            {
              at: referenceNow - 3 * 60 * 60_000,
              detail: note,
              fromValue: null,
              kind: "email",
              source: "email",
              toValue: note,
            },
          ],
        },
      });
    }),
  );

  return { selectedId: selected.applicationId };
}

export async function openBoard(
  page: Page,
  appServerUrl: string,
  width: number,
  selectedId: string,
) {
  await page.goto(`${appServerUrl}/applications`);

  if (width === 390) {
    await page.getByRole("button", { name: /Waiting/u }).click();
    await page.getByRole("group", { name: "Stages" }).evaluate((element) => {
      element.scrollLeft = 0;
    });
  }

  if (width === 390) {
    await page
      .locator('section[aria-label="Waiting"]')
      .getByRole("button", { name: /Senior Backend Engineer/u })
      .first()
      .click();

    return;
  }

  await page.locator(`button[data-card="${selectedId}"]`).first().click();
}
