import { mkdirSync } from "node:fs";
import { join } from "node:path";

interface GreenhouseListJob {
  id: number | string;
  title?: string;
  absolute_url?: string;
  location?: { name?: string } | null;
  updated_at?: string | null;
  first_published?: string | null;
  language?: string | null;
  content?: string | null;
  departments?: { name?: string }[] | null;
}

const FIXTURE_ROOT = "test/e2e/fixtures/greenhouse";

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${String(response.status)}`);
  }

  return (await response.json()) as unknown;
}

async function pullBoard(boardToken: string, jobsToDetail: number) {
  const listUrl = `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs`;
  const list = (await fetchJson(listUrl)) as { jobs?: GreenhouseListJob[] };
  const jobs = list.jobs ?? [];

  const trimmedJobs: GreenhouseListJob[] = [];

  for (const job of jobs.slice(0, jobsToDetail)) {
    const detailUrl = `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs/${String(job.id)}?content=true`;
    const detail = (await fetchJson(detailUrl)) as GreenhouseListJob;

    const trimmedDetail: GreenhouseListJob = {
      id: detail.id,
      title: detail.title ?? "",
      absolute_url: detail.absolute_url ?? "",
      location: detail.location ?? null,
      updated_at: detail.updated_at ?? null,
      first_published: detail.first_published ?? null,
      language: detail.language ?? null,
      content: typeof detail.content === "string" ? detail.content.slice(0, 4000) : null,
    };

    const detailPath = join(FIXTURE_ROOT, boardToken, "jobs", `${String(job.id)}.json`);

    mkdirSync(join(FIXTURE_ROOT, boardToken, "jobs"), { recursive: true });

    await Bun.write(detailPath, JSON.stringify(trimmedDetail, null, 2));
    trimmedJobs.push(trimmedDetail);
  }

  const boardPath = join(FIXTURE_ROOT, boardToken, "board.json");

  await Bun.write(boardPath, JSON.stringify({ jobs: trimmedJobs }, null, 2));

  process.stdout.write(`recorded ${String(trimmedJobs.length)} jobs for board ${boardToken}\n`);
}

const boards = ["vercel", "stripe", "cloudflare"];

const jobsToDetail = 4;

for (const board of boards) {
  await pullBoard(board, jobsToDetail);
}
