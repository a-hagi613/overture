import { expect, test } from "bun:test";

import { findVerificationProblems, parseVerificationBlock } from "./check-verification.ts";

const complete = [
  "## What changed",
  "",
  "The gate now also checks the Verification block.",
  "",
  "## Verification",
  "",
  "- verify: `bun run verify` — 7/7 checks pass",
  "- e2e: `test/e2e/onboarding.test.ts` — 3 passed",
  "- code-review-and-quality: clean, 2 findings fixed",
  "- test-driven-development: clean, the failing test came first",
  "- ci-cd-and-automation: clean",
  "- security-and-hardening: clean",
  "- screenshots: none, no UI change",
  "",
  "## Notes",
  "",
  "- e2e is not run here, this prose is outside the block.",
].join("\n");

test("a complete Verification block passes", () => {
  expect(findVerificationProblems(complete)).toStrictEqual([]);
});

test("the block is parsed into key and verdict entries and stops at the next heading", () => {
  const block = parseVerificationBlock(complete);

  expect(block.found).toBe(true);
  expect(block.entries.map((entry) => entry.key)).toStrictEqual([
    "verify",
    "e2e",
    "code-review-and-quality",
    "test-driven-development",
    "ci-cd-and-automation",
    "security-and-hardening",
    "screenshots",
  ]);
  expect(block.entries[0]?.value).toBe("`bun run verify` — 7/7 checks pass");
});

test("a body without a Verification block is reported", () => {
  const problems = findVerificationProblems("## What changed\n\nNothing about verification.");

  expect(problems).toStrictEqual(["the pull request body has no Verification block"]);
});

test("an untouched template with placeholders is reported", () => {
  const body = [
    "## Verification",
    "",
    "- verify: <command and result>",
    "- e2e: <spec files and pass count>",
    "- code-review-and-quality: <verdict>",
    "- test-driven-development: <verdict>",
  ].join("\n");

  expect(findVerificationProblems(body)).toStrictEqual([
    "the `verify` line still holds the placeholder <command and result>",
    "the `e2e` line still holds the placeholder <spec files and pass count>",
    "the `code-review-and-quality` line still holds the placeholder <verdict>",
    "the `test-driven-development` line still holds the placeholder <verdict>",
  ]);
});

test("a skill line that says not run is reported whatever its case and spacing", () => {
  for (const verdict of [
    "not run",
    "Not Run",
    "NOT-RUN",
    "not run locally",
    "was not run",
    "skipped",
  ]) {
    const body = complete.replace(
      "- ci-cd-and-automation: clean",
      `- ci-cd-and-automation: ${verdict}`,
    );

    expect(findVerificationProblems(body)).toStrictEqual([
      "the `ci-cd-and-automation` line says not run",
    ]);
  }
});

test("a verdict that mentions the phrase mid-sentence is still a verdict", () => {
  const body = complete.replace(
    "- ci-cd-and-automation: clean",
    "- ci-cd-and-automation: clean — the gate now rejects a verdict that says the phrase mid-sentence",
  );

  expect(findVerificationProblems(body)).toStrictEqual([]);
});

test("a line without a verdict is reported", () => {
  const body = complete.replace("- security-and-hardening: clean", "- security-and-hardening:");

  expect(findVerificationProblems(body)).toStrictEqual([
    "the `security-and-hardening` line has no verdict",
  ]);
});

test("a block without the verify or e2e lines is reported", () => {
  const body = complete
    .replace("- verify: `bun run verify` — 7/7 checks pass\n", "")
    .replace("- e2e: `test/e2e/onboarding.test.ts` — 3 passed\n", "");

  expect(findVerificationProblems(body)).toStrictEqual([
    "the Verification block is missing the `verify` line",
    "the Verification block is missing the `e2e` line",
  ]);
});

test("a block without the two skills every ticket runs is reported", () => {
  const body = complete
    .replace("- code-review-and-quality: clean, 2 findings fixed\n", "")
    .replace("- test-driven-development: clean, the failing test came first\n", "");

  expect(findVerificationProblems(body)).toStrictEqual([
    "the Verification block is missing the `code-review-and-quality` skill line",
    "the Verification block is missing the `test-driven-development` skill line",
  ]);
});

test("a block with no entries is reported once", () => {
  expect(findVerificationProblems("## Verification\n\nNo bullets here.")).toStrictEqual([
    "the Verification block has no `- key: verdict` lines",
    "the Verification block is missing the `verify` line",
    "the Verification block is missing the `e2e` line",
    "the Verification block is missing the `code-review-and-quality` skill line",
    "the Verification block is missing the `test-driven-development` skill line",
  ]);
});

test("a bold heading, bold keys, CRLF and star bullets are accepted", () => {
  const body = [
    "**Verification**",
    "",
    "* **verify**: `bun run verify` — 7/7 checks pass",
    "* **e2e**: none, no UI change",
    "* **code-review-and-quality**: clean",
    "* **test-driven-development**: clean",
  ]
    .join("\r\n")
    .concat("\r\n");

  expect(findVerificationProblems(body)).toStrictEqual([]);
  expect(parseVerificationBlock(body).entries[0]?.key).toBe("verify");
});
