import { readFileSync } from "node:fs";

import { z } from "zod";

import { env } from "../src/server/config/env.ts";
import { openDatabase } from "../src/server/platform/db/client.ts";
import { migrateDatabase } from "../src/server/platform/db/migrate.ts";
import {
  createAnthropicBatchProvider,
  createAnthropicLlmPort,
} from "../src/server/platform/llm/anthropic-batches.ts";
import { createDurableBatches } from "../src/server/platform/llm/durable-batches.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";
import { gatePasses, repeatDifference, wrongFieldRate } from "../src/server/matching/eval-gate.ts";
import type { LlmPort } from "../src/server/platform/ports/llm.ts";
import { topPicksByEmployer } from "../src/server/matching/match-sort.ts";
import { scoreRequestFor } from "../src/server/matching/prompts/score-v1.ts";
import { parseScoreReply, scoreOf } from "../src/server/matching/score-schema.ts";

const OPT_IN_ENV = "OVERTURE_MATCH_EVAL";

const fixtureSchema = z.object({
  jobs: z.array(
    z.object({
      category: z.string().nullable().default(null),
      company: z.string(),
      description: z.string(),
      expectedWrongField: z.boolean().default(false),
      id: z.string(),
      location: z.string().default("unknown"),
      postedAt: z.number().int().nullable().default(null),
      title: z.string(),
    }),
  ),
  repeats: z.number().int().min(2).max(10).default(2),
  resume: z.string(),
  targets: z.string(),
});

type Fixture = z.infer<typeof fixtureSchema>;

type FixtureJob = Fixture["jobs"][number];

function write(text: string) {
  process.stdout.write(`${text}\n`);
}

function argumentValue(name: string) {
  const index = process.argv.indexOf(name);

  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function portFor(model: string) {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const clock = createClock();

  const batches = createDurableBatches({
    clock,
    db,
    maxWaitMs: env.ANTHROPIC_BATCH_WAIT_MS,
    model,
    pollIntervalMs: env.ANTHROPIC_BATCH_POLL_INTERVAL_MS,
    provider: createAnthropicBatchProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      baseUrl: env.ANTHROPIC_BASE_URL,
      model,
    }),
  });

  return createAnthropicLlmPort(
    { apiKey: env.ANTHROPIC_API_KEY, baseUrl: env.ANTHROPIC_BASE_URL, model },
    batches,
  );
}

async function runOnce(llm: LlmPort, fixture: Fixture, job: FixtureJob) {
  const request = scoreRequestFor({
    candidate: { resume: fixture.resume, targets: fixture.targets },
    customId: `eval-${job.id}`,
    job: {
      company: job.company,
      description: job.description,
      location: job.location,
      title: job.title,
    },
  });

  const call = await llm.runStructured({
    cachePrefix: request.cachePrefix,
    purpose: request.purpose,
    schema: request.schema,
    system: request.system,
    user: request.user,
  });

  return parseScoreReply(call.text);
}

interface RepeatResult {
  rejected: number;
  reply: ReturnType<typeof parseScoreReply>;
  scores: number[];
}

const repeatsOf: (
  llm: LlmPort,
  fixture: Fixture,
  job: FixtureJob,
  run: number,
  scores: number[],
) => Promise<RepeatResult> = async (llm, fixture, job, run, scores) => {
  if (run >= fixture.repeats) {
    return { rejected: 0, reply: null, scores };
  }

  const reply = await runOnce(llm, fixture, job);
  const next = reply === null ? scores : [...scores, scoreOf(reply)];
  const rest = await repeatsOf(llm, fixture, job, run + 1, next);

  return {
    rejected: (reply === null ? 1 : 0) + rest.rejected,
    reply: run === 0 ? reply : rest.reply,
    scores: rest.scores,
  };
};

interface Collected {
  rejected: number;
  replies: Map<string, ReturnType<typeof parseScoreReply>>;
  samples: { jobId: string; scores: number[] }[];
}

const scoreJobAt: (
  llm: LlmPort,
  fixture: Fixture,
  index: number,
  samples: { jobId: string; scores: number[] }[],
  replies: Map<string, ReturnType<typeof parseScoreReply>>,
  rejected: number,
) => Promise<Collected> = async (llm, fixture, index, samples, replies, rejected) => {
  const job = fixture.jobs[index];

  if (job === undefined) {
    return { rejected, replies, samples };
  }

  const result = await repeatsOf(llm, fixture, job, 0, []);

  return scoreJobAt(
    llm,
    fixture,
    index + 1,
    [...samples, { jobId: job.id, scores: result.scores }],
    result.reply === null ? replies : new Map(replies).set(job.id, result.reply),
    rejected + result.rejected,
  );
};

async function main() {
  if (Bun.env[OPT_IN_ENV] !== "1") {
    throw new Error(`Refusing to spend money: set ${OPT_IN_ENV}=1 and run this by hand.`);
  }

  const fixturePath = argumentValue("--fixture");

  if (fixturePath === null) {
    throw new Error("Pass --fixture <path> with the resume, targets and jobs to score.");
  }

  const fixture = fixtureSchema.parse(JSON.parse(readFileSync(fixturePath, "utf8")));
  const model = argumentValue("--model") ?? env.ANTHROPIC_MODEL;
  const llm = portFor(model);
  const scored = await scoreJobAt(llm, fixture, 0, [], new Map(), 0);
  const difference = repeatDifference(scored.samples);

  const wrongField = wrongFieldRate(
    fixture.jobs.map((job) => {
      const reply = scored.replies.get(job.id);

      return {
        expectedWrongField: job.expectedWrongField,
        visible:
          reply === null || reply === undefined
            ? false
            : reply.blockers.length === 0 && scoreOf(reply) >= 50,
      };
    }),
  );

  const candidates = fixture.jobs.flatMap((job) => {
    const reply = scored.replies.get(job.id);

    if (reply === null || reply === undefined) {
      return [];
    }

    return [
      {
        blockers: reply.blockers,
        companyKey: job.company.trim().toLowerCase(),
        exactRole: job.category !== null,
        id: job.id,
        postedAt: job.postedAt,
        score: scoreOf(reply),
      },
    ];
  });

  const top = topPicksByEmployer(candidates, 3);

  write(
    JSON.stringify(
      {
        averageDifference: Number(difference.average.toFixed(2)),
        gatePasses: gatePasses(difference, wrongField),
        jobs: fixture.jobs.length,
        maxDifference: difference.max,
        model,
        rejected: scored.rejected,
        topPicks: top.map((row) => ({ id: row.id, score: row.score })),
        wrongFieldRate: Number((wrongField * 100).toFixed(2)),
      },
      null,
      2,
    ),
  );
}

await main();
