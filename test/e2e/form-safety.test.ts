import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { preflightForm } from "../../src/server/dispatch/forms/engine.ts";
import type { LiveFormExpectation } from "../../src/server/dispatch/forms/engine.ts";
import { runWorkableAttempt } from "../../src/server/dispatch/ats/workable.ts";
import type { WorkableRunPlan } from "../../src/server/dispatch/ats/workable.ts";

const RESUME_BYTES = new Uint8Array(
  readFileSync(join(process.cwd(), "test/e2e/fixtures/resume-board.pdf")),
);

interface ServedForm {
  url: string;
  posts: { path: string; fields: Record<string, string>; files: Record<string, string> }[];
  close: () => void;
}

function startFormPage(html: string) {
  const posts: ServedForm["posts"] = [];

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method === "POST") {
        const body = await request.text();
        const fields: Record<string, string> = {};
        const files: Record<string, string> = {};

        if ((request.headers.get("content-type") ?? "").includes("urlencoded")) {
          for (const [name, value] of new URLSearchParams(body)) {
            fields[name] = value;
          }
        } else {
          for (const part of body.split(/--[^\r\n]+/u)) {
            const name = /name="(?<name>[^"]+)"/u.exec(part)?.groups?.["name"];

            if (name === undefined) {
              continue;
            }

            const filename = /filename="(?<filename>[^"]*)"/u.exec(part)?.groups?.["filename"];

            if (filename === undefined) {
              const value = part.slice(part.indexOf("\r\n\r\n") + 4).replace(/\r\n$/u, "");

              fields[name] = value;
            } else if (filename !== "") {
              files[name] = filename;
            }
          }
        }

        posts.push({ path: url.pathname, fields, files });

        return new Response(
          "<!doctype html><html><body><h1>Thank you for applying</h1><p>Your application has been received.</p></body></html>",
          { headers: { "content-type": "text/html" } },
        );
      }

      return new Response(html, { headers: { "content-type": "text/html" } });
    },
  });

  return {
    url: server.url.toString().replace(/\/$/u, ""),
    posts,
    close: () => {
      void server.stop(true);
    },
  } satisfies ServedForm;
}

function workablePlan(url: string) {
  return {
    identity: {
      ats: "workable",
      url: `${url}/j/WK-1001`,
      boardToken: "",
      jobId: "WK-1001",
      companyName: "Example",
    },
    fields: [
      {
        answer: null,
        answerKind: "skip",
        block: null,
        factKey: null,
        factRevision: null,
        fieldName: "cover_letter",
        fieldType: "file",
        file: "cover_letter",
        label: "Cover letter",
        options: [],
        questionId: "question_cover_letter",
        required: false,
        scope: "",
        sentences: [],
        source: null,
        unit: null,
      },
    ],
    resume: { fieldName: null, filename: "resume-board.pdf", bytes: RESUME_BYTES },
  } satisfies WorkableRunPlan;
}

const silentHooks = { onResponse: () => undefined, onWillSubmit: () => undefined };

test("an approved blank text or select that arrives populated fails preflight", async ({
  page,
}) => {
  await page.setContent(`<!doctype html>
<html lang="en"><body>
  <form id="application-form">
    <label for="salary">Salary expectation</label>
    <input id="salary" name="salary" value="120000">
    <label for="notice">Notice period</label>
    <select id="notice" name="notice">
      <option value="">Select…</option>
      <option value="30" selected>30 days</option>
    </select>
    <label for="middle">Middle name</label>
    <input id="middle" name="middle" value="">
    <label for="referral">Referral</label>
    <select id="referral" name="referral">
      <option value="" selected>Select…</option>
      <option value="friend">Friend</option>
    </select>
    <button type="submit">Submit application</button>
  </form>
</body></html>`);

  const expectations: LiveFormExpectation[] = [
    {
      answer: null,
      fieldName: "salary",
      fieldType: "text",
      file: null,
      label: "Salary expectation",
      options: [],
      required: false,
    },
    {
      answer: null,
      fieldName: "notice",
      fieldType: "select",
      file: null,
      label: "Notice period",
      options: ["30 days"],
      required: false,
    },
    {
      answer: null,
      fieldName: "middle",
      fieldType: "text",
      file: null,
      label: "Middle name",
      options: [],
      required: false,
    },
    {
      answer: null,
      fieldName: "referral",
      fieldType: "select",
      file: null,
      label: "Referral",
      options: ["Friend"],
      required: false,
    },
  ];

  const verdict = await preflightForm(page, expectations, "form#application-form");

  expect(verdict.outcome).toBe("form_changed");
  expect(verdict.problems.map((problem) => `${problem.kind}:${problem.label}`).toSorted()).toEqual([
    "value_mismatch:Notice period",
    "value_mismatch:Salary expectation",
  ]);

  const blanksOnly = await preflightForm(page, expectations.slice(2), "form#application-form");

  expect(blanksOnly.outcome).toBe("ok");
});

test("Workable uploads the resume to the resume slot, never the first file input", async ({
  page,
}) => {
  const server = startFormPage(`<!doctype html>
<html lang="en"><body>
  <form id="application-form" data-ui="application-form" method="post" action="/apply" enctype="multipart/form-data">
    <div class="form-field">
      <label for="portfolio">Portfolio</label>
      <input id="portfolio" name="portfolio_file" type="file">
    </div>
    <div class="form-field">
      <label for="cover_letter">Cover letter</label>
      <input id="cover_letter" name="cover_letter" type="file">
    </div>
    <div class="form-field">
      <label for="resume">Resume</label>
      <input id="resume" name="resume_file" type="file" required>
    </div>
    <button type="submit">Submit application</button>
  </form>
</body></html>`);

  try {
    const run = await runWorkableAttempt(page, workablePlan(server.url), silentHooks);

    expect(run.outcome).toBe("sent");
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]?.files).toEqual({ resume_file: "resume-board.pdf" });
    expect(server.posts[0]?.fields).not.toHaveProperty("portfolio_file");
    expect(server.posts[0]?.fields).not.toHaveProperty("cover_letter");
  } finally {
    server.close();
  }
});

test("Workable refuses to guess between two resume-labelled file inputs", async ({ page }) => {
  const server = startFormPage(`<!doctype html>
<html lang="en"><body>
  <form id="application-form" data-ui="application-form" method="post" action="/apply" enctype="multipart/form-data">
    <div class="form-field">
      <label for="resume_a">Resume</label>
      <input id="resume_a" name="resume_a" type="file">
    </div>
    <div class="form-field">
      <label for="resume_b">Resume</label>
      <input id="resume_b" name="resume_b" type="file">
    </div>
    <button type="submit">Submit application</button>
  </form>
</body></html>`);

  try {
    const run = await runWorkableAttempt(page, workablePlan(server.url), silentHooks);

    expect(run.outcome).toBe("upload_failed");
    expect(server.posts).toHaveLength(0);
  } finally {
    server.close();
  }
});

test("a second form with hidden duplicate controls is never filled or submitted", async ({
  page,
}) => {
  const server = startFormPage(`<!doctype html>
<html lang="en"><body>
  <form id="application-form" data-ui="application-form" method="post" action="/apply" enctype="multipart/form-data">
    <div class="form-field">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required>
    </div>
    <fieldset id="consent">
      <legend>Consent</legend>
      <label><input type="checkbox" name="consent" value="email" checked> Email</label>
    </fieldset>
    <button type="submit">Submit application</button>
  </form>
  <form id="decoy" method="post" action="/decoy">
    <input type="text" name="email" value="decoy@example.com" hidden>
    <input type="checkbox" name="consent" value="sms" checked hidden>
    <button type="submit">Submit other form</button>
  </form>
</body></html>`);

  const plan: WorkableRunPlan = {
    identity: {
      ats: "workable",
      url: `${server.url}/j/WK-1001`,
      boardToken: "",
      jobId: "WK-1001",
      companyName: "Example",
    },
    fields: [
      {
        answer: "maya.okafor@example.com",
        answerKind: "fact",
        block: null,
        factKey: "email",
        factRevision: 1,
        fieldName: "email",
        fieldType: "email",
        file: null,
        label: "Email",
        options: [],
        questionId: "question_email",
        required: true,
        scope: "",
        sentences: [],
        source: null,
        unit: null,
      },
      {
        answer: "Email",
        answerKind: "fact",
        block: null,
        factKey: "consent",
        factRevision: 1,
        fieldName: "consent",
        fieldType: "multiselect",
        file: null,
        label: "Consent",
        options: ["Email"],
        questionId: "question_consent",
        required: true,
        scope: "",
        sentences: [],
        source: null,
        unit: null,
      },
    ],
    resume: null,
  };

  try {
    const run = await runWorkableAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("sent");
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]?.path).toBe("/apply");
    expect(server.posts[0]?.fields).toMatchObject({
      consent: "email",
      email: "maya.okafor@example.com",
    });
    expect(server.posts.some((post) => post.path === "/decoy")).toBe(false);
  } finally {
    server.close();
  }
});

test("a decoy form before the application form is never filled or submitted", async ({ page }) => {
  const server = startFormPage(`<!doctype html>
<html lang="en"><body>
  <form id="decoy" method="post" action="/decoy">
    <label for="decoy_email">Email</label>
    <input id="decoy_email" name="email" type="email" value="decoy@example.com">
    <label for="decoy_cover">Cover letter</label>
    <input id="decoy_cover" name="cover_letter" type="file">
    <button type="submit">Submit other form</button>
  </form>
  <form id="application-form" data-ui="application-form" method="post" action="/apply" enctype="multipart/form-data">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required>
    <button type="submit">Submit application</button>
  </form>
</body></html>`);

  const plan: WorkableRunPlan = {
    identity: {
      ats: "workable",
      url: `${server.url}/j/WK-1001`,
      boardToken: "",
      jobId: "WK-1001",
      companyName: "Example",
    },
    fields: [
      {
        answer: "maya.okafor@example.com",
        answerKind: "fact",
        block: null,
        factKey: "email",
        factRevision: 1,
        fieldName: "email",
        fieldType: "email",
        file: null,
        label: "Email",
        options: [],
        questionId: "question_email",
        required: true,
        scope: "",
        sentences: [],
        source: null,
        unit: null,
      },
    ],
    resume: null,
  };

  try {
    const run = await runWorkableAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("sent");
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]?.path).toBe("/apply");
    expect(server.posts[0]?.fields).toMatchObject({ email: "maya.okafor@example.com" });
    expect(server.posts.some((post) => post.path === "/decoy")).toBe(false);
  } finally {
    server.close();
  }
});
