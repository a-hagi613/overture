import { expect } from "@playwright/test";

import type { APIRequestContext } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";

export async function seedUnreadNotifications(
  request: APIRequestContext,
  appServerUrl: string,
  count = 3,
) {
  const response = await request.post(`${appServerUrl}/__test__/notifications/seed`, {
    data: {
      email: authTestIdentity.ownerEmail,
      rows: Array.from({ length: count }, (_entry, index) => ({
        at: Date.UTC(2026, 10, 17, 7 + index, 4, 0),
        body: "Overture prepared your applications this morning. Nothing is sent until you approve.",
        kind: "ready",
        title: `Recap: ${String(10 - index)} ready to approve`,
        url: "/ready",
      })),
    },
  });

  expect(response.ok()).toBe(true);
}
