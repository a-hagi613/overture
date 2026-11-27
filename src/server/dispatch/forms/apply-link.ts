import type { Page } from "playwright-core";

import { FORM_APPEAR_MS, openForm } from "./engine.ts";

export interface ApplyLink {
  href: string;
  text: string;
}

const APPLY_PATH = /\/(?:apply|application)(?:\/|$)/iu;

const APPLY_TEXT = /^(?:apply|apply now|apply for this job|start (?:your )?application)\b/iu;

function extendsJobPath(page: URL, candidate: URL) {
  return candidate.pathname.startsWith(`${page.pathname.replace(/\/+$/u, "")}/`);
}

/**
 * Picks the one "Apply" link to follow when an ATS handed us its job page
 * instead of its application form (issue #703). Only a link on the same job
 * system and under the same job path qualifies, and a page already at an
 * application path is never followed again, so the fallback runs at most once.
 *
 * @param pageUrl The URL the job page was opened at.
 * @param links Every link the page rendered.
 * @returns The apply URL to follow, or `null` when no link qualifies.
 */
export function sameSystemApplyUrl(pageUrl: string, links: readonly ApplyLink[]) {
  let page: URL;

  try {
    page = new URL(pageUrl);
  } catch {
    return null;
  }

  if (APPLY_PATH.test(page.pathname)) {
    return null;
  }

  for (const link of links) {
    let candidate: URL;

    try {
      candidate = new URL(link.href, page);
    } catch {
      continue;
    }

    if (
      candidate.protocol !== page.protocol ||
      candidate.host !== page.host ||
      candidate.pathname === page.pathname ||
      !extendsJobPath(page, candidate)
    ) {
      continue;
    }

    if (APPLY_PATH.test(candidate.pathname) || APPLY_TEXT.test(link.text.trim())) {
      return candidate.toString();
    }
  }

  return null;
}

async function renderedLinks(page: Page) {
  return page.locator("a[href]").evaluateAll((elements) =>
    elements.map((element) => ({
      href: element.getAttribute("href") ?? "",
      text: element.textContent.replaceAll(/\s+/gu, " ").trim(),
    })),
  );
}

/**
 * Opens the one live form, following a same-system "Apply" link once when the
 * page we were handed is a job description rather than its application form.
 *
 * @param page The page that should hold the form.
 * @param selector The one application form selector the ATS owns.
 * @param timeout How long to wait for the form to become visible on each page.
 * @returns The verified root, or `null` when neither page carries it.
 */
export async function openApplyForm(page: Page, selector: string, timeout = FORM_APPEAR_MS) {
  const direct = await openForm(page, selector, timeout);

  if (direct !== null) {
    return direct;
  }

  const target = sameSystemApplyUrl(page.url(), await renderedLinks(page));

  if (target === null) {
    return null;
  }

  await page.goto(target, { waitUntil: "domcontentloaded" });

  return openForm(page, selector, timeout);
}
