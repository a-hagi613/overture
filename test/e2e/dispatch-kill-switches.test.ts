import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { SseEvent } from "./sse.ts";

import { expect, test } from "./app.fixture.ts";
import {
  clockNow,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";
import { readSseEventUntil } from "./sse.ts";

const alertSchema = z.object({
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  kind: z.string(),
});

const switchSchema = z.array(
  z.object({
    enabled: z.number(),
    key: z.string(),
    reason: z.string(),
    scope: z.string(),
  }),
);

type AttemptOutcome =
  | "sent"
  | "unconfirmed"
  | "captcha_blocked"
  | "code_timeout"
  | "posting_closed"
  | "form_changed"
  | "blocked"
  | "upload_failed"
  | "duplicate"
  | "needs_review"
  | "provider_error"
  | "timeout"
  | "crash"
  | "interrupted";

const repeated = (count: number, outcome: AttemptOutcome) =>
  Array.from({ length: count }, () => outcome);

async function seedAttempts(
  owner: APIRequestContext,
  applicationId: string,
  outcomes: readonly AttemptOutcome[],
  provider: "browser_use" | "kernel" | "local",
) {
  const now = await clockNow(owner);

  const response = await owner.post("/__test__/attempts", {
    data: {
      attempts: outcomes.map((outcome, index) => ({
        applicationId,
        at: now - index,
        outcome,
        provider,
      })),
    },
  });

  expect(response.ok()).toBe(true);
}

async function seedReadyApplication(owner: APIRequestContext, userId: string) {
  const companyId = await seedCompany(owner, "Acme", "acme.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "acme");

  const postingId = await seedPosting(owner, {
    atsJobId: "acme-1",
    boardId,
    companyId,
    url: "https://acme.example/jobs/1",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "ready",
    userId,
  });

  return { applicationId, companyId };
}

async function killSwitchAlert(appServerUrl: string, scope: string) {
  return readSseEventUntil(`${appServerUrl}/api/events`, null, (event: SseEvent) => {
    if (event.event !== "alert.raised") {
      return false;
    }

    const parsed = alertSchema.safeParse(JSON.parse(event.data));

    return (
      parsed.success &&
      parsed.data.kind === "dispatch.kill_switch" &&
      parsed.data.detail["scope"] === scope
    );
  });
}

async function runWatch(owner: APIRequestContext) {
  const response = await owner.post("/__test__/jobs/run-now", {
    data: { kind: "dispatch.watch", payload: "{}" },
  });

  expect(response.ok()).toBe(true);
}

async function switchesOf(owner: APIRequestContext) {
  const response = await owner.get("/api/kill-switches");

  return switchSchema.parse(await response.json());
}

test("a collapsing ATS success rate trips the ATS kill switch and alerts the owner", async ({
  isolatedAppServer: { url },
}) => {
  const { owner, userId } = await ownerContextFor(url);
  const { applicationId } = await seedReadyApplication(owner, userId);

  const outcomes: AttemptOutcome[] = Array.from({ length: 50 }, (_, index) =>
    index === 0 ? "sent" : "blocked",
  );

  await seedAttempts(owner, applicationId, outcomes, "local");

  const alert = killSwitchAlert(url, "ats");

  await runWatch(owner);

  const raised = await alert;

  expect(raised).not.toBeNull();

  const greenhouse = (await switchesOf(owner)).find(
    (entry) => entry.scope === "ats" && entry.key === "greenhouse",
  );

  expect(greenhouse?.enabled).toBe(1);
  expect(greenhouse?.reason).toContain("success rate");
});

test("a collapsing provider success rate trips the provider kill switch and alerts the owner", async ({
  isolatedAppServer: { url },
}) => {
  const { owner, userId } = await ownerContextFor(url);
  const { applicationId } = await seedReadyApplication(owner, userId);

  const outcomes: AttemptOutcome[] = [...repeated(9, "sent"), ...repeated(11, "timeout")];

  await seedAttempts(owner, applicationId, outcomes, "local");

  const alert = killSwitchAlert(url, "provider");

  await runWatch(owner);

  expect(await alert).not.toBeNull();

  const local = (await switchesOf(owner)).find(
    (entry) => entry.scope === "provider" && entry.key === "local",
  );

  expect(local?.enabled).toBe(1);
  expect(local?.reason).toContain("success rate");
});

test("three blocked applications in a row trip the employer kill switch and alert the owner", async ({
  isolatedAppServer: { url },
}) => {
  const { owner, userId } = await ownerContextFor(url);
  const { applicationId, companyId } = await seedReadyApplication(owner, userId);

  await seedAttempts(owner, applicationId, ["blocked", "captcha_blocked", "blocked"], "local");

  const alert = killSwitchAlert(url, "employer");

  await runWatch(owner);

  expect(await alert).not.toBeNull();

  const employer = (await switchesOf(owner)).find(
    (entry) => entry.scope === "employer" && entry.key === companyId,
  );

  expect(employer?.enabled).toBe(1);
  expect(employer?.reason).toContain("blocked");
});
