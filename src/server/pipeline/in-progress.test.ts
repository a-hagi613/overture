import { beforeEach, describe, expect, test } from "bun:test";

import type { AppDatabase } from "../platform/db/client.ts";

import { migrateDatabase } from "../platform/db/migrate.ts";
import { openDatabase } from "../platform/db/client.ts";
import { applications, users } from "../platform/db/schema.ts";

import { inProgressOf } from "./in-progress.ts";

const NOW = 1_800_000_000_000;

let db: AppDatabase;

beforeEach(() => {
  const { db: openedDb } = openDatabase(":memory:");

  db = openedDb;
  migrateDatabase(db, "drizzle");

  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "owner@example.test",
      emailVerified: true,
      id: "user-1",
      name: "Owner",
      role: "owner",
      updatedAt: new Date(NOW),
    })
    .run();
});

function addApplication(input: {
  id: string;
  status: "approved" | "confirming" | "preparing" | "sending";
  scheduledFor?: number | null;
  title: string;
  updatedAt?: number;
}) {
  db.insert(applications)
    .values({
      ats: "greenhouse",
      companyId: "company-1",
      companyName: "Northwind Labs",
      companyNameNorm: "northwind labs",
      createdAt: NOW,
      id: input.id,
      origin: "pick",
      postingId: `posting-${input.id}`,
      postingTitle: input.title,
      postingUrl: `https://northwind.example/${input.id}`,
      scheduledFor: input.scheduledFor ?? null,
      status: input.status,
      updatedAt: input.updatedAt ?? NOW,
      userId: "user-1",
    })
    .run();
}

describe("inProgressOf", () => {
  test("orders sending and confirming first, then preparing, then the queue", () => {
    addApplication({
      id: "queued",
      status: "approved",
      scheduledFor: NOW + 60_000,
      title: "Queued",
    });
    addApplication({ id: "preparing", status: "preparing", title: "Preparing" });
    addApplication({ id: "sending", status: "sending", title: "Sending" });
    addApplication({ id: "confirming", status: "confirming", title: "Confirming" });

    const view = inProgressOf(db, "user-1", NOW, 4);

    expect(view.total).toBe(4);
    expect(view.items.map((row) => row.status)).toEqual([
      "sending",
      "confirming",
      "preparing",
      "approved",
    ]);
  });

  test("a passed planner slot reads as next in line instead of a stale time", () => {
    addApplication({ id: "stale", status: "approved", scheduledFor: NOW - 60_000, title: "Stale" });
    addApplication({
      id: "ahead",
      status: "approved",
      scheduledFor: NOW + 3_600_000,
      title: "Ahead",
    });

    const view = inProgressOf(db, "user-1", NOW, 4);

    expect(view.items).toEqual([
      {
        company: "Northwind Labs",
        id: "stale",
        sendsAt: null,
        status: "approved",
        title: "Stale",
      },
      {
        company: "Northwind Labs",
        id: "ahead",
        sendsAt: NOW + 3_600_000,
        status: "approved",
        title: "Ahead",
      },
    ]);
  });

  test("caps the rows it returns while the total counts every application in progress", () => {
    for (const index of [1, 2, 3, 4, 5]) {
      addApplication({
        id: `approved-${String(index)}`,
        status: "approved",
        scheduledFor: NOW + index * 60_000,
        title: `Engineer ${String(index)}`,
      });
    }

    const view = inProgressOf(db, "user-1", NOW, 2);

    expect(view.total).toBe(5);
    expect(view.items.map((row) => row.id)).toEqual(["approved-1", "approved-2"]);
  });

  test("leaves sent and failed applications out of the section", () => {
    addApplication({ id: "sending", status: "sending", title: "Sending" });

    db.insert(applications)
      .values({
        ats: "greenhouse",
        companyId: "company-1",
        companyName: "Northwind Labs",
        companyNameNorm: "northwind labs",
        createdAt: NOW,
        id: "sent",
        origin: "pick",
        postingId: "posting-sent",
        postingTitle: "Sent",
        postingUrl: "https://northwind.example/sent",
        status: "sent",
        updatedAt: NOW,
        userId: "user-1",
      })
      .run();

    const view = inProgressOf(db, "user-1", NOW, 4);

    expect(view.total).toBe(1);
    expect(view.items.map((row) => row.id)).toEqual(["sending"]);
  });
});
