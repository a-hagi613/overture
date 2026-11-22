import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { openCountingDatabase } from "../testing/query-counter.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import { applications, companies, companyBoards, postings, users } from "../platform/db/schema.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { openApprovedPlans, sealApprovedPlan } from "./approved-plan.ts";

import type { SendPlan } from "./send-plan.ts";

const NOW = 1_795_000_000_000;
const USER = "approved-plan-user";

function planFor(index: number) {
  return {
    applicationId: `app-${String(index)}`,
    ats: "greenhouse",
    atsJobId: `job-${String(index)}`,
    boardToken: "board-1",
    companyName: "Northwind",
    consentVersion: "1",
    coverLetter: null,
    descriptionHash: null,
    fields: [],
    postingTitle: `Platform Engineer ${String(index)}`,
    postingUrl: `https://example.test/job-${String(index)}`,
    resume: null,
    userId: USER,
  } satisfies SendPlan;
}

function seeded() {
  const { counter, db } = openCountingDatabase();

  const at = new Date(NOW);

  db.insert(users)
    .values({
      id: USER,
      name: "Approved Owner",
      email: "approved@example.com",
      emailVerified: true,
      role: "owner",
      createdAt: at,
      updatedAt: at,
    })
    .run();

  db.insert(companies)
    .values({ id: "co-1", name: "Northwind", nameNorm: "northwind", createdAt: NOW })
    .run();

  db.insert(companyBoards)
    .values({
      id: "board-1",
      companyId: "co-1",
      ats: "greenhouse",
      boardToken: "board-1",
      region: "us",
      source: "v1_seed",
      lastPolledAt: NOW,
      createdAt: NOW,
    })
    .run();

  return { counter, db, personal: createPersonalCrypto(db, new Uint8Array(32).fill(6), 1) };
}

async function addApproved(
  db: AppDatabase,
  personal: ReturnType<typeof createPersonalCrypto>,
  index: number,
) {
  db.insert(postings)
    .values({
      id: `posting-${String(index)}`,
      boardId: "board-1",
      companyId: "co-1",
      ats: "greenhouse",
      atsJobId: `job-${String(index)}`,
      url: `https://example.test/job-${String(index)}`,
      applyUrlNorm: `https://example.test/job-${String(index)}`,
      title: `Platform Engineer ${String(index)}`,
      titleNorm: `platform engineer ${String(index)}`,
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      dedupeKey: `job-${String(index)}`,
    })
    .run();

  const sealed = await sealApprovedPlan({
    applicationId: `app-${String(index)}`,
    personal,
    plan: planFor(index),
  });

  db.insert(applications)
    .values({
      id: `app-${String(index)}`,
      userId: USER,
      postingId: `posting-${String(index)}`,
      companyId: "co-1",
      origin: "auto",
      status: "approved",
      stage: "ready",
      approvedAt: NOW - index,
      approvedPlanEnc: sealed.enc,
      approvedPlanSha256: sealed.sha256,
      scheduledFor: NOW + 3_600_000 + index,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

describe("opening approved plans", () => {
  test("reads every plan of a list in one statement, not one per card", async () => {
    const { counter, db, personal } = seeded();

    await Promise.all(
      Array.from({ length: 3 }, async (_unused, index) => addApproved(db, personal, index)),
    );

    await openApprovedPlans({
      applicationIds: ["app-0", "app-1", "app-2"],
      db,
      personal,
      userId: USER,
    });
    counter.reset();

    const three = await openApprovedPlans({
      applicationIds: ["app-0", "app-1", "app-2"],
      db,
      personal,
      userId: USER,
    });

    const statementsForThree = counter.count();

    await Promise.all(
      Array.from({ length: 3 }, async (_unused, offset) => addApproved(db, personal, offset + 3)),
    );

    counter.reset();

    const six = await openApprovedPlans({
      applicationIds: ["app-0", "app-1", "app-2", "app-3", "app-4", "app-5"],
      db,
      personal,
      userId: USER,
    });

    expect(three.size).toBe(3);
    expect(six.size).toBe(6);
    expect(counter.count()).toBe(statementsForThree);
    expect(statementsForThree).toBe(1);
  });

  test("returns each card's own plan and leaves a corrupt one out", async () => {
    const { db, personal } = seeded();

    await Promise.all(
      Array.from({ length: 3 }, async (_unused, index) => addApproved(db, personal, index)),
    );

    db.update(applications)
      .set({ approvedPlanSha256: "0".repeat(64) })
      .where(eq(applications.id, "app-1"))
      .run();

    const opened = await openApprovedPlans({
      applicationIds: ["app-0", "app-1", "app-2"],
      db,
      personal,
      userId: USER,
    });

    expect([...opened.keys()].toSorted()).toEqual(["app-0", "app-2"]);
    expect(opened.get("app-0")?.plan.postingTitle).toBe("Platform Engineer 0");
    expect(opened.get("app-2")?.plan.postingTitle).toBe("Platform Engineer 2");
  });

  test("reads nothing when the list is empty", async () => {
    const { counter, db, personal } = seeded();

    counter.reset();

    expect((await openApprovedPlans({ applicationIds: [], db, personal, userId: USER })).size).toBe(
      0,
    );
    expect(counter.count()).toBe(0);
  });
});
