import { readFileSync } from "node:fs";

const headingPattern = /^(?:#{1,6}\s+verification|\*\*verification\*\*)\s*$/iu;
const anyHeadingPattern = /^(?:#{1,6}\s|\*\*[^*]+\*\*\s*$)/iu;
const entryPattern = /^\s*[-*]\s+(?<key>[^:]+?)\s*:\s*(?<value>.*)$/u;
const placeholderPattern = /^(?:<[^>]*>|todo|tbd)$/iu;

const notRunPattern =
  /^(?:(?:it|this|the\s+\S+)\s+)?(?:(?:was|is|were|has|had|have)\s+)?(?:not[\s-]*run|never\s+run|skipped)\b/iu;

const requiredSkills = ["code-review-and-quality", "test-driven-development"] as const;

const requiredLines = ["verify", "e2e"] as const;

/** One `- key: verdict` line of a Verification block. */
export interface VerificationEntry {
  key: string;
  value: string;
}

/** A parsed Verification block: whether the body has one, and the entries it lists. */
export interface VerificationBlock {
  found: boolean;
  entries: VerificationEntry[];
}

function flagValue(name: string) {
  const position = process.argv.indexOf(name);

  if (position === -1) {
    return null;
  }

  return process.argv[position + 1] ?? null;
}

function normalizeKey(key: string) {
  return key.replaceAll("*", "").replaceAll("`", "").trim().toLowerCase();
}

/**
 * Reads the `Verification` block out of a pull request body. The block starts at a `Verification` heading (plain or
 * bold) and ends at the next heading, so prose before or after it is ignored.
 * @param body The pull request body, with either line ending.
 * @returns Whether the block exists and its `- key: verdict` entries.
 */
export function parseVerificationBlock(body: string) {
  const lines = body.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));

  if (start === -1) {
    return { found: false, entries: [] } satisfies VerificationBlock;
  }

  const entries: VerificationEntry[] = [];

  for (const line of lines.slice(start + 1)) {
    if (anyHeadingPattern.test(line.trim())) {
      break;
    }

    const match = entryPattern.exec(line);

    if (match?.groups) {
      entries.push({
        key: normalizeKey(match.groups.key ?? ""),
        value: (match.groups.value ?? "").trim(),
      });
    }
  }

  return { found: true, entries } satisfies VerificationBlock;
}

/**
 * Lists everything wrong with a pull request's Verification block, so a worker sees every fix in one pass.
 * @param body The pull request body.
 * @returns One message per problem; an empty list means the block is complete and clean.
 */
export function findVerificationProblems(body: string) {
  const block = parseVerificationBlock(body);

  if (!block.found) {
    return ["the pull request body has no Verification block"];
  }

  const problems: string[] = [];

  if (block.entries.length === 0) {
    problems.push("the Verification block has no `- key: verdict` lines");
  }

  for (const entry of block.entries) {
    if (entry.value.length === 0) {
      problems.push(`the \`${entry.key}\` line has no verdict`);
      continue;
    }

    if (placeholderPattern.test(entry.value)) {
      problems.push(`the \`${entry.key}\` line still holds the placeholder ${entry.value}`);
    }

    if (notRunPattern.test(entry.value)) {
      problems.push(`the \`${entry.key}\` line says not run`);
    }
  }

  const keys = new Set(block.entries.map((entry) => entry.key));

  for (const line of requiredLines) {
    if (!keys.has(line)) {
      problems.push(`the Verification block is missing the \`${line}\` line`);
    }
  }

  for (const skill of requiredSkills) {
    if (!keys.has(skill)) {
      problems.push(`the Verification block is missing the \`${skill}\` skill line`);
    }
  }

  return problems;
}

if (import.meta.main) {
  const bodyFile = flagValue("--body-file");
  const body = bodyFile === null ? "" : readFileSync(bodyFile, "utf8");
  const problems = findVerificationProblems(body);

  if (problems.length > 0) {
    for (const problem of problems) {
      process.stderr.write(`verification: ${problem}\n`);
    }

    process.exitCode = 1;
  } else {
    process.stdout.write("verification: ok\n");
  }
}
