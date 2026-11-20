import { mkdir, writeFile } from "node:fs/promises";

import { z } from "zod";

const greenhouseBoards = [
  "stripe",
  "databricks",
  "figma",
  "airbnb",
  "cloudflare",
  "gitlab",
  "lyft",
  "pinterest",
  "robinhood",
  "discord",
  "brex",
  "vercel",
] as const;

const leverBoards = ["palantir", "highspot", "finix"] as const;

const ashbyBoards = ["ramp", "linear", "elevenlabs"] as const;

const postingsPerBoard = 60;
const greenhouseDetailsPerBoard = 40;
const concurrentFetches = 4;

const recordedRowSchema = z.object({
  ats: z.enum(["greenhouse", "lever", "ashby"]),
  board: z.string(),
  url: z.string(),
  title: z.string(),
  department: z.string().max(200).nullable(),
  locationRaw: z.string().max(400).nullable(),
  workplaceType: z.string().max(40).nullable(),
  isRemote: z.boolean().nullable(),
  employmentType: z.string().max(60).nullable(),
  language: z.string().min(2).max(5).nullable(),
  salary: z
    .object({
      currency: z.string().min(3).max(8).nullable(),
      minMinor: z.number().int().nonnegative().nullable(),
      maxMinor: z.number().int().nonnegative().nullable(),
      period: z.string().max(10).nullable(),
    })
    .nullable(),
  descriptionText: z.string().max(20_000),
});

type RecordedRow = z.output<typeof recordedRowSchema>;

const entityTable = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#39;", "'"],
  ["&apos;", "'"],
  ["&nbsp;", " "],
  ["&#x27;", "'"],
  ["&#x2F;", "/"],
]);

function decodeEntities(text: string) {
  return text.replaceAll(
    /&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27|#x2F);/gu,
    (entity) => entityTable.get(entity) ?? entity,
  );
}

function htmlToText(html: string) {
  return decodeEntities(
    decodeEntities(html.replaceAll(/<[^>]*>/gu, " ")).replaceAll(/<[^>]*>/gu, " "),
  )
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function optionalString(value: string | null | undefined) {
  return value === null || value === undefined || value.trim() === "" ? null : value.trim();
}

function toMinor(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) || value <= 0
    ? null
    : Math.round(value * 100);
}

function salaryOf(currency: string | null, min: number | null, max: number | null) {
  const minMinor = toMinor(min);
  const maxMinor = toMinor(max);
  const code = currency === null ? null : currency.toUpperCase();

  if (minMinor === null && maxMinor === null) {
    return null;
  }

  if (minMinor !== null && maxMinor !== null && maxMinor < minMinor) {
    return { currency: code, minMinor: maxMinor, maxMinor: minMinor, period: null };
  }

  return { currency: code, minMinor, maxMinor, period: null };
}

async function getJson(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "overture-tagging-sample/0.1" } });

  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${String(response.status)}`);
  }

  const body: unknown = await response.json();

  return body;
}

const collectBoards: (
  tokens: readonly string[],
  pull: (token: string) => Promise<RecordedRow[]>,
) => Promise<RecordedRow[]> = async (tokens, pull) => {
  const [token, ...rest] = tokens;

  if (token === undefined) {
    return [];
  }

  const rows: RecordedRow[] = await pull(token);

  const restRows: RecordedRow[] = rest.length === 0 ? [] : await collectBoards(rest, pull);

  return [...rows, ...restRows];
};

const greenhouseJobSchema = z.looseObject({
  id: z.number(),
  title: z.string(),
  absolute_url: z.string(),
  content: z.string().nullish(),
  language: z.string().nullish(),
  location: z.looseObject({ name: z.string() }).nullish(),
  departments: z.array(z.looseObject({ name: z.string() })).nullish(),
  metadata: z
    .array(
      z.looseObject({
        name: z.unknown().optional(),
        value: z.coerce.string().nullish(),
      }),
    )
    .nullish(),
});

const greenhouseDetailSchema = z.looseObject({
  content: z.string().nullish(),
  language: z.string().nullish(),
});

const greenhouseFeedSchema = z.looseObject({ jobs: z.array(greenhouseJobSchema).default([]) });

const greenhouseRowsForJobs: (
  board: string,
  jobs: z.output<typeof greenhouseJobSchema>[],
) => Promise<RecordedRow[]> = async (board, jobs) => {
  const batch = jobs.slice(0, concurrentFetches);
  const remaining = jobs.slice(concurrentFetches);

  if (batch.length === 0) {
    return [];
  }

  const rows: RecordedRow[] = await Promise.all(
    batch.map(async (job) => greenhouseRow(board, job)),
  );

  const rest: RecordedRow[] =
    remaining.length === 0 ? [] : await greenhouseRowsForJobs(board, remaining);

  return [...rows, ...rest];
};

async function greenhouseRow(board: string, job: z.output<typeof greenhouseJobSchema>) {
  const listedLanguage = optionalString(job.language);
  const department = optionalString(job.departments?.[0]?.name ?? null);

  const category = optionalString(
    job.metadata?.find((entry) => entry.name === "Career Site Categories")?.value ?? null,
  );

  const detail = greenhouseDetailSchema.parse(
    await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${String(job.id)}`),
  );

  return {
    ats: "greenhouse",
    board,
    url: job.absolute_url,
    title: job.title,
    department: department ?? category,
    locationRaw: optionalString(job.location?.name),
    workplaceType: null,
    isRemote: null,
    employmentType: null,
    language: optionalString(detail.language) ?? listedLanguage,
    salary: null,
    descriptionText: htmlToText(detail.content ?? "").slice(0, 3000),
  } satisfies RecordedRow;
}

async function pullGreenhouse() {
  return collectBoards(greenhouseBoards, async (board) => {
    const feed = greenhouseFeedSchema.parse(
      await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`),
    );

    return greenhouseRowsForJobs(board, feed.jobs.slice(0, greenhouseDetailsPerBoard));
  });
}

const leverPostingSchema = z.looseObject({
  text: z.string(),
  hostedUrl: z.string(),
  workplaceType: z.string().nullish(),
  categories: z
    .looseObject({
      team: z.string().nullish(),
      commitment: z.string().nullish(),
      location: z.string().nullish(),
      department: z.string().nullish(),
      workplaceType: z.string().nullish(),
    })
    .nullish(),
  description: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  salaryRange: z
    .looseObject({
      currency: z.string().nullish(),
      interval: z.unknown().optional(),
      min: z.number().nullish(),
      max: z.number().nullish(),
    })
    .nullish(),
});

const leverFeedSchema = z.array(leverPostingSchema);

async function pullLever() {
  return collectBoards(leverBoards, async (board) => {
    const feed = leverFeedSchema.parse(
      await getJson(`https://api.lever.co/v0/postings/${board}?mode=json`),
    );

    return feed.slice(0, postingsPerBoard).map((posting) => {
      const categories = posting.categories ?? {};
      const min = optionalNumber(posting.salaryRange?.min);
      const max = optionalNumber(posting.salaryRange?.max);

      return {
        ats: "lever",
        board,
        url: posting.hostedUrl,
        title: posting.text,
        department: optionalString(categories.department) ?? optionalString(categories.team),
        locationRaw: optionalString(categories.location),
        workplaceType:
          optionalString(posting.workplaceType) ?? optionalString(categories.workplaceType),
        isRemote: null,
        employmentType: optionalString(categories.commitment),
        language: null,
        salary: salaryOf(optionalString(posting.salaryRange?.currency ?? null), min, max),
        descriptionText:
          optionalString(posting.descriptionPlain)?.slice(0, 3000) ??
          htmlToText(posting.description ?? ""),
      } satisfies RecordedRow;
    });
  });
}

function optionalNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}

const ashbyJobSchema = z.looseObject({
  title: z.string(),
  jobUrl: z.string().nullish(),
  applyUrl: z.string().nullish(),
  department: z.string().nullish(),
  location: z.string().nullish(),
  workplaceType: z.string().nullish(),
  employmentType: z.string().nullish(),
  isRemote: z.boolean().nullish(),
  descriptionPlain: z.string().nullish(),
  compensation: z
    .looseObject({
      compensationTiers: z
        .array(
          z.looseObject({
            components: z
              .array(
                z.looseObject({
                  compensationType: z.string().nullish(),
                  currencyCode: z.string().nullish(),
                  amountMin: z.number().nullish().optional(),
                  amountMax: z.number().nullish().optional(),
                }),
              )
              .nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
});

const ashbyFeedSchema = z.looseObject({ jobs: z.array(ashbyJobSchema).default([]) });

async function pullAshby() {
  return collectBoards(ashbyBoards, async (board) => {
    const feed = ashbyFeedSchema.parse(
      await getJson(
        `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`,
      ),
    );

    return feed.jobs.slice(0, postingsPerBoard).map((job) => {
      let money: {
        currency: string | null;
        minMinor: number | null;
        maxMinor: number | null;
      } | null = null;

      for (const tier of job.compensation?.compensationTiers ?? []) {
        for (const component of tier.components ?? []) {
          if (optionalString(component.compensationType)?.toLowerCase() !== "salary") {
            continue;
          }

          const candidate = salaryOf(
            optionalString(component.currencyCode),
            optionalNumber(component.amountMin),
            optionalNumber(component.amountMax),
          );

          const spread =
            candidate === null ? -1 : (candidate.maxMinor ?? 0) - (candidate.minMinor ?? 0);

          const currentSpread = money === null ? -1 : (money.maxMinor ?? 0) - (money.minMinor ?? 0);

          if (spread >= currentSpread) {
            money = candidate;
          }
        }
      }

      return {
        ats: "ashby",
        board,
        url: optionalString(job.jobUrl) ?? optionalString(job.applyUrl) ?? "",
        title: job.title,
        department: optionalString(job.department),
        locationRaw: optionalString(job.location),
        workplaceType: optionalString(job.workplaceType),
        isRemote: job.isRemote === true,
        employmentType: optionalString(job.employmentType),
        language: null,
        salary:
          money === null
            ? null
            : {
                currency: money.currency,
                minMinor: money.minMinor,
                maxMinor: money.maxMinor,
                period: null,
              },
        descriptionText: optionalString(job.descriptionPlain)?.slice(0, 3000) ?? "",
      } satisfies RecordedRow;
    });
  });
}

await mkdir("test/fixtures", { recursive: true });

const rows = [...(await pullGreenhouse()), ...(await pullLever()), ...(await pullAshby())];

for (const row of rows) {
  recordedRowSchema.parse(row);
}

await writeFile(
  "test/fixtures/tagging-sample.jsonl",
  `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
);

process.stdout.write(
  `recorded ${String(rows.length)} postings from ${String(greenhouseBoards.length + leverBoards.length + ashbyBoards.length)} boards\n`,
);
