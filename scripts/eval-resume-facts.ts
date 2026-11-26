import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";

import { env } from "../src/server/config/env.ts";
import { openDatabase } from "../src/server/platform/db/client.ts";
import { migrateDatabase } from "../src/server/platform/db/migrate.ts";
import { users } from "../src/server/platform/db/schema.ts";
import {
  createAnthropicBatchProvider,
  createAnthropicLlmPort,
} from "../src/server/platform/llm/anthropic-batches.ts";
import { createDurableBatches } from "../src/server/platform/llm/durable-batches.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";
import { setSetting } from "../src/server/platform/settings/index.ts";
import { createResumeFactsReader } from "../src/server/profile/resume-facts.ts";

const FIXTURE_ROOT = "test/e2e/fixtures/resumes";
const LIVE_FLAG = "--live";
const EVAL_USER_ID = "resume-fact-eval";
const USER_DAILY_CAP_USD = "5";
const GLOBAL_DAILY_CAP_USD = "10";

const fixtureSchema = z.object({
  identity: z.object({ email: z.string(), name: z.string() }),
  notes: z.string(),
  facts: z.record(z.string(), z.string()),
});

const localHeader = 0x04_03_4b_50;
const deflateMethod = 8;

const textRunPattern = /<w:t(?:\s[^>]*)?>(?<text>[^<]*)<\/w:t>/gu;

function decodeXmlText(value: string) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function paragraphText(paragraph: string) {
  const runs = [...paragraph.matchAll(textRunPattern)].map((match) =>
    decodeXmlText(match.groups?.text ?? ""),
  );

  return runs.join("");
}

function documentText(xml: string) {
  return xml
    .split("</w:p>")
    .map((paragraph) => paragraphText(paragraph))
    .join("\n")
    .trim();
}

function docxText(bytes: Buffer) {
  let at = 0;

  while (at + 30 <= bytes.byteLength && bytes.readUInt32LE(at) === localHeader) {
    const method = bytes.readUInt16LE(at + 8);
    const compressed = bytes.readUInt32LE(at + 18);
    const nameLength = bytes.readUInt16LE(at + 26);
    const extraLength = bytes.readUInt16LE(at + 28);
    const name = bytes.subarray(at + 30, at + 30 + nameLength).toString("utf8");
    const start = at + 30 + nameLength + extraLength;
    const data = bytes.subarray(start, start + compressed);

    if (name === "word/document.xml") {
      const xml = (method === deflateMethod ? inflateRawSync(data) : data).toString("utf8");

      return documentText(xml);
    }

    at = start + compressed;
  }

  throw new Error("the DOCX fixture carried no word/document.xml");
}

async function textFor(directory: string) {
  const pdf = join(directory, "resume.pdf");

  if (existsSync(pdf)) {
    const document = await getDocumentProxy(new Uint8Array(readFileSync(pdf)));
    const extracted = await extractText(document, { mergePages: true });

    return extracted.text;
  }

  const docx = join(directory, "resume.docx");

  if (existsSync(docx)) {
    return docxText(readFileSync(docx));
  }

  return readFileSync(join(directory, "resume.txt"), "utf8");
}

function fixtures() {
  return readdirSync(FIXTURE_ROOT)
    .toSorted()
    .map((slug) => {
      const directory = join(FIXTURE_ROOT, slug);

      return {
        directory,
        expected: fixtureSchema.parse(
          JSON.parse(readFileSync(join(directory, "expected.json"), "utf8")),
        ),
        slug,
      };
    });
}

function liveReader() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const clock = createClock();
  const now = new Date(clock.now());

  db.insert(users)
    .values({
      createdAt: now,
      email: "resume-fact-eval@example.com",
      emailVerified: true,
      id: EVAL_USER_ID,
      name: "Resume Fact Eval",
      updatedAt: now,
    })
    .run();

  setSetting(db, clock, "llm.cap_user_day_usd", USER_DAILY_CAP_USD, "resume-fact-eval");
  setSetting(db, clock, "llm.cap_global_day_usd", GLOBAL_DAILY_CAP_USD, "resume-fact-eval");

  const config = {
    apiKey: env.ANTHROPIC_API_KEY,
    baseUrl: env.ANTHROPIC_BASE_URL,
    model: env.ANTHROPIC_MODEL,
  };

  const llm = createAnthropicLlmPort(
    config,
    createDurableBatches({
      clock,
      db,
      maxWaitMs: 1000,
      model: config.model,
      pollIntervalMs: 1000,
      provider: createAnthropicBatchProvider(config),
    }),
  );

  return createResumeFactsReader({ clock, db, llm });
}

function printPlan() {
  const all = fixtures();

  process.stdout.write(
    `resume fact eval: ${String(all.length)} fixtures, ${env.ANTHROPIC_MODEL} at ${env.ANTHROPIC_BASE_URL}\n`,
  );
  process.stdout.write("this spends real money on one structured call per fixture\n");
  process.stdout.write("run again with --live to read them and print the accuracy table\n");
}

async function runLive() {
  const reader = liveReader();
  const all = fixtures();
  const expectedByField = new Map<string, number>();
  const correctByField = new Map<string, number>();
  let failures = 0;

  const reads = await Promise.all(
    all.map(async (fixture) => {
      const text = await textFor(fixture.directory);

      return { fixture, read: await reader.read(EVAL_USER_ID, fixture.expected.identity, text) };
    }),
  );

  for (const { fixture, read } of reads) {
    const actual = Object.fromEntries(read.facts.map((draft) => [draft.key, draft.value]));
    const keys = new Set([...Object.keys(fixture.expected.facts), ...Object.keys(actual)]);
    const wrong: string[] = [];

    for (const key of keys) {
      const expected = fixture.expected.facts[key] ?? null;
      const got = actual[key] ?? null;

      if (expected !== null) {
        expectedByField.set(key, (expectedByField.get(key) ?? 0) + 1);
      }

      if (expected === got) {
        if (expected !== null) {
          correctByField.set(key, (correctByField.get(key) ?? 0) + 1);
        }
      } else {
        wrong.push(`${key}: expected ${String(expected)} got ${String(got)}`);
      }
    }

    if (wrong.length > 0 || read.status !== "extracted") {
      failures += 1;
      process.stdout.write(`${fixture.slug}: ${read.status}\n`);

      for (const line of wrong) {
        process.stdout.write(`  ${line}\n`);
      }
    }
  }

  process.stdout.write("\nfield                    expected  correct\n");

  let expectedTotal = 0;
  let correctTotal = 0;

  for (const [field, expected] of [...expectedByField.entries()].toSorted((left, right) =>
    left[0].localeCompare(right[0]),
  )) {
    const correct = correctByField.get(field) ?? 0;

    expectedTotal += expected;
    correctTotal += correct;

    process.stdout.write(
      `${field.padEnd(24)} ${String(expected).padStart(8)} ${String(correct).padStart(8)}\n`,
    );
  }

  const percent = expectedTotal === 0 ? 0 : (correctTotal / expectedTotal) * 100;

  process.stdout.write(
    `\n${String(all.length - failures)}/${String(all.length)} resumes clean, ${String(correctTotal)}/${String(expectedTotal)} values correct (${percent.toFixed(1)}%)\n`,
  );

  if (failures > 0) {
    process.exitCode = 1;
  }
}

if (!process.argv.includes(LIVE_FLAG)) {
  printPlan();
} else if (env.ANTHROPIC_API_KEY === undefined) {
  process.stdout.write("ANTHROPIC_API_KEY is not set, so the eval cannot read anything\n");
  process.exitCode = 1;
} else {
  await runLive();
}
