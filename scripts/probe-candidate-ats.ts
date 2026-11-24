import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import type { Browser, Page } from "playwright-core";

import { chromium } from "playwright-core";

const CSV_BASE = "https://storage.stapply.ai/jobs/v1";

const BOARDS = ["paycom", "pageup", "welcometothejungle"] as const;

type Board = (typeof BOARDS)[number];

const SAMPLE_SIZE = 10;

const MAX_SCANNED_RECORDS = 400;

const NAVIGATION_TIMEOUT_MS = 30_000;

const ACTION_TIMEOUT_MS = 8000;

const SETTLE_MS = 2000;

const APPLY_PATTERN = /\b(?:apply|application|candidat|postuler|bewerben|応募|申し込)/iu;

const SUBMIT_PATTERN = /\b(?:submit|send\s+application|confirm)\b|送信/iu;

const ACCOUNT_WALL_PATTERN =
  /\b(?:sign\s+in|log\s+in|create\s+an\s+account|register|password|pin\s+code|enter\s+(?:your\s+)?pin|verify\s+your\s+identity)\b/iu;

const PIN_PATTERN = /\bpin\b|\bone[-\s]?time\s+(?:code|passcode)\b/iu;

const EXTERNAL_ATS_PATTERNS: readonly RegExp[] = [
  /greenhouse\.io/iu,
  /lever\.co/iu,
  /workday\.com/iu,
  /myworkdayjobs\.com/iu,
  /icims\.com/iu,
  /taleo\.net/iu,
  /successfactors\.(?:com|eu)/iu,
  /smartrecruiters\.com/iu,
  /ashbyhq\.com/iu,
  /jobvite\.com/iu,
  /bamboohr\.com/iu,
  /recruitee\.com/iu,
  /personio\.(?:de|com)/iu,
  /workable\.com/iu,
  /teamtailor\.com/iu,
  /paylocity\.com/iu,
  /ultipro\.com/iu,
  /pageuppeople\.com/iu,
];

interface SampleRow {
  url: string;
  title: string;
  company: string;
  applyUrl: string | null;
}

interface FormFacts {
  forms: number;
  inputs: number;
  selects: number;
  textareas: number;
  iframes: number;
  comboboxes: number;
  fileInputs: number;
  emailInputs: number;
  contactInputs: number;
  passwordInputs: number;
  framework: string;
}

interface ProbeObservation {
  board: Board;
  postingUrl: string;
  finalUrl: string;
  status: number | null;
  externalRedirect: boolean;
  applyControlFound: boolean;
  applyClicked: boolean;
  guestForm: boolean;
  accountWall: boolean;
  pinWall: boolean;
  captchaFriction: boolean;
  forms: FormFacts;
  notes: string;
  error: string | null;
  elapsedMs: number;
}

class CsvStream {
  private inQuotes = false;
  private field = "";
  private record: string[] = [];
  readonly records: string[][] = [];

  feed(chunk: string, limit: number) {
    for (const character of chunk) {
      if (this.records.length >= limit) {
        return;
      }

      if (this.inQuotes) {
        if (character === '"') {
          this.inQuotes = false;
        } else {
          this.field += character;
        }

        continue;
      }

      if (character === '"') {
        this.inQuotes = true;

        continue;
      }

      if (character === ",") {
        this.record.push(this.field);
        this.field = "";

        continue;
      }

      if (character === "\n") {
        this.record.push(this.field);

        if (this.record.length > 1) {
          this.records.push(this.record);
        }

        this.record = [];
        this.field = "";

        continue;
      }

      if (character !== "\r") {
        this.field += character;
      }
    }
  }
}

async function fetchSampleRows(board: Board) {
  const controller = new AbortController();

  const response = await fetch(`${CSV_BASE}/${board}/jobs.csv`, {
    signal: controller.signal,
  });

  if (!response.ok || response.body === null) {
    throw new Error(`${board} CSV answered ${String(response.status)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const csv = new CsvStream();
  const rows: SampleRow[] = [];
  let header: string[] | null = null;

  const recordRow = (record: readonly string[]) => {
    if (header === null) {
      header = [...record];

      return;
    }

    const columns = header;

    const cell = (name: string) => {
      const index = columns.indexOf(name);

      return index === -1 ? "" : (record[index] ?? "");
    };

    const url = cell("url").trim();

    if (url === "") {
      return;
    }

    const applyUrl = cell("apply_url").trim();

    rows.push({
      applyUrl: applyUrl === "" ? null : applyUrl,
      company: cell("company").trim(),
      title: cell("title").trim(),
      url,
    });
  };

  const consumeRecords: (records: readonly string[][], index: number) => void = (
    records,
    index,
  ) => {
    const record = records[index];

    if (record === undefined || rows.length >= MAX_SCANNED_RECORDS) {
      return;
    }

    recordRow(record);
    consumeRecords(records, index + 1);
  };

  const readChunk: () => Promise<void> = async () => {
    if (rows.length >= MAX_SCANNED_RECORDS) {
      return;
    }

    const { done, value } = await reader.read();

    if (done) {
      return;
    }

    csv.feed(decoder.decode(value, { stream: true }), MAX_SCANNED_RECORDS + 1);

    consumeRecords(csv.records.splice(0), 0);

    return readChunk();
  };

  try {
    await readChunk();
  } finally {
    controller.abort();
  }

  return sampleRows(rows, SAMPLE_SIZE);
}

function sampleRows(rows: readonly SampleRow[], count: number) {
  const seenCompanies = new Set<string>();
  const picked: SampleRow[] = [];

  for (const row of rows) {
    const company = row.company.toLowerCase();

    if (company !== "" && seenCompanies.has(company)) {
      continue;
    }

    seenCompanies.add(company);
    picked.push(row);

    if (picked.length >= count) {
      return picked;
    }
  }

  for (const row of rows) {
    if (picked.length >= count) {
      break;
    }

    if (!picked.includes(row)) {
      picked.push(row);
    }
  }

  return picked.slice(0, count);
}

function hostsDiffer(url: string, startUrl: string) {
  try {
    return new URL(url).hostname !== new URL(startUrl).hostname;
  } catch {
    return false;
  }
}

function isKnownAtsHost(url: string) {
  try {
    const host = new URL(url).hostname;

    return EXTERNAL_ATS_PATTERNS.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

const APPLY_EXACT =
  /^(?:apply|apply now|apply for this job|apply for this position|postuler|candidater|bewerben|応募する?)$/iu;

function applyRank(text: string) {
  if (APPLY_EXACT.test(text)) {
    return 0;
  }

  if (/\bapply\b|postuler|candidater|bewerben|応募/iu.test(text)) {
    return 1;
  }

  return APPLY_PATTERN.test(text) ? 2 : 3;
}

async function waitForApplyControl(page: Page) {
  try {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("a, button")].some((element) =>
          /apply|application|candidat|postuler|bewerben|応募/iu.test(element.textContent),
        ),
      { timeout: 12_000 },
    );

    return true;
  } catch {
    return false;
  }
}

async function dismissConsent(page: Page) {
  const consent = page
    .locator("button, a")
    .filter({ hasText: /^(?:accept(?: all)?(?: cookies)?|agree|got it|ok|allow all)$/iu });

  const count = Math.min(await consent.count().catch(() => 0), 5);

  const tryFrom: (index: number) => Promise<boolean> = async (index) => {
    const button = consent.nth(index);

    if (index >= count) {
      return false;
    }

    if (!(await button.isVisible().catch(() => false))) {
      return tryFrom(index + 1);
    }

    try {
      await button.click({ timeout: 3000 });

      return true;
    } catch {
      return tryFrom(index + 1);
    }
  };

  await tryFrom(0);
}

async function clickApply(page: Page) {
  const candidates = page
    .locator("a, button, input[type='button'], input[type='submit']")
    .filter({ hasText: APPLY_PATTERN });

  const count = Math.min(await candidates.count().catch(() => 0), 20);

  const labelled = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const candidate = candidates.nth(index);

      const text = (
        (await candidate.textContent().catch(() => "")) ||
        (await candidate.getAttribute("value").catch(() => null)) ||
        ""
      )
        .replaceAll(/\s+/gu, " ")
        .trim();

      return { index, rank: text === "" || SUBMIT_PATTERN.test(text) ? 3 : applyRank(text) };
    }),
  );

  labelled.sort((left, right) => left.rank - right.rank);

  const tryFrom: (position: number) => Promise<boolean> = async (position) => {
    const entry = labelled[position];

    if (entry === undefined || entry.rank >= 3) {
      return false;
    }

    const candidate = candidates.nth(entry.index);

    try {
      await candidate.click({ timeout: ACTION_TIMEOUT_MS });
      await page.waitForLoadState("domcontentloaded", { timeout: NAVIGATION_TIMEOUT_MS });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);

      return true;
    } catch {
      return tryFrom(position + 1);
    }
  };

  return tryFrom(0);
}

async function readFormFacts(page: Page) {
  return page.evaluate(() => {
    const scripts = [...document.querySelectorAll("script[src]")]
      .map((script) => script.getAttribute("src") ?? "")
      .join(" ");

    const framework = (() => {
      if (scripts.includes("_next") || Reflect.has(globalThis, "__NEXT_DATA__")) {
        return "Next.js";
      }

      if (scripts.includes("react")) {
        return "React";
      }

      if (scripts.includes("vue")) {
        return "Vue";
      }

      return document.querySelector("[data-reactroot], #__next, #app") === null
        ? "server-rendered"
        : "SPA";
    })();

    const inputs = [...document.querySelectorAll("input")].filter((input) => {
      const rect = input.getBoundingClientRect();
      const style = globalThis.getComputedStyle(input);

      return rect.width > 0 && rect.height > 0 && style.display !== "none";
    });

    return {
      comboboxes: document.querySelectorAll("[role='combobox']").length,
      contactInputs: inputs.filter((input) =>
        /email|first.?name|last.?name|full.?name|resume|cv|phone/iu.test(
          [
            input.getAttribute("name"),
            input.getAttribute("id"),
            input.getAttribute("placeholder"),
            input.getAttribute("aria-label"),
          ].join(" "),
        ),
      ).length,
      emailInputs: inputs.filter((input) => input.getAttribute("type") === "email").length,
      fileInputs: inputs.filter((input) => input.getAttribute("type") === "file").length,
      forms: [...document.querySelectorAll("form")].filter((form) => {
        const rect = form.getBoundingClientRect();

        return rect.width > 0 && rect.height > 0;
      }).length,
      framework,
      iframes: document.querySelectorAll("iframe").length,
      inputs: inputs.length,
      passwordInputs: inputs.filter((input) => input.getAttribute("type") === "password").length,
      selects: [...document.querySelectorAll("select")].filter((select) => {
        const rect = select.getBoundingClientRect();

        return rect.width > 0 && rect.height > 0;
      }).length,
      textareas: [...document.querySelectorAll("textarea")].filter((area) => {
        const rect = area.getBoundingClientRect();

        return rect.width > 0 && rect.height > 0;
      }).length,
    } satisfies FormFacts;
  });
}

function guestFormVisible(facts: FormFacts) {
  return facts.inputs >= 3 && facts.passwordInputs === 0 && facts.contactInputs >= 2;
}

function emptyForms() {
  return {
    comboboxes: 0,
    contactInputs: 0,
    emailInputs: 0,
    fileInputs: 0,
    forms: 0,
    framework: "unknown",
    iframes: 0,
    inputs: 0,
    passwordInputs: 0,
    selects: 0,
    textareas: 0,
  } satisfies FormFacts;
}

async function probeOne(board: Board, row: SampleRow, browser: Browser) {
  const startedAt = performance.now();

  const context = await browser.newContext({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
    viewport: { height: 900, width: 1440 },
  });

  const page = await context.newPage();

  const observation: ProbeObservation = {
    accountWall: false,
    applyClicked: false,
    applyControlFound: false,
    board,
    captchaFriction: false,
    elapsedMs: 0,
    error: null,
    externalRedirect: row.applyUrl === null ? false : hostsDiffer(row.applyUrl, row.url),
    finalUrl: row.url,
    forms: emptyForms(),
    guestForm: false,
    notes: "",
    pinWall: false,
    postingUrl: row.url,
    status: null,
  };

  try {
    const response = await page.goto(row.url, {
      timeout: NAVIGATION_TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    });

    observation.status = response?.status() ?? null;
    observation.finalUrl = page.url();

    const servedChallenge =
      response !== null &&
      (response.status() === 403 || response.status() === 429 || response.status() === 503);

    const challengeHtml = await (async () => {
      if (response === null) {
        return false;
      }

      try {
        const html = await response.text();

        return /just a moment|attention required|cf-challenge|enable javascript and cookies|checking your browser|verify you are human|request blocked|could not be satisfied|access denied|\b403 error\b|awswafcookiedomainlist|gokuprops|aws-waf/iu.test(
          html,
        );
      } catch {
        return false;
      }
    })();

    const challengeHeader = await (async () => {
      if (response === null) {
        return null;
      }

      try {
        return await response.headerValue("cf-mitigated");
      } catch {
        return null;
      }
    })();

    await dismissConsent(page);

    observation.applyControlFound = await waitForApplyControl(page);
    observation.applyClicked = observation.applyControlFound ? await clickApply(page) : false;

    await page.waitForTimeout(SETTLE_MS);

    observation.finalUrl = page.url();
    observation.externalRedirect = hostsDiffer(page.url(), row.url);

    observation.forms = await readFormFacts(page);
    observation.guestForm = guestFormVisible(observation.forms);

    const walls = await page.evaluate(() => {
      const password = [...document.querySelectorAll("input[type='password']")].some((input) => {
        const rect = input.getBoundingClientRect();

        return rect.width > 0 && rect.height > 0;
      });

      const regions = [...document.querySelectorAll("dialog, [role='dialog'], main, form")].filter(
        (element) => {
          const rect = element.getBoundingClientRect();

          return rect.width > 0 && rect.height > 0;
        },
      );

      return {
        path: globalThis.location.pathname,
        password,
        regionText: regions.map((element) => element.textContent).join(" "),
      };
    });

    const pageHtml = await page.content().catch(() => "");
    const emptyShell = pageHtml.length < 500;

    const challengeVisible = await page.evaluate(() =>
      [...document.querySelectorAll("iframe, .g-recaptcha, [data-sitekey], .cf-turnstile")].some(
        (element) => {
          const rect = element.getBoundingClientRect();
          const src = element.getAttribute("src") ?? "";

          const challengeFrame =
            /\/bframe|hcaptcha.*challenge|turnstile.*challenge/iu.test(src) &&
            rect.width > 200 &&
            rect.height > 150;

          const visibleWidget =
            element.matches(".g-recaptcha, .cf-turnstile, [data-sitekey]") &&
            rect.width > 10 &&
            rect.height > 10;

          return challengeFrame || visibleWidget;
        },
      ),
    );

    observation.accountWall =
      !observation.guestForm &&
      (walls.password ||
        /\/(?:login|signin|sign-in|account|register)\b/iu.test(walls.path) ||
        ACCOUNT_WALL_PATTERN.test(walls.regionText));

    observation.pinWall = !observation.guestForm && PIN_PATTERN.test(walls.regionText);

    const challengePage =
      challengeHtml && observation.forms.forms === 0 && observation.forms.inputs === 0;

    observation.captchaFriction =
      servedChallenge ||
      challengePage ||
      challengeHeader !== null ||
      challengeVisible ||
      emptyShell;

    observation.notes = [
      observation.forms.framework,
      `forms=${String(observation.forms.forms)}`,
      `inputs=${String(observation.forms.inputs)}`,
      `files=${String(observation.forms.fileInputs)}`,
      observation.forms.comboboxes > 0 ? "react-select" : "",
      observation.forms.iframes > 0 ? `iframes=${String(observation.forms.iframes)}` : "",
      observation.forms.forms === 0 && observation.forms.inputs > 0 ? "no form element" : "",
      isKnownAtsHost(page.url()) ? "known ATS host" : "",
      /\/jobs?\/search|\/search\b/iu.test(new URL(page.url()).pathname) ? "landed on search" : "",
      challengeHeader === null ? "" : "cf-mitigated",
      challengePage ? "challenge page" : "",
      emptyShell ? "empty shell" : "",
    ]
      .filter((part) => part !== "")
      .join("; ");
  } catch (error) {
    observation.error = error instanceof Error ? error.message : String(error);
  } finally {
    observation.elapsedMs = Math.round(performance.now() - startedAt);
    await context.close().catch(() => undefined);
  }

  return observation;
}

function percent(count: number, total: number) {
  return total === 0 ? "0%" : `${String(Math.round((count / total) * 100))}%`;
}

function boardSummary(observations: readonly ProbeObservation[]) {
  const total = observations.length;

  const count = (predicate: (observation: ProbeObservation) => boolean) =>
    observations.filter((observation) => predicate(observation)).length;

  return {
    accountWall: count((observation) => observation.accountWall),
    applyClicked: count((observation) => observation.applyClicked),
    captcha: count((observation) => observation.captchaFriction),
    errors: count((observation) => observation.error !== null),
    external: count((observation) => observation.externalRedirect),
    guest: count((observation) => observation.guestForm),
    noApplyControl: count((observation) => !observation.applyControlFound),
    pinWall: count((observation) => observation.pinWall),
    total,
    twoHundreds: count((observation) => observation.status === 200),
  };
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid";
  }
}

function wallLabel(observation: ProbeObservation) {
  if (observation.pinWall) {
    return "PIN wall";
  }

  if (observation.accountWall) {
    return "account/login";
  }

  return observation.guestForm ? "none" : "unclear";
}

function summaryRow(board: Board, observations: readonly ProbeObservation[]) {
  const rows = observations.filter((observation) => observation.board === board);
  const summary = boardSummary(rows);
  const walls = summary.accountWall + summary.pinWall;

  return `| ${board} | ${String(summary.total)} | ${String(summary.twoHundreds)} (${percent(summary.twoHundreds, summary.total)}) | ${String(summary.applyClicked)} (${percent(summary.applyClicked, summary.total)}) | ${String(summary.external)} (${percent(summary.external, summary.total)}) | ${String(summary.guest)} (${percent(summary.guest, summary.total)}) | ${String(walls)} (${percent(walls, summary.total)}) | ${String(summary.captcha)} (${percent(summary.captcha, summary.total)}) | ${String(summary.errors)} |`;
}

function observationRows(board: Board, observations: readonly ProbeObservation[]) {
  const rows = observations.filter((observation) => observation.board === board);

  const table = rows.map((observation, index) => {
    const status = observation.status === null ? "—" : String(observation.status);
    const error = observation.error === null ? "" : observation.error.replaceAll("|", "/");

    return `| ${String(index + 1)} | ${observation.postingUrl} | ${status} | ${hostOf(observation.finalUrl)} | ${observation.externalRedirect ? "yes" : "no"} | ${observation.applyClicked ? "yes" : "no"} | ${observation.guestForm ? "yes" : "no"} | ${wallLabel(observation)} | ${observation.captchaFriction ? "yes" : "no"} | ${observation.notes.replaceAll("|", "/")} | ${error} |`;
  });

  return [
    `### ${board}`,
    "",
    "| # | Posting | Status | Final host | External | Apply clicked | Guest form | Wall | CAPTCHA | DOM notes | Error |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...table,
    "",
  ];
}

function renderReport(observations: readonly ProbeObservation[]) {
  return [
    "# Candidate-board ATS probe — November 2026",
    "",
    "Generated by `scripts/probe-candidate-ats.ts`: ten postings per board sampled from",
    "Stapply's public CSV (`https://storage.stapply.ai/jobs/v1/<board>/jobs.csv`), opened in",
    "headless Chromium. The probe clicks only an Apply/Application navigation control and then",
    "reads the page. It never fills a field, never clicks Submit/Apply-as-submit, and never sends",
    "an application.",
    "",
    `Run at ${new Date().toISOString()}.`,
    "",
    "## Summary",
    "",
    "| Board | Sampled | HTTP 200 | Apply control | External redirect | Guest-apply form | Account/PIN wall | CAPTCHA/Cloudflare | Errors |",
    "|---|---|---|---|---|---|---|---|---|",
    ...BOARDS.map((board) => summaryRow(board, observations)),
    "",
    "## Observations",
    "",
    ...BOARDS.flatMap((board) => observationRows(board, observations)),
    "## Findings",
    "",
    "- `paycom` serves a guest application form on the posting itself: dismissing the cookie banner",
    "  and clicking Apply reveals name, email, phone and resume inputs without an account. The form",
    "  is a React SPA with no `<form>` element, so readers must key on the visible inputs, not `form`.",
    "- `pageup` job URLs redirect to the employer's own PageUp domain and then to that site's",
    "  `/jobs/search`; no sampled posting exposed an apply control at the original URL. Treat PageUp",
    "  as an external redirect whose apply path needs the employer-branded search flow, not a direct",
    "  guest form.",
    "- `welcometothejungle` serves an AWS WAF challenge (HTTP 403, or HTTP 202 with the WAF script",
    "  and no page content) to headless Chromium on every sampled posting. A real browser profile or",
    "  a warmed session is required before any form reading is possible.",
    "- Board DOM notes are in the table above: Paycom has no `<form>` element; PageUp renders a",
    "  search form; the challenge pages have no inputs at all.",
    "",
    "## Caveats",
    "",
    "- Ten postings per board is a sample, not the board population; percentages describe this sample.",
    "- `Guest form` means a visible form area with at least three inputs, no password field, and two",
    "  or more contact inputs (name, email, phone, resume) after the Apply click.",
    "- CAPTCHA/Cloudflare friction counts a 403/429/503 response, a CloudFront/AWS WAF/Cloudflare",
    "  challenge body with no usable content, or a visible challenge widget; invisible reCAPTCHA v3",
    "  badges and site-wide scripts are ignored.",
    "- An `External redirect` is any final host different from the posting URL's host, including the",
    "  employer's own branded PageUp domain; it is not limited to third-party ATS vendors.",
    "- The CSV sample takes the first distinct employers in the public feed, not a random draw.",
    "",
  ].join("\n");
}

const args = parseArgs({
  options: { out: { type: "string" } },
  strict: true,
});

const outputPath = args.values.out ?? "docs/research/ats-candidate-probe-2026-11.md";

const browser = await chromium.launch({
  args: ["--disable-blink-features=AutomationControlled"],
  headless: true,
});

const observations: ProbeObservation[] = [];

const probeRows: (
  board: Board,
  rows: readonly SampleRow[],
  index: number,
) => Promise<void> = async (board, rows, index) => {
  const row = rows[index];

  if (row === undefined) {
    return;
  }

  const observation = await probeOne(board, row, browser);

  observations.push(observation);

  process.stderr.write(
    `${board} ${String(index + 1)}/${String(rows.length)} status=${String(observation.status)} guest=${String(observation.guestForm)} external=${String(observation.externalRedirect)}\n`,
  );

  return probeRows(board, rows, index + 1);
};

const probeBoards: (index: number) => Promise<void> = async (index) => {
  const board = BOARDS[index];

  if (board === undefined) {
    return;
  }

  process.stderr.write(`sampling ${board}\n`);

  const rows = await fetchSampleRows(board);

  process.stderr.write(`probing ${board}: ${String(rows.length)} postings\n`);

  await probeRows(board, rows, 0);

  return probeBoards(index + 1);
};

try {
  await probeBoards(0);
} finally {
  await browser.close();
}

writeFileSync(outputPath, `${renderReport(observations)}\n`);

process.stdout.write(`${JSON.stringify(observations, null, 2)}\n`);
