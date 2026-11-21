import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { test, expect } from "./admin.fixture.ts";
import { navigate, openContext, targets } from "./route-sweep.ts";
import type { Storage, Target } from "./route-sweep.ts";

const widths = [390, 1280] as const;
const themes = ["light", "dark"] as const;

const interactiveSelector =
  'a[href], button, [role="button"], [role="tab"], [role="switch"], summary';

interface Candidate {
  disabled: boolean;
  height: number;
  index: number;
  inline: boolean;
  label: string;
  signature: string;
  width: number;
  x: number;
  y: number;
}

async function collectCandidates(page: Page) {
  return page.evaluate((selector) => {
    const found: Candidate[] = [];
    const seen = new Set<string>();

    for (const [index, element] of [...document.querySelectorAll(selector)].entries()) {
      if (!(element instanceof HTMLElement) || element.closest("[data-no-hover]") !== null) {
        continue;
      }

      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();

      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        box.width === 0 ||
        box.height === 0 ||
        element.closest("[aria-hidden='true']") !== null
      ) {
        continue;
      }

      const classes = element.getAttribute("class") ?? "";
      const tag = element.tagName.toLowerCase();
      const label = `${tag} ${JSON.stringify(classes.slice(0, 70))} ${JSON.stringify((element.getAttribute("aria-label") ?? element.textContent).trim().slice(0, 30))}`;
      const signature = `${tag}|${classes}|${element.getAttribute("role") ?? ""}`;

      const disabled =
        element.matches(":disabled") || element.getAttribute("aria-disabled") === "true";

      const current =
        element.getAttribute("aria-current") !== null ||
        element.getAttribute("aria-pressed") === "true" ||
        element.getAttribute("aria-selected") === "true" ||
        element.getAttribute("aria-checked") === "true" ||
        element.matches(".on");

      const inline =
        tag === "a" &&
        style.display === "inline" &&
        element.closest("p, li, span, small, label, h1, h2, h3, dd, td") !== null;

      if (seen.has(signature) || current) {
        found.push({
          disabled,
          height: box.height,
          index,
          inline,
          label,
          signature: "",
          width: box.width,
          x: 0,
          y: 0,
        });
        continue;
      }

      seen.add(signature);
      found.push({
        disabled,
        height: box.height,
        index,
        inline,
        label,
        signature,
        width: box.width,
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      });
    }

    return found;
  }, interactiveSelector);
}

const styleProps = [
  "background-color",
  "color",
  "border-top-color",
  "border-bottom-color",
  "box-shadow",
  "opacity",
  "text-decoration-line",
  "text-decoration-color",
] as const;

async function styleOf(page: Page, index: number) {
  return page.evaluate(
    ({ selector, at, props }) => {
      const element = document.querySelectorAll(selector)[at];

      if (element === undefined) {
        return null;
      }

      const style = getComputedStyle(element);
      const parts = [element, ...element.querySelectorAll("*")].slice(0, 12);

      return {
        cursor: style.cursor,
        outlineStyle: style.outlineStyle,
        outlineWidth: Number(style.outlineWidth.replace("px", "")),
        ring: style.boxShadow,
        values: parts.flatMap((part) => {
          const partStyle = getComputedStyle(part);

          return props.map((prop) => partStyle.getPropertyValue(prop));
        }),
      };
    },
    { at: index, props: [...styleProps], selector: interactiveSelector },
  );
}

async function checkCandidate(page: Page, candidate: Candidate, width: number) {
  const misses: string[] = [];
  const before = await styleOf(page, candidate.index);

  if (before === null) {
    return misses;
  }

  const tag = candidate.label;

  if (candidate.disabled) {
    if (before.cursor !== "not-allowed") {
      misses.push(`${tag}: disabled but cursor ${before.cursor}`);
    }
  } else if (before.cursor !== "pointer") {
    misses.push(`${tag}: cursor ${before.cursor}`);
  }

  if (width <= 767 && !candidate.inline && (candidate.width < 43.5 || candidate.height < 43.5)) {
    misses.push(
      `${tag}: target ${String(Math.round(candidate.width))}x${String(Math.round(candidate.height))} under 44`,
    );
  }

  if (candidate.signature === "" || candidate.disabled) {
    return misses;
  }

  const handle = page.locator(interactiveSelector).nth(candidate.index);

  await handle.evaluate((element) => {
    element.scrollIntoView({ block: "center" });
  });
  await page.mouse.move(0, 0);

  const idle = await styleOf(page, candidate.index);

  await handle.hover({ force: true, timeout: 2000 }).catch(() => undefined);

  const hovered = await styleOf(page, candidate.index);

  if (idle !== null && hovered !== null && idle.values.join("|") === hovered.values.join("|")) {
    misses.push(`${tag}: hover changes nothing`);
  }

  await page.keyboard.press("Tab");
  await handle.focus();

  const focused = await styleOf(page, candidate.index);

  if (
    focused !== null &&
    (focused.outlineStyle === "none" || focused.outlineWidth < 2) &&
    focused.ring === "none"
  ) {
    misses.push(`${tag}: no focus ring`);
  }

  await handle.blur();

  return misses;
}

async function sweepCandidates(page: Page, remaining: Candidate[], width: number, found: string[]) {
  const [candidate, ...rest] = remaining;

  if (candidate === undefined) {
    return;
  }

  found.push(...(await checkCandidate(page, candidate, width)));
  await sweepCandidates(page, rest, width, found);
}

async function measureInteractive(page: Page, width: number) {
  const candidates = await collectCandidates(page);

  await page.evaluate(() => {
    globalThis.scrollTo(0, 0);
  });

  const found: string[] = [];

  await sweepCandidates(page, candidates, width, found);

  return found;
}

async function measureLandmarks(page: Page) {
  return page.evaluate(() => {
    const first = [
      ...document.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].find(
      (element) =>
        element.checkVisibility({ visibilityProperty: true }) &&
        element.closest("[aria-hidden='true']") === null,
    );

    const href = first?.getAttribute("href") ?? "";
    const target = href.startsWith("#") ? document.querySelector(href) : null;

    return {
      firstIsSkipToMain: target?.tagName === "MAIN",
      h1: [...document.querySelectorAll("h1")].flatMap((element) =>
        element.checkVisibility({ visibilityProperty: true }) &&
        element.closest("[aria-hidden='true']") === null
          ? [element.textContent.trim().slice(0, 40)]
          : [],
      ),
      main: [...document.querySelectorAll("main")].filter((element) =>
        element.checkVisibility({ visibilityProperty: true }),
      ).length,
    };
  });
}

async function checkTarget(page: Page, target: Target, url: string, width: number) {
  const expectedPath = new URL(url).pathname;

  await navigate(page, expectedPath);
  await expect(page.locator("main").first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(async () => {
    globalThis.scrollTo(0, 0);
    await document.fonts.ready;
  });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page
    .locator("h1")
    .first()
    .waitFor({ state: "attached", timeout: 10_000 })
    .catch(() => undefined);

  const landmarks = await measureLandmarks(page);

  expect
    .soft(landmarks.h1.length, `${target.path} visible h1s: ${landmarks.h1.join(" | ")}`)
    .toBe(1);
  expect.soft(landmarks.main, `${target.path} visible main count`).toBe(1);
  expect
    .soft(landmarks.firstIsSkipToMain, `${target.path} first focusable is the skip link`)
    .toBe(true);

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect
    .soft(
      axe.violations.map((violation) => `${violation.id}: ${violation.nodes[0]?.target.join(" ")}`),
      `${target.path} axe violations`,
    )
    .toEqual([]);

  const misses = await measureInteractive(page, width);

  expect.soft(misses, `${target.path} interactive misses`).toEqual([]);
}

async function runTargets(
  remaining: Target[],
  pageFor: (storage: Storage) => Promise<Page>,
  urlOf: (target: Target) => string,
  width: number,
) {
  const [target, ...rest] = remaining;

  if (target === undefined) {
    return;
  }

  await checkTarget(await pageFor(target.storage), target, urlOf(target), width);
  await runTargets(rest, pageFor, urlOf, width);
}

test.describe.configure({ timeout: 240_000 });

for (const width of widths) {
  for (const theme of themes) {
    test(`G3/G7 every route at ${String(width)} ${theme}`, async ({
      adminAppUrl,
      appServerUrl,
      browser,
      chromeOwnerStorage,
      ownerAccessCookieState,
    }) => {
      const states = { admin: ownerAccessCookieState, app: chromeOwnerStorage };

      const contexts = {
        admin: await openContext(browser, "admin", width, theme, states),
        anonymous: await openContext(browser, "anonymous", width, theme, states),
        app: await openContext(browser, "app", width, theme, states),
      };

      const urls: Record<Storage, string> = {
        admin: adminAppUrl,
        anonymous: appServerUrl,
        app: appServerUrl,
      };

      const startPaths: Record<Storage, string> = {
        admin: "/admin",
        anonymous: "/signin",
        app: "/",
      };

      const pages = new Map<Storage, Page>();

      const pageFor = async (storage: Storage) => {
        const open = pages.get(storage);

        if (open !== undefined) {
          return open;
        }

        const page = await contexts[storage].newPage();

        await page.goto(`${urls[storage]}${startPaths[storage]}`);
        await expect(page.locator("main").first()).toBeVisible({ timeout: 15_000 });
        await page.addStyleTag({
          content:
            "*, ::before, ::after { transition: none !important; animation: none !important; }",
        });
        pages.set(storage, page);

        return page;
      };

      try {
        await runTargets(
          targets,
          pageFor,
          (target) => `${urls[target.storage]}${target.url}`,
          width,
        );
      } finally {
        await Promise.all(Object.values(contexts).map(async (context) => context.close()));
      }
    });
  }
}
