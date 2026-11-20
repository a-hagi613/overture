import { z } from "zod";

import { expect, test } from "./app.fixture.ts";

const settingsSchema = z.record(z.string(), z.string());

const settingSchema = z.object({ key: z.string(), value: z.string() });

const killSwitchSchema = z.object({
  scope: z.string(),
  key: z.string(),
  enabled: z.number(),
});

const killSwitchesSchema = z.array(killSwitchSchema);

test("settings and kill switches read their defaults and can be changed", async ({
  appServerUrl,
}) => {
  const settingsResponse = await fetch(`${appServerUrl}/api/settings`);

  expect(settingsResponse.ok).toBe(true);

  const allSettings = settingsSchema.parse(await settingsResponse.json());

  expect(allSettings["limits.daily_cap"]).toBe("10");
  expect(allSettings["browser.provider"]).toBe("browser_use");
  expect(allSettings["match.strong"]).toBe("80");

  const putResponse = await fetch(`${appServerUrl}/api/settings/limits.daily_cap`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "5" }),
  });

  expect(putResponse.ok).toBe(true);

  const afterPut = settingSchema.parse(await putResponse.json());

  expect(afterPut.value).toBe("5");

  const getOneResponse = await fetch(`${appServerUrl}/api/settings/limits.daily_cap`);

  expect(getOneResponse.ok).toBe(true);

  const getOne = settingSchema.parse(await getOneResponse.json());

  expect(getOne.value).toBe("5");

  const switchesResponse = await fetch(`${appServerUrl}/api/kill-switches`);

  expect(switchesResponse.ok).toBe(true);

  const switchesBefore = killSwitchesSchema.parse(await switchesResponse.json());

  expect(Array.isArray(switchesBefore)).toBe(true);

  const putSwitchResponse = await fetch(`${appServerUrl}/api/kill-switches/global/all`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, reason: "test", setBy: "owner" }),
  });

  expect(putSwitchResponse.ok).toBe(true);

  const switchesAfterResponse = await fetch(`${appServerUrl}/api/kill-switches`);

  expect(switchesAfterResponse.ok).toBe(true);

  const switchesAfter = killSwitchesSchema.parse(await switchesAfterResponse.json());
  const globalSwitch = switchesAfter.find((s) => s.scope === "global" && s.key === "all");

  expect(globalSwitch).toBeDefined();
  expect(globalSwitch?.enabled).toBe(1);
});
