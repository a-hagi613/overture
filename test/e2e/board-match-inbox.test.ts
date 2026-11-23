import type { Browser, BrowserContext } from "@playwright/test";
import { request as apiRequest } from "@playwright/test";

import type { AppServer } from "./app-server.ts";

import { AxeBuilder } from "@axe-core/playwright";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { referenceNow, seedInboxOwner, seedInboxThreads } from "./inbox-harness.ts";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

interface BoardContext {
  server: AppServer;
  storageState: StorageState;
}

interface InboxBoards extends BoardContext {
  fenwickThreadId: string;
}

const test = appTest.extend<{ boards: InboxBoards; emptyBoards: BoardContext }>({
  boards: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, {
        INBOUND_HMAC_SECRET: "e2e-inbox-board-secret-0123456789",
        MAIL_DOMAIN: "tryoverture.com",
      });

      const request = await apiRequest.newContext({ baseURL: server.url });

      const userId = await seedInboxOwner(request, server.url);
      const { fenwickThreadId } = await seedInboxThreads(request, userId);
      const storageState = await request.storageState();

      await request.dispose();

      await provide({ fenwickThreadId, server, storageState });

      await server.stop();
    },
    { scope: "test" },
  ],
  emptyBoards: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, {
        INBOUND_HMAC_SECRET: "e2e-inbox-board-secret-0123456789",
        MAIL_DOMAIN: "tryoverture.com",
      });

      const request = await apiRequest.newContext({ baseURL: server.url });

      await seedInboxOwner(request, server.url);

      const storageState = await request.storageState();

      await request.dispose();

      await provide({ server, storageState });

      await server.stop();
    },
    { scope: "test" },
  ],
});

const DESKTOP_HEIGHT = 1140;

async function shot(
  browser: Browser,
  boards: BoardContext,
  input: {
    height: number;
    name: string;
    path: string;
    theme: "dark" | "light";
    waitFor: string;
    waitForEnabledButtons?: boolean;
    width: number;
  },
) {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState: boards.storageState,
    timezoneId: "America/Toronto",
    viewport: { height: input.height, width: input.width },
  });

  const page = await context.newPage();

  await page.clock.setFixedTime(new Date(referenceNow));

  if (input.theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${boards.server.url}${input.path}`);
  await expect(page.getByText(input.waitFor).filter({ visible: true }).first()).toBeVisible();

  if (input.waitForEnabledButtons === true) {
    await page.waitForFunction(
      () => document.querySelectorAll("main button:disabled").length === 0,
      undefined,
      { timeout: 15_000 },
    );
  }

  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 16px "Plus Jakarta Sans"'),
      document.fonts.load('600 16px "Plus Jakarta Sans"'),
      document.fonts.load('400 16px "Instrument Serif"'),
      document.fonts.load('400 12px "IBM Plex Mono"'),
    ]);
    await document.fonts.ready;
  });

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, input.name).toEqual([]);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(overflow, input.name).toBe(false);

  await context.close();
}

const PHONE_HEIGHTS = {
  address: 1643,
  empty: 948,
  list: 1160,
  thread: 1171,
} as const;

type BoardName = keyof typeof PHONE_HEIGHTS;

function variants(board: BoardName) {
  const rows: { height: number; name: string; theme: "dark" | "light"; width: 390 | 1280 }[] = [];

  for (const width of [1280, 390] as const) {
    for (const theme of ["light", "dark"] as const) {
      const suffix = theme === "light" ? "" : "-dark";

      rows.push({
        height: width === 390 ? PHONE_HEIGHTS[board] : DESKTOP_HEIGHT,
        name: `inbox-${board}-${String(width)}${suffix}.png`,
        theme,
        width,
      });
    }
  }

  return rows;
}

test("the Inbox list matches the board", async ({ browser, boards }) => {
  await Promise.all(
    variants("list").map(async (variant) =>
      shot(browser, boards, {
        ...variant,
        path: "/inbox",
        waitFor: "Couldn't verify sender",
      }),
    ),
  );
});

test("the thread view matches the board", async ({ browser, boards }) => {
  await Promise.all(
    variants("thread").map(async (variant) =>
      shot(browser, boards, {
        ...variant,
        path: `/inbox/${boards.fenwickThreadId}`,
        waitFor: "Platform_Interview_Brief.pdf",
      }),
    ),
  );
});

test("the empty Inbox matches the board", async ({ browser, emptyBoards }) => {
  await Promise.all(
    variants("empty").map(async (variant) =>
      shot(browser, emptyBoards, {
        ...variant,
        path: "/inbox",
        waitFor: "Nothing forwarded",
      }),
    ),
  );
});

test("the forwarding address explainer matches the board", async ({ browser, boards }) => {
  await Promise.all(
    variants("address").map(async (variant) =>
      shot(browser, boards, {
        ...variant,
        path: "/profile/account#email-forwarding",
        waitFor: "Copy address",
        waitForEnabledButtons: true,
      }),
    ),
  );
});
