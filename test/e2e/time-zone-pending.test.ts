import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";

const DAY_MS = 24 * 60 * 60_000;
const SECOND_MS = 1000;

const clockSchema = z.object({ now: z.number(), offsetMs: z.number() });

const profileSettingsSchema = z.object({
  languages: z.array(z.string()),
  timezone: z.string().nullable(),
  pendingTimezone: z.string().nullable(),
  pendingTimezoneAt: z.string().nullable(),
});

async function ownerContextFor(appServerUrl: string) {
  const owner = await apiRequest.newContext({ baseURL: appServerUrl });

  await requestMagicLink(appServerUrl, owner, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, owner, authTestIdentity.ownerEmail);

  await owner.get(link);

  const state = await verifyAuthState(appServerUrl, owner);

  expect(state.users.at(-1)?.role).toBe("owner");

  return owner;
}

async function clockNow(appServerUrl: string) {
  return clockSchema.parse(await (await fetch(`${appServerUrl}/__test__/clock`)).json()).now;
}

async function moveClockTo(appServerUrl: string, offsetMs: number) {
  const response = await fetch(`${appServerUrl}/__test__/clock/offset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offsetMs }),
  });

  expect(response.ok).toBe(true);
}

test("the first zone applies at once, and a later change waits seven days on the clock", async ({
  isolatedAppServer: { url: appServerUrl },
}) => {
  const owner = await ownerContextFor(appServerUrl);

  const save = async (timezone: string) => {
    const before = await clockNow(appServerUrl);

    const saved = profileSettingsSchema.parse(
      await (
        await owner.put("/api/profile/settings", { data: { languages: ["en"], timezone } })
      ).json(),
    );

    const after = await clockNow(appServerUrl);

    return { before, after, saved };
  };

  const read = async () =>
    profileSettingsSchema.parse(await (await owner.get("/api/profile/settings")).json());

  const first = await save("America/Toronto");

  expect(first.saved.timezone).toBe("America/Toronto");
  expect(first.saved.pendingTimezone).toBeNull();
  expect(first.saved.pendingTimezoneAt).toBeNull();

  const change = await save("America/Vancouver");

  expect(change.saved.timezone).toBe("America/Toronto");
  expect(change.saved.pendingTimezone).toBe("America/Vancouver");

  const effectiveAt = Date.parse(change.saved.pendingTimezoneAt ?? "");

  expect(effectiveAt).toBeGreaterThanOrEqual(change.before + 7 * DAY_MS - SECOND_MS);
  expect(effectiveAt).toBeLessThanOrEqual(change.after + 7 * DAY_MS);

  await moveClockTo(appServerUrl, 6 * DAY_MS);

  const sixDaysIn = await read();

  expect(sixDaysIn.timezone).toBe("America/Toronto");
  expect(sixDaysIn.pendingTimezone).toBe("America/Vancouver");
  expect(sixDaysIn.pendingTimezoneAt).toBe(change.saved.pendingTimezoneAt);

  await moveClockTo(appServerUrl, 7 * DAY_MS);

  const sevenDaysIn = await read();

  expect(sevenDaysIn.timezone).toBe("America/Vancouver");
  expect(sevenDaysIn.pendingTimezone).toBeNull();
  expect(sevenDaysIn.pendingTimezoneAt).toBeNull();

  await owner.dispose();
});

test("saving the pending zone again keeps its date, and saving the current zone cancels the change", async ({
  isolatedAppServer: { url: appServerUrl },
}) => {
  const owner = await ownerContextFor(appServerUrl);

  const put = async (timezone: string) =>
    profileSettingsSchema.parse(
      await (
        await owner.put("/api/profile/settings", { data: { languages: ["en"], timezone } })
      ).json(),
    );

  await put("America/Toronto");

  const pending = await put("Europe/Berlin");
  const repeated = await put("Europe/Berlin");

  expect(repeated.pendingTimezone).toBe("Europe/Berlin");
  expect(repeated.pendingTimezoneAt).toBe(pending.pendingTimezoneAt);

  const cancelled = await put("America/Toronto");

  expect(cancelled.timezone).toBe("America/Toronto");
  expect(cancelled.pendingTimezone).toBeNull();
  expect(cancelled.pendingTimezoneAt).toBeNull();

  await owner.dispose();
});
