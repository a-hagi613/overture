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

test("a dry run without --confirm fills every question on the five recorded real forms and stops before submit", async () => {
  await withHarness(async (harness) => {
    const results = await runProbe(command(harness, false, {}));

    expect(results.map((result) => result.outcome)).toEqual([
      "dry_run_filled",
      "dry_run_filled",
      "dry_run_filled",
      "dry_run_filled",
      "dry_run_filled",
    ]);

    for (const result of results) {
      expect(result.submitted).toBe(false);
      expect(result.codeAsked).toBe(false);
      expect(result.confirmationSeen).toBe(false);
    }

    expect(harness.fixture.state.submissions).toBe(0);
    expect(harness.browserUse.sessionCount).toBe(5);
    expect(harness.browserUse.stoppedSessionIds.length).toBe(5);
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

    const runPromise = runProbe(
      command(harness, true, {
        runFile: {
          country: runFileTemplate.country,
          resumePath: harness.resumePath,
          postings: [
            { ...record, url: `${harness.fixture.url}/blankstreet/jobs/8004209003?verify=1` },
          ],
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
