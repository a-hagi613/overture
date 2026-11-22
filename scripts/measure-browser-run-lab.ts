import { Hono } from "hono";
import { chromium } from "playwright-core";

import { LAB_CHALLENGE_PAGES, LAB_FORM_ATS } from "../src/server/lab/pages.ts";
import { drivePage, series } from "../src/server/lab/runner.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";
import { createLabRoutes } from "../src/server/routes/lab.ts";
import {
  labHcaptchaStub,
  labRecaptchaStub,
  labTurnstileStub,
} from "../src/server/testing/lab-vendor-stubs.ts";

const BROWSER_RUN_HEADERS = {
  "cf-biso-devtools": "1",
  "cf-brapi-devtools": "spike-288-simulated-request",
  signature:
    'sig1=("@authority" "cf-brapi-devtools");created=1795000000;keyid="spike-288";alg="ed25519"',
  "signature-agent": "https://web-bot-auth.cloudflare-browser-rendering-085.workers.dev",
  "signature-input":
    'sig1=("@authority" "cf-brapi-devtools");created=1795000000;keyid="spike-288";alg="ed25519"',
} as const;

const RECORDED_ACTIVE_MS = 556_000;
const BROWSER_RUN_MICROS_PER_HOUR = 90_000;

interface ProbeRow {
  key: string;
  outcome: string;
  challengeSeen: boolean;
  captchaScore: number | null;
  ms: number;
}

const clock = createClock();

const verify = Bun.serve({
  port: 0,
  async fetch(request) {
    const form = await request.formData();

    return Response.json({
      action: "lab",
      score: form.get("response") === "lab-recaptcha-token" ? 0.9 : 0.1,
      success: true,
    });
  },
});

const app = new Hono();

app.route(
  "/lab",
  createLabRoutes({
    clock,
    environment: {
      hcaptchaScriptUrl: "/__test__/lab-hcaptcha.js",
      hcaptchaSiteKey: "spike-lab-hcaptcha",
      recaptchaScriptUrl: "/__test__/lab-recaptcha.js",
      recaptchaSiteKey: "spike-lab-recaptcha",
      turnstileScriptUrl: "/__test__/lab-turnstile.js",
      turnstileSiteKey: "spike-lab-turnstile",
    },
    recaptchaSecret: "spike-288-lab-secret",
    recaptchaVerifyUrl: `${verify.url.origin}/recaptcha`,
  }),
);

app.get("/__test__/lab-recaptcha.js", (context) =>
  context.body(labRecaptchaStub, 200, { "content-type": "text/javascript; charset=utf-8" }),
);

app.get("/__test__/lab-hcaptcha.js", (context) =>
  context.body(labHcaptchaStub, 200, { "content-type": "text/javascript; charset=utf-8" }),
);

app.get("/__test__/lab-turnstile.js", (context) =>
  context.body(labTurnstileStub, 200, { "content-type": "text/javascript; charset=utf-8" }),
);

const lab = Bun.serve({ fetch: app.fetch, port: 0 });

const baseUrl = lab.url.origin;
const keys = [...LAB_FORM_ATS.map((ats) => `form:${ats}`), ...LAB_CHALLENGE_PAGES];

const browser = await chromium.launch({ headless: true });

const rows: ProbeRow[] = [];
const navigations: Record<string, string>[] = [];
const hosts = new Set<string>();

try {
  const context = await browser.newContext({ extraHTTPHeaders: BROWSER_RUN_HEADERS });
  const page = await context.newPage();

  page.on("request", (request) => {
    hosts.add(new URL(request.url()).host);

    if (request.isNavigationRequest()) {
      navigations.push(request.headers());
    }
  });

  await series(keys.length, async (index) => {
    const key = keys[index];

    if (key === undefined) {
      return;
    }

    const startedAt = clock.now();
    const driven = await drivePage(page, baseUrl, key, "pass");

    rows.push({
      captchaScore: driven.captchaScore,
      challengeSeen: driven.challengeSeen,
      key,
      ms: clock.now() - startedAt,
      outcome: driven.outcome,
    });
  });

  await series(LAB_CHALLENGE_PAGES.length, async (index) => {
    const pageName = LAB_CHALLENGE_PAGES[index];

    if (pageName === undefined) {
      return;
    }

    const startedAt = clock.now();
    const driven = await drivePage(page, baseUrl, pageName, "blocked");

    rows.push({
      captchaScore: driven.captchaScore,
      challengeSeen: driven.challengeSeen,
      key: `${pageName}:blocked`,
      ms: clock.now() - startedAt,
      outcome: driven.outcome,
    });
  });

  const identity = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    webdriver: navigator.webdriver,
  }));

  const expected = Object.entries(BROWSER_RUN_HEADERS);

  const headersOnWire = navigations.every((headers) =>
    expected.every(([name, value]) => headers[name] === value),
  );

  const labOnly = hosts.size === 1 && hosts.has(new URL(baseUrl).host);
  const headless = identity.webdriver && identity.userAgent.includes("HeadlessChrome");

  const forms = rows.filter((row) => row.key.startsWith("form:"));

  const cleared = rows.filter(
    (row) => !row.key.startsWith("form:") && !row.key.endsWith(":blocked"),
  );

  const held = rows.filter((row) => row.key.endsWith(":blocked"));

  const failed = rows.filter(
    (row) => row.outcome !== (row.key.endsWith(":blocked") ? "challenge_blocked" : "completed"),
  ).length;

  const completedIn = (group: ProbeRow[]) =>
    group.filter((row) => row.outcome === "completed").length;

  const blockedIn = (group: ProbeRow[]) =>
    group.filter((row) => row.outcome === "challenge_blocked").length;

  const attemptMicros = Math.round((RECORDED_ACTIVE_MS / 3_600_000) * BROWSER_RUN_MICROS_PER_HOUR);
  const completedMicros = Math.round(attemptMicros / 0.85);

  const lines = rows.map(
    (row) =>
      `| ${row.key} | ${row.outcome} | ${row.challengeSeen ? "yes" : "no"} | ${row.captchaScore === null ? "—" : String(row.captchaScore)} | ${String(row.ms)} |`,
  );

  process.stdout.write(
    [
      "# Browser Run request identity on the synthetic lab (issue #288)",
      "",
      `lab origin: ${baseUrl}`,
      `webdriver: ${String(identity.webdriver)}`,
      `user agent: ${identity.userAgent}`,
      `headers on every navigation: ${headersOnWire ? expected.map(([name]) => name).join(", ") : "MISSING"}`,
      `hosts seen: ${[...hosts].join(", ")}`,
      `forms completed: ${String(completedIn(forms))}/${String(forms.length)}`,
      `challenges cleared: ${String(completedIn(cleared))}/${String(cleared.length)}`,
      `challenges held: ${String(blockedIn(held))}/${String(held.length)}`,
      "",
      "| page | outcome | challenge | score | ms |",
      "| --- | --- | --- | --- | --- |",
      ...lines,
      "",
      `browser time per recorded send: ${String(attemptMicros)} µUSD ($0.09/h at ${String(RECORDED_ACTIVE_MS)} ms)`,
      `per completed application at 0.85: ${String(completedMicros)} µUSD`,
      "",
    ].join("\n"),
  );

  if (failed > 0 || !headersOnWire || !labOnly || !headless) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await lab.stop(true);
  await verify.stop(true);
}
