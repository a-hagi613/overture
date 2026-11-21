import { z } from "zod";

import { databasePath } from "../src/server/config/env.ts";
import {
  FIXTURE_CAPTURE_JOB_KIND,
  fixtureCapturePayloadSchema,
} from "../src/server/fixtures/job.ts";
import { openDatabase } from "../src/server/platform/db/client.ts";
import { enqueueJob } from "../src/server/platform/jobs/queue.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";

const args = process.argv.slice(2);

function argument(name: string) {
  const index = args.indexOf(`--${name}`);

  return index === -1 ? undefined : args[index + 1];
}

function argumentsFor(name: string) {
  return args.flatMap((value, index) => (value === `--${name}` ? [args[index + 1] ?? ""] : []));
}

const ats = z.enum(["greenhouse", "lever", "ashby"]).parse(argument("ats"));
const applyUrls = argumentsFor("url").filter((value) => value.length > 0);
const payload = fixtureCapturePayloadSchema.parse({ ats, applyUrls });
const { db, sqlite } = openDatabase(databasePath);
const clock = createClock();

const job = enqueueJob(db, clock, FIXTURE_CAPTURE_JOB_KIND, JSON.stringify(payload), {
  maxAttempts: 1,
});

sqlite.close();

process.stdout.write(
  `queued fixtures.capture ${job.id} for ${payload.ats}: ${payload.applyUrls.join(", ")}\n`,
);
