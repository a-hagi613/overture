import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PassThrough } from "node:stream";

import { expect, test } from "@playwright/test";

import { createClock } from "../../src/server/platform/ports/clock.ts";
import { runProbe } from "../../src/server/probe/run-probe.ts";
import type { ProbeDeps } from "../../src/server/probe/run-probe.ts";
import type { RunFilePosting } from "../../src/server/probe/run-file.ts";
import { runFileSchema } from "../../src/server/probe/run-file.ts";
import { openProbeDatabase, readProbeForms } from "../../src/server/probe/store.ts";
import type { ProbeHarness } from "./probe-harness.fixture.ts";
import { resumeBytes, startProbeHarness } from "./probe-harness.fixture.ts";

const parsedTemplate = runFileSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), "test/e2e/fixtures/probe-run.fixture.json"), "utf8")),
);

const runFileTemplate = structuredClone(parsedTemplate);

const CODE = "48211357";

async function withHarness(work: (harness: ProbeHarness) => Promise<void>) {
  const harness = await startProbeHarness();

  try {
    await work(harness);
  } finally {
    harness.close();
  }
}

function command(harness: ProbeHarness, confirm: boolean, overrides: Partial<ProbeDeps>) {
  const deps = {
    runFile: { ...runFileTemplate, resumePath: harness.resumePath },
    confirm,
    apiKey: "local-test-key",
    apiBaseUrl: "https://api.browser-use.com",
    databasePath: harness.databasePath,
    flyAppName: "overture-web",
    flyMachineId: "test-machine",
    postingUrlOrigin: harness.fixture.url,
    clock: createClock(),
    console: harness.console,
  };

  return { ...deps, ...overrides };
}

function posting(board: string, jobId: string) {
  const found = runFileTemplate.postings.find(
    (candidate) => candidate.board === board && candidate.jobId === jobId,
  );

  if (found === undefined) {
    throw new Error(`no template posting for ${board} ${jobId}`);
  }

  return found;
}

const singlePostingRunFile = (harness: ProbeHarness, record: RunFilePosting) => ({
  country: runFileTemplate.country,
  resumePath: harness.resumePath,
  postings: [record],
});

const examplePosting = (url: string) =>
  ({
    ats: "greenhouse",
    board: "exampleco",
    company: "Example Company",
    jobId: "7006005001",
    title: "Sample Feature Analyst",
    resumeFieldId: "resume",
    url,
    questions: [
      { id: "first_name", value: "Jane", approved: true },
      { id: "last_name", value: "Doe", approved: true },
      { id: "email", value: "jane.doe@example.com", approved: true },
      { id: "phone", value: "+1 555 0100", approved: true },
    ],
  }) satisfies RunFilePosting;

function outputProperties(stream: PassThrough) {
  let received = "";

  stream.on("data", (chunk: Buffer) => {
    received += String(chunk);
  });

  return {
    text: () => received,
    waitFor: async (needle: string) => {
      const found = await new Promise<string>((resolve) => {
        const onOutput = (chunk: Buffer) => {
          received += String(chunk);

          if (received.includes(needle)) {
            resolve(received);
          }
        };

        stream.on("data", onOutput);
      });

      return found;
    },
  };
}

function storedForms(harness: ProbeHarness) {
  const database = openProbeDatabase(harness.databasePath);

  return readProbeForms(database.db);
}

for (const record of runFileTemplate.postings) {
  test(`a dry run without --confirm fills the recorded ${record.board} ${record.jobId} form and stops before submit`, async () => {
    await withHarness(async (harness) => {
      const results = await runProbe(
        command(harness, false, { runFile: singlePostingRunFile(harness, record) }),
      );

      expect(results.length).toBe(1);

      const [result] = results;

      if (result === undefined) {
        throw new Error(`no result for ${record.board} ${record.jobId}`);
      }

      expect(result.outcome).toBe("dry_run_filled");
      expect(result.submitted).toBe(false);
      expect(result.codeAsked).toBe(false);
      expect(result.confirmationSeen).toBe(false);

      expect(harness.fixture.state.submissions).toBe(0);
      expect(harness.browserUse.sessionCount).toBe(1);
      expect(harness.browserUse.stoppedSessionIds.length).toBe(1);
    });
  });
}

test("a dry run over the five recorded postings prints one run summary line per posting and stops every session", async () => {
  await withHarness(async (harness) => {
    const output = outputProperties(harness.output);

    const unreachable = runFileTemplate.postings.map((record) => ({
      ...record,
      url: `http://127.0.0.1:9/${record.board}/jobs/${record.jobId}`,
    }));

    const results = await runProbe(
      command(harness, false, {
        runFile: { ...runFileTemplate, resumePath: harness.resumePath, postings: unreachable },
      }),
    );

    expect(results.length).toBe(runFileTemplate.postings.length);

    for (const result of results) {
      expect(result.submitted).toBe(false);
    }

    expect(harness.fixture.state.submissions).toBe(0);
    expect(harness.browserUse.sessionCount).toBe(5);
    expect(harness.browserUse.stoppedSessionIds.length).toBe(5);
    expect(storedForms(harness).length).toBe(5);

    const summary = output.text();

    expect(summary).toContain("early cloud probe summary");

    for (const record of runFileTemplate.postings) {
      expect(summary).toContain(`${record.company} — ${record.title}:`);
    }

    expect(summary).toContain(
      "dry run: 0 of 5 forms were filled and the run stopped before submit; nothing was sent",
    );

    for (const record of runFileTemplate.postings) {
      expect(summary).toContain(
        `not filled: ${record.company} — ${record.title} (board ${record.board}, job ${record.jobId}): error:`,
      );
    }
  });
});

test("a dry run where one posting is unreachable prints the filled count, the total and that posting's board and job id", async () => {
  await withHarness(async (harness) => {
    const output = outputProperties(harness.output);

    const unreachable = {
      ...posting("curaleaf", "8936939002"),
      url: "http://127.0.0.1:9/curaleaf/jobs/8936939002",
    };

    const results = await runProbe(
      command(harness, false, {
        runFile: {
          country: runFileTemplate.country,
          resumePath: harness.resumePath,
          postings: [posting("blankstreet", "8004209003"), unreachable],
        },
      }),
    );

    const [filled, failed] = results;

    if (filled === undefined || failed === undefined) {
      throw new Error("the probe produced no result for either posting");
    }

    expect(filled.outcome).toBe("dry_run_filled");
    expect(failed.outcome.startsWith("error:")).toBe(true);

    expect(harness.browserUse.sessionCount).toBe(2);
    expect(harness.browserUse.stoppedSessionIds).toHaveLength(2);
    expect(harness.fixture.state.submissions).toBe(0);

    const summary = output.text();

    expect(summary).toContain(
      "dry run: 1 of 2 forms were filled and the run stopped before submit; nothing was sent",
    );
    expect(summary).toContain(
      "not filled: Curaleaf — Cultivation Associate (board curaleaf, job 8936939002): error:",
    );
  });
});

test("an answer that is not marked approved refuses the run before any session starts", async () => {
  await withHarness(async (harness) => {
    const record = structuredClone(posting("blankstreet", "8004209003"));
    const [firstQuestion] = record.questions;

    if (firstQuestion === undefined) {
      throw new Error("the template posting has no questions");
    }

    firstQuestion.approved = false;

    let refusal = null;

    try {
      await runProbe(command(harness, true, { runFile: singlePostingRunFile(harness, record) }));
    } catch (error) {
      refusal = error instanceof Error ? error.message : "";
    }

    expect(refusal).toContain("not marked approved");
    expect(harness.browserUse.sessionCount).toBe(0);
    expect(harness.browserUse.stoppedSessionIds.length).toBe(0);
    expect(harness.fixture.state.submissions).toBe(0);
    expect(storedForms(harness)).toEqual([]);
  });
});

test("a failed posting still stops its session through the API", async () => {
  await withHarness(async (harness) => {
    const record = {
      ...posting("blankstreet", "8004209003"),
      url: "http://127.0.0.1:9/blankstreet/jobs/8004209003",
    };

    const results = await runProbe(
      command(harness, true, { runFile: singlePostingRunFile(harness, record) }),
    );

    const [failed] = results;

    if (failed === undefined) {
      throw new Error("no result for the failed posting");
    }

    expect(failed.outcome.startsWith("error:")).toBe(true);
    expect(failed.submitted).toBe(false);
    expect(harness.browserUse.sessionCount).toBe(1);
    expect(harness.browserUse.stoppedSessionIds.length).toBe(1);
    expect(harness.fixture.state.submissions).toBe(0);
  });
});

test("per-form metrics land in probe_forms after the session is stopped", async () => {
  await withHarness(async (harness) => {
    const output = outputProperties(harness.output);

    await runProbe(
      command(harness, false, {
        runFile: singlePostingRunFile(harness, posting("blankstreet", "8004209003")),
      }),
    );

    const [form] = storedForms(harness);

    if (form === undefined) {
      throw new Error("no stored form");
    }

    expect(form.proxyMb).toBeCloseTo(2.71, 3);
    expect(form.costUsd).toBeCloseTo(0.0288, 4);
    expect(form.browserMinutes).toBeCloseTo(556 / 60, 2);

    expect(form.submitted).toBe(0);
    expect(form.codeAsked).toBe(0);
    expect(form.sessionId).toBe(harness.browserUse.createdSessions[0]?.id ?? null);
    expect(form.postingUrl).toBe("https://job-boards.greenhouse.io/blankstreet/jobs/8004209003");
    await expect
      .poll(() => harness.fixture.state.lastResumeBytes, { timeout: 5000 })
      .toEqual(resumeBytes);

    const summary = output.text();

    expect(summary).toContain("2.71 MB");
    expect(summary).toContain("dry run");
  });
});

test("proxy usage that settles only on a later read after the stop is still recorded in full", async () => {
  await withHarness(async (harness) => {
    harness.browserUse.readsBeforeFinalUsage = 2;

    const results = await runProbe(
      command(harness, false, {
        runFile: singlePostingRunFile(harness, posting("blankstreet", "8004209003")),
      }),
    );

    const [result] = results;

    if (result === undefined) {
      throw new Error("no result for the late usage posting");
    }

    const [form] = storedForms(harness);

    if (form === undefined) {
      throw new Error("no stored form");
    }

    expect(form.proxyMb).toBeCloseTo(2.71, 3);
    expect(form.costUsd).toBeCloseTo(0.0288, 4);
    expect(form.browserMinutes).toBeCloseTo(556 / 60, 2);
    expect(result.proxyMb).toBeCloseTo(2.71, 3);
  });
});

test("the probe refuses to run off Fly", async () => {
  await withHarness(async (harness) => {
    let refusal = null;

    try {
      await runProbe(command(harness, false, { flyAppName: undefined, flyMachineId: undefined }));
    } catch (error) {
      refusal = error instanceof Error ? error.message : "";
    }

    expect(refusal).toContain("runs only on Fly");
    expect(harness.browserUse.sessionCount).toBe(0);
    expect(storedForms(harness)).toEqual([]);
  });
});

test("the code path prompts on the console, records the 428 and the confirmation, and the gate line compares cost", async () => {
  await withHarness(async (harness) => {
    const output = outputProperties(harness.output);
    const record = posting("blankstreet", "8004209003");
    harness.fixture.state.codePrompt = true;

    const runPromise = runProbe(
      command(harness, true, {
        runFile: {
          country: runFileTemplate.country,
          resumePath: harness.resumePath,
          postings: [{ ...record, url: `${harness.fixture.url}/blankstreet/jobs/8004209003` }],
        },
      }),
    );

    const prompted = await output.waitFor("type it here");

    expect(prompted).toContain("Greenhouse asked for an emailed verification code");

    harness.input.write(`${CODE}\n`);

    const results = await runPromise;
    const [result] = results;
    const [form] = storedForms(harness);

    if (result === undefined || form === undefined) {
      throw new Error("the probe produced no result or no stored form");
    }

    expect(result.outcome).toBe("sent");
    expect(result.codeAsked).toBe(true);
    expect(result.confirmationSeen).toBe(true);
    expect(harness.fixture.state.submissions).toBe(2);
    expect(form.submitted).toBe(1);
    expect(form.confirmationSeen).toBe(1);
    expect(form.codeAsked).toBe(1);
    expect(form.confirmMode).toBe(1);
    expect(form.submitResponseStatus).toBeLessThan(400);

    const summary = output.text();

    expect(summary).toContain("projected cost per completed application");
    expect(summary).toContain("(1 completed of 1 submitted)");
    expect(summary).toContain("$0.03");
  });
});

test("a combobox that lists nothing until typed takes the region that matches the wanted value", async () => {
  await withHarness(async (harness) => {
    const results = await runProbe(
      command(harness, false, {
        runFile: singlePostingRunFile(harness, posting("curaleaf", "8936939002")),
      }),
    );

    const [result] = results;

    if (result === undefined) {
      throw new Error("no result for the autocomplete posting");
    }

    expect(result.outcome).toBe("dry_run_filled");
    expect(result.submitted).toBe(false);
    expect(harness.fixture.state.lastChoices["candidate-location"]).toBe("Ottawa, ON, Canada");

    const [form] = storedForms(harness);

    if (form === undefined) {
      throw new Error("no stored form");
    }

    expect(form.outcome).toBe("dry_run_filled");
    expect(harness.browserUse.stoppedSessionIds).toHaveLength(1);
  });
});

test("a country combobox takes the option that extends the typed query when no city matches", async () => {
  await withHarness(async (harness) => {
    const results = await runProbe(
      command(harness, false, {
        runFile: singlePostingRunFile(harness, posting("sunnyside", "8891671002")),
      }),
    );

    const [result] = results;

    if (result === undefined) {
      throw new Error("no result for the phone country posting");
    }

    expect(result.outcome).toBe("dry_run_filled");
    expect(result.submitted).toBe(false);
    expect(harness.fixture.state.lastChoices["country"]).toBe("Canada +1");

    const [form] = storedForms(harness);

    if (form === undefined) {
      throw new Error("no stored form");
    }

    expect(form.outcome).toBe("dry_run_filled");
    expect(harness.browserUse.stoppedSessionIds).toHaveLength(1);
  });
});

test("a posting the run file cannot fill is recorded as fill_failed and the run keeps going", async () => {
  await withHarness(async (harness) => {
    const failing = structuredClone(posting("blankstreet", "8004209003"));
    const countryQuestion = failing.questions.find((question) => question.id === "country");

    if (countryQuestion === undefined) {
      throw new Error("the template posting has no country question");
    }

    countryQuestion.value = "Atlantis";

    const results = await runProbe(
      command(harness, false, {
        runFile: {
          country: runFileTemplate.country,
          resumePath: harness.resumePath,
          postings: [failing, structuredClone(posting("blankstreet", "8004209003"))],
        },
      }),
    );

    expect(results.map((result) => result.outcome)).toEqual([
      "fill_failed: country",
      "dry_run_filled",
    ]);

    const [failed, filled] = storedForms(harness);

    if (failed === undefined || filled === undefined) {
      throw new Error("not every posting landed in probe_forms");
    }

    expect(failed.outcome).toBe("fill_failed: country");
    expect(failed.submitted).toBe(0);
    expect(filled.outcome).toBe("dry_run_filled");
    expect(harness.browserUse.sessionCount).toBe(2);
    expect(harness.browserUse.stoppedSessionIds).toHaveLength(2);
    expect(harness.fixture.state.submissions).toBe(0);
  });
});

test("a 201 whose page navigates to the hosted confirmation URL records sent with the confirmation seen", async () => {
  await withHarness(async (harness) => {
    const results = await runProbe(
      command(harness, true, {
        runFile: {
          country: runFileTemplate.country,
          resumePath: harness.resumePath,
          postings: [examplePosting(`${harness.fixture.url}/exampleco/jobs/7006005001`)],
        },
      }),
    );

    const [result] = results;

    if (result === undefined) {
      throw new Error("no result for the hosted confirmation posting");
    }

    expect(result.outcome).toBe("sent");
    expect(result.submitted).toBe(true);
    expect(result.confirmationSeen).toBe(true);
    expect(harness.fixture.state.submissions).toBe(1);

    const [form] = storedForms(harness);

    if (form === undefined) {
      throw new Error("no stored form");
    }

    expect(form.submitResponseStatus).toBe(201);
    expect(form.submitted).toBe(1);
    expect(form.confirmationSeen).toBe(1);
  });
});

test("a 201 whose page shows no confirmation records sent with no confirmation seen and still counts as completed", async () => {
  await withHarness(async (harness) => {
    const output = outputProperties(harness.output);

    const results = await runProbe(
      command(harness, true, {
        runFile: {
          country: runFileTemplate.country,
          resumePath: harness.resumePath,
          postings: [
            examplePosting(`${harness.fixture.url}/exampleco/jobs/7006005001?confirmation=none`),
          ],
        },
      }),
    );

    const [result] = results;

    if (result === undefined) {
      throw new Error("no result for the silent 201 posting");
    }

    expect(result.outcome).toBe("sent");
    expect(result.submitted).toBe(true);
    expect(result.confirmationSeen).toBe(false);

    const [form] = storedForms(harness);

    if (form === undefined) {
      throw new Error("no stored form");
    }

    expect(form.submitResponseStatus).toBe(201);
    expect(form.confirmationSeen).toBe(0);

    const summary = output.text();

    expect(summary).toContain("projected cost per completed application");
    expect(summary).toContain("(1 completed of 1 submitted)");
  });
});

test("a submit whose POST is answered instantly and navigates away still captures the 201", async () => {
  await withHarness(async (harness) => {
    const results = await runProbe(
      command(harness, true, {
        runFile: {
          country: runFileTemplate.country,
          resumePath: harness.resumePath,
          postings: [examplePosting(`${harness.fixture.url}/exampleco/jobs/7006005001?native=1`)],
        },
      }),
    );

    const [result] = results;

    if (result === undefined) {
      throw new Error("no result for the native submit posting");
    }

    expect(result.outcome).toBe("sent");
    expect(result.confirmationSeen).toBe(false);

    const [form] = storedForms(harness);

    if (form === undefined) {
      throw new Error("no stored form");
    }

    expect(form.submitResponseStatus).toBe(201);
    expect(harness.fixture.state.submissions).toBe(1);
  });
});

const workableQuestions = [
  { approved: true, id: "firstname", value: "Jane" },
  { approved: true, id: "lastname", value: "Doe" },
  { approved: true, id: "email", value: "jane.doe@example.com" },
  { approved: true, id: "QA_1001", value: "No" },
  { approved: true, id: "QA_1003", value: "Yes" },
];

const workablePosting = (url: string) =>
  ({
    ats: "workable",
    board: "workable-corp",
    company: "Workable Corp",
    jobId: "WK-1001",
    questions: workableQuestions,
    resumeFieldId: "resume",
    title: "Senior Platform Engineer",
    url,
  }) satisfies RunFilePosting;

test("a Workable dry run reads the recorded form, fills it and stops before submit", async () => {
  await withHarness(async (harness) => {
    const url = `${harness.workable.url}/j/WK-1001`;

    const results = await runProbe(
      command(harness, false, {
        runFile: {
          country: runFileTemplate.country,
          postings: [workablePosting(url)],
          resumePath: harness.resumePath,
        },
      }),
    );

    const [result] = results;

    if (result === undefined) {
      throw new Error("no result for the Workable posting");
    }

    expect(result.outcome).toBe("dry_run_filled");
    expect(result.submitted).toBe(false);
    expect(result.confirmationSeen).toBe(false);
    expect(result.postingUrl).toBe(url);
    expect(harness.workable.state.submissions).toBe(0);
    expect(harness.browserUse.sessionCount).toBe(1);
    expect(harness.browserUse.stoppedSessionIds).toHaveLength(1);

    const [form] = storedForms(harness);

    expect(form?.outcome).toBe("dry_run_filled");
    expect(form?.submitted).toBe(0);
  });
});

test("a confirmed Workable probe submits the filled form and records the confirmation", async () => {
  await withHarness(async (harness) => {
    const url = `${harness.workable.url}/j/WK-1001`;

    const results = await runProbe(
      command(harness, true, {
        runFile: {
          country: runFileTemplate.country,
          postings: [workablePosting(url)],
          resumePath: harness.resumePath,
        },
      }),
    );

    const [result] = results;

    if (result === undefined) {
      throw new Error("no result for the Workable posting");
    }

    expect(result.outcome).toBe("sent");
    expect(result.submitted).toBe(true);
    expect(result.confirmationSeen).toBe(true);
    expect(harness.workable.state.submissions).toBe(1);
    expect(harness.workable.state.lastForm["firstname"]).toBe("Jane");
    expect(harness.workable.state.lastForm["QA_1001"]).toBe("No");

    const [form] = storedForms(harness);

    expect(form?.submitted).toBe(1);
    expect(form?.confirmationSeen).toBe(1);
    expect(form?.submitResponseStatus).toBe(201);
  });
});

test("a Workable probe whose page shows no confirmation records unconfirmed, never sent", async () => {
  await withHarness(async (harness) => {
    harness.workable.state.confirmation = "none";

    const results = await runProbe(
      command(harness, true, {
        runFile: {
          country: runFileTemplate.country,
          postings: [workablePosting(`${harness.workable.url}/j/WK-1001`)],
          resumePath: harness.resumePath,
        },
      }),
    );

    const [result] = results;

    if (result === undefined) {
      throw new Error("no result for the Workable posting");
    }

    expect(result.outcome).toBe("unconfirmed");
    expect(result.submitted).toBe(true);
    expect(result.confirmationSeen).toBe(false);
    expect(harness.workable.state.submissions).toBe(1);

    const [form] = storedForms(harness);

    expect(form?.confirmationSeen).toBe(0);
  });
});
