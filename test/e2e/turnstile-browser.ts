import type { APIRequestContext, Page } from "@playwright/test";

import { expect } from "@playwright/test";
import { z } from "zod";

export const turnstileBrowserScenarioSchema = z.object({
  mode: z.enum(["pass", "interaction", "error", "timeout", "expired", "hang"]).default("pass"),
  delayMs: z.number().int().min(0).max(10_000).default(25),
});

export type TurnstileBrowserScenario = z.infer<typeof turnstileBrowserScenarioSchema>;

export interface TurnstileStubCounts {
  executes: number;
  renders: number;
  removes: number;
  resets: number;
}

export interface TurnstileStubRender {
  action: string | undefined;
  appearance: string | undefined;
  execution: string | undefined;
}

declare global {
  var turnstileStub:
    | {
        counts: () => TurnstileStubCounts;
        expire: () => void;
        lastRender: () => TurnstileStubRender | null;
        mode: () => string;
      }
    | undefined;
}

export async function setTurnstileBrowserScenario(
  request: APIRequestContext,
  appServerUrl: string,
  scenario: TurnstileBrowserScenario,
) {
  const response = await request.post(`${appServerUrl}/__test__/turnstile/browser`, {
    data: scenario,
  });

  if (!response.ok()) {
    throw new Error(
      `Setting the browser Turnstile scenario failed with ${String(response.status())}.`,
    );
  }
}

export async function turnstileStubCounts(page: Page) {
  return page.evaluate(() => {
    const stub = globalThis.turnstileStub;

    if (stub === undefined) {
      throw new Error("The Turnstile browser stub is not installed.");
    }

    return stub.counts();
  });
}

export async function waitForTurnstileStub(page: Page) {
  await expect
    .poll(async () => await page.evaluate(() => globalThis.turnstileStub !== undefined))
    .toBe(true);
}

export async function turnstileStubLastRender(page: Page) {
  return page.evaluate(() => globalThis.turnstileStub?.lastRender() ?? null);
}

export async function expireTurnstileStub(page: Page) {
  await page.evaluate(() => globalThis.turnstileStub?.expire());
}
