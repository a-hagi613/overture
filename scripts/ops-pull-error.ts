import { desc, isNotNull } from "drizzle-orm";
import { parseArgs } from "node:util";

import { redactPullError } from "../src/server/jobs/pull-error.ts";
import { openReadOnlyDatabase } from "../src/server/platform/db/client.ts";
import { jobPullRuns } from "../src/server/platform/db/schema.ts";
import { getSetting } from "../src/server/platform/settings/index.ts";

const DIAGNOSTIC_ERROR_MAX_CHARS = 2000;
const LAST_RUNS = 10;

function write(line: string) {
  process.stdout.write(`${line}\n`);
}

const args = parseArgs({ options: { db: { type: "string" } }, strict: true });

const databasePath =
  args.values.db ?? Bun.env.DATABASE_PATH ?? Bun.env.DATABASE_URL ?? "/data/app.sqlite";

const { db, sqlite } = openReadOnlyDatabase(databasePath);

try {
  const runs = db
    .select({
      error: jobPullRuns.error,
      groupKey: jobPullRuns.groupKey,
      mode: jobPullRuns.mode,
      startedAt: jobPullRuns.startedAt,
    })
    .from(jobPullRuns)
    .where(isNotNull(jobPullRuns.error))
    .orderBy(desc(jobPullRuns.startedAt))
    .limit(LAST_RUNS)
    .all();

  process.stdout.write(
    `${JSON.stringify(
      {
        "jobs.pull_failures": getSetting(db, "jobs.pull_failures"),
        "jobs.pull_last_error": redactPullError(
          getSetting(db, "jobs.pull_last_error") ?? "",
          DIAGNOSTIC_ERROR_MAX_CHARS,
        ),
        database_path: databasePath,
        runs: runs.map((run) => ({
          error: redactPullError(run.error ?? "", DIAGNOSTIC_ERROR_MAX_CHARS),
          group_key: run.groupKey,
          mode: run.mode,
          started_at: new Date(run.startedAt).toISOString(),
        })),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  sqlite.close();
}

const probeBase = (Bun.env.FREEHIRE_BASE_URL ?? "https://freehire.me").replace(/\/+$/u, "");

const probeUrl = `${probeBase}/api/v1/jobs/search?category=backend&countries=ca&cities=Toronto&limit=5&q=Platform+Engineer&q_fields=title`;

const apiKey = Bun.env.FREEHIRE_API_KEY ?? "";

const probes: [label: string, headers: Record<string, string>][] = [
  ["default", {}],
  ["overture-ua", { "user-agent": "Overture/1.0 (+https://tryoverture.com)" }],
  [
    "chrome-ua",
    {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  ],
];

if (apiKey !== "") {
  probes.push([
    "api-key+overture-ua",
    { authorization: `Bearer ${apiKey}`, "user-agent": "Overture/1.0" },
  ]);
}

const diagnostics = sqlite
  .query(
    `select
       (select count(*) from targets t left join users u on u.id = t.user_id where u.id is null) as orphan_targets,
       (select count(*) from profiles p left join users u on u.id = p.user_id where u.id is null) as orphan_profiles,
       (select count(*) from job_pull_state s left join users u on u.id = s.user_id where u.id is null) as orphan_pull_state,
       (select count(*) from facts) as facts,
       (select count(*) from llm_usage where purpose = 'resume_facts') as resume_facts_calls,
       (select count(*) from llm_usage where purpose = 'resume_pdf') as resume_pdf_calls`,
  )
  .get();

write(JSON.stringify({ diagnostics }, null, 2));

write("freehire probe from this machine (GET, read-only)");

const probeResults = await Promise.all(
  probes.map(async ([label, headers]) => {
    try {
      const response = await fetch(probeUrl, { headers, signal: AbortSignal.timeout(20_000) });
      const body = await response.text();

      return {
        body: body.slice(0, 120),
        cf_mitigated: response.headers.get("cf-mitigated"),
        label,
        ratelimit: response.headers.get("x-ratelimit-limit"),
        status: response.status,
      };
    } catch (error) {
      return { error: String(error), label };
    }
  }),
);

for (const result of probeResults) {
  write(JSON.stringify(result));
}
