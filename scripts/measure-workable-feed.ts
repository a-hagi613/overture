import { createReadStream, createWriteStream, readFileSync, statSync } from "node:fs";
import { createGzip, createGunzip } from "node:zlib";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { once } from "node:events";

import { Parser } from "htmlparser2";

import { DESCRIPTION_CAP, htmlToText } from "../src/server/catalog/html-to-text.ts";
import { resolveLocation } from "../src/server/catalog/geo.ts";
import { tagPosting } from "../src/server/catalog/tag-rules.ts";
import { committedRoleLabels } from "../src/server/catalog/taxonomy-tags.ts";
import { workableRoleMatches } from "../src/server/catalog/workable-feed.ts";
import { targetsInputSchema } from "../src/shared/targets.ts";

import type { Seniority } from "../src/shared/tag-taxonomy.ts";

const args = parseArgs({
  options: {
    feed: { type: "string" },
    out: { type: "string" },
    "as-of": { type: "string" },
    payload: { type: "string" },
    tags: { type: "string" },
    experience: { type: "boolean" },
  },
  strict: true,
});

const feedPath = args.values.feed;
const outputPath = args.values.out;
const asOfText = args.values["as-of"];
const payloadPath = args.values.payload;
const tagsPath = args.values.tags;
const experienceFallback = args.values.experience === true;

if (feedPath === undefined || outputPath === undefined || asOfText === undefined) {
  throw new Error(
    "usage: bun run scripts/measure-workable-feed.ts --feed <workable.xml[.gz]> --out <report.json> --as-of <ISO date> [--payload <matched.jsonl>] [--tags <tagged.jsonl>] [--experience]",
  );
}

const asOf = Date.parse(asOfText);

if (Number.isNaN(asOf)) {
  throw new TypeError(`--as-of is not a date: ${asOfText}`);
}

const profiles = [
  {
    name: "senior-platform-canada",
    targets: targetsInputSchema.parse({
      roles: [
        "Senior Backend Engineer",
        "Platform Engineer",
        "DevOps Engineer",
        "Infrastructure Engineer",
        "Site Reliability Engineer",
      ],
      locations: ["Toronto, ON", "Vancouver, BC", "Austin, TX"],
    }),
  },
  {
    name: "frontend-us",
    targets: targetsInputSchema.parse({
      roles: ["Frontend Engineer", "Full-stack Engineer", "Software Engineer"],
      locations: ["New York, NY", "San Francisco, CA", "Seattle, WA", "United States"],
    }),
  },
  {
    name: "data-ml-europe",
    targets: targetsInputSchema.parse({
      roles: ["Data Scientist", "Data Engineer", "Machine Learning Engineer"],
      locations: ["United Kingdom", "Germany", "Netherlands", "Ireland"],
    }),
  },
  {
    name: "beta-envelope",
    targets: targetsInputSchema.parse({
      roles: [
        "Software Engineer",
        "Frontend",
        "Backend",
        "Full-stack",
        "Mobile",
        "Platform",
        "Embedded",
        "Data",
        "Machine Learning",
        "Product Manager",
        "Designer",
        "DevOps",
        "Security",
        "QA",
      ],
      locations: ["United States", "Canada", "United Kingdom", "Germany", "Netherlands", "Ireland"],
    }),
  },
];

const languages = new Set(["en"]);

const experienceSeniority = new Map<string, Seniority>([
  ["internship", "intern"],
  ["entry level", "entry"],
  ["associate", "entry"],
  ["mid-senior level", "mid"],
  ["director", "director"],
  ["executive", "director"],
]);

function locationMatches(place: string, tags: ReturnType<typeof tagPosting>, locationRaw: string) {
  const resolved = resolveLocation(place);

  if (resolved.countryCode === null) {
    return locationRaw.toLowerCase().includes(place.toLowerCase());
  }

  if (tags.countryCode !== resolved.countryCode) {
    return false;
  }

  if (resolved.city !== null) {
    return tags.city !== null && tags.city.toLowerCase() === resolved.city.toLowerCase();
  }

  if (resolved.region !== null) {
    return tags.region !== null && tags.region.toLowerCase() === resolved.region.toLowerCase();
  }

  return true;
}

type Profile = (typeof profiles)[number];

function targetConditions(
  job: { title: string; department: string | null },
  tags: ReturnType<typeof tagPosting>,
  locationRaw: string,
  profile: Profile,
) {
  const { targets } = profile;

  return {
    language: tags.language !== null && languages.has(tags.language),
    role: workableRoleMatches({ ...job, tags }, targets.roles, committedRoleLabels()),
    location: targets.locations.some((place) => locationMatches(place, tags, locationRaw)),
  };
}

const graph = createReadStream(feedPath);
const source = feedPath.endsWith(".gz") ? graph.pipe(createGunzip()) : graph;
const payload = payloadPath === undefined ? null : createWriteStream(payloadPath);
const taggedOut = tagsPath === undefined ? null : createWriteStream(tagsPath);
const decoder = new TextDecoder("utf-8");
const loop = monitorEventLoopDelay({ resolution: 10 });

const roleCounts = new Map<string, number>();
const seniorityCounts = new Map<string, number>();
const workplaceCounts = new Map<string, number>();
const employmentCounts = new Map<string, number>();
const countryCounts = new Map<string, number>();
const dateAges: number[] = [];
const profileMatches = profiles.map(() => 0);
const profileFunnels = profiles.map(() => new Map<string, number>());
const referenceNumbers = new Set<string>();
const fieldCoverage = new Map<string, number>();

let jobs = 0;
let skipped = 0;
let duplicates = 0;
let invalidDates = 0;
let payloadBytes = 0;
let taggedBytes = 0;
let uncompressedBytes = 0;
let peakRss = 0;
let unionMatches = 0;
let inJob = false;
let currentTag: string | null = null;
let currentText = "";
let job: Record<string, string> = {};
const pendingLines: string[] = [];
const taggedLines: string[] = [];

function bump(map: Map<string, number>, key: string | null = null) {
  map.set(key ?? "unclassified", (map.get(key ?? "unclassified") ?? 0) + 1);
}

function toLine(values: Record<string, string | number | null>) {
  return `${JSON.stringify(values)}\n`;
}

async function writeChunk(
  stream: ReturnType<typeof createWriteStream> | null,
  lines: readonly string[],
) {
  if (stream === null || lines.length === 0) {
    return 0;
  }

  const chunk = lines.join("");
  const bytes = Buffer.byteLength(chunk);

  if (!stream.write(chunk)) {
    await once(stream, "drain");
  }

  return bytes;
}

function handleJob(fields: Record<string, string>) {
  const reference = fields.referencenumber?.trim() ?? "";
  const title = fields.title?.trim() ?? "";

  if (reference === "" || title === "") {
    skipped += 1;

    return;
  }

  if (referenceNumbers.has(reference)) {
    duplicates += 1;

    return;
  }

  referenceNumbers.add(reference);
  jobs += 1;

  const city = fields.city?.trim() ?? "";
  const state = fields.state?.trim() ?? "";
  const country = fields.country?.trim() ?? "";

  const locationRaw = [city, state, country].filter((part) => part !== "").join(", ") || null;

  const remoteText = fields.remote?.trim().toLowerCase() ?? "";
  const description = fields.description ?? "";
  const descriptionText = htmlToText(description, DESCRIPTION_CAP);

  const input = {
    title,
    department: fields.category?.trim() || null,
    locationRaw,
    workplaceType: null,
    isRemote: remoteText === "" ? null : remoteText === "true",
    employmentType: fields.jobtype?.trim() || null,
    language: null,
    salary: null,
    descriptionText,
  };

  for (const name of Object.keys(fields)) {
    if ((fields[name] ?? "").trim() !== "") {
      fieldCoverage.set(name, (fieldCoverage.get(name) ?? 0) + 1);
    }
  }

  const tags = tagPosting(input);

  if (tags.workplace === "unknown" && remoteText === "false") {
    tags.workplace = "onsite";
  }

  if (experienceFallback && tags.seniority === null) {
    const seniority = experienceSeniority.get(fields.experience?.trim().toLowerCase() ?? "");

    if (seniority !== undefined) {
      tags.seniority = seniority;
    }
  }

  const published = Date.parse(fields.date?.trim() ?? "");

  if (Number.isNaN(published)) {
    invalidDates += 1;
  } else {
    dateAges.push((asOf - published) / 86_400_000);
  }

  bump(roleCounts, tags.role);
  bump(seniorityCounts, tags.seniority);
  bump(workplaceCounts, tags.workplace);
  bump(employmentCounts, tags.employmentType);
  bump(countryCounts, tags.countryCode);

  let matched = false;

  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index];
    const funnel = profileFunnels[index];

    if (profile === undefined || funnel === undefined) {
      continue;
    }

    const conditions = targetConditions(input, tags, locationRaw ?? "", profile);

    for (const [name, passed] of Object.entries(conditions)) {
      if (passed) {
        bump(funnel, name);
      }
    }

    if (Object.values(conditions).every(Boolean)) {
      profileMatches[index] = (profileMatches[index] ?? 0) + 1;
      matched = true;
    }
  }

  if (tagsPath !== undefined) {
    const taggedLine = toLine({
      referencenumber: reference,
      title,
      company: fields.company?.trim() ?? "",
      url: fields.url?.trim() ?? "",
      date: fields.date?.trim() ?? "",
      city,
      state,
      country,
      remote: remoteText,
      category: fields.category?.trim() ?? "",
      experience: fields.experience?.trim() ?? "",
      jobtype: fields.jobtype?.trim() ?? "",
      role: tags.role ?? "",
      subrole: tags.subrole ?? "",
      seniority: tags.seniority ?? "",
      workplace: tags.workplace,
      employmentType: tags.employmentType,
      language: tags.language ?? "",
      countryCode: tags.countryCode ?? "",
      region: tags.region ?? "",
      taggedCity: tags.city ?? "",
      salaryMinMinor: tags.salaryMinMinor,
    });

    taggedLines.push(taggedLine);
    taggedBytes += Buffer.byteLength(taggedLine);
  }

  if (matched) {
    unionMatches += 1;

    const line = toLine({
      referencenumber: reference,
      title,
      company: fields.company?.trim() ?? "",
      url: fields.url?.trim() ?? "",
      date: fields.date?.trim() ?? "",
      city,
      state,
      country,
      remote: remoteText,
      category: fields.category?.trim() ?? "",
      experience: fields.experience?.trim() ?? "",
      jobtype: fields.jobtype?.trim() ?? "",
      description,
    });

    pendingLines.push(line);
  }
}

async function flushPayload() {
  payloadBytes += await writeChunk(payload, pendingLines.splice(0));
  taggedBytes += await writeChunk(taggedOut, taggedLines.splice(0));
}

const parser = new Parser(
  {
    onopentag(name) {
      if (name === "job") {
        inJob = true;
        job = {};

        return;
      }

      if (inJob) {
        currentTag = name;
        currentText = "";
      }
    },
    ontext(text) {
      if (inJob && currentTag !== null) {
        currentText += text;
      }
    },
    onclosetag(name) {
      if (name === "job") {
        inJob = false;
        currentTag = null;
        handleJob(job);

        return;
      }

      if (inJob && currentTag === name) {
        job[name] = currentText;
        currentTag = null;
        currentText = "";
      }
    },
  },
  { xmlMode: true, decodeEntities: true },
);

const startedAt = performance.now();
const startedCpu = process.cpuUsage();
const rssBefore = process.memoryUsage.rss();

loop.enable();

for await (const chunk of source) {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

  uncompressedBytes += buffer.length;
  parser.write(decoder.decode(buffer, { stream: true }));
  await flushPayload();
  peakRss = Math.max(peakRss, process.memoryUsage.rss());
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

parser.write(decoder.decode());

parser.end();

await flushPayload();

loop.disable();

await new Promise((resolve) => {
  setImmediate(resolve);
});

if (payload !== null) {
  payload.end();
  await once(payload, "finish");
}

if (taggedOut !== null) {
  taggedOut.end();
  await once(taggedOut, "finish");
}

const endedAt = performance.now();
const cpu = process.cpuUsage(startedCpu);
const vmHwm = /VmHWM:\s+(?<kb>\d+) kB/u.exec(readFileSync("/proc/self/status", "utf8"));
const elapsedMs = endedAt - startedAt;
const ageDays = dateAges.toSorted((a, b) => a - b);
const medianAge = ageDays.at(Math.floor(ageDays.length / 2)) ?? 0;
const p90Age = ageDays.at(Math.floor(ageDays.length * 0.9)) ?? 0;

const shareOlderThan = (days: number, total: number) =>
  total === 0 ? 0 : dateAges.filter((age) => age > days).length / total;

const report = {
  feed: feedPath,
  feedBytes: statSync(feedPath).size,
  uncompressedBytes,
  jobs,
  skipped,
  duplicates,
  invalidDates,
  elapsedMs: Math.round(elapsedMs),
  cpuUserMs: Math.round(cpu.user / 1000),
  cpuSystemMs: Math.round(cpu.system / 1000),
  jobsPerSecond: Number((jobs / (elapsedMs / 1000)).toFixed(1)),
  msPerJob: Number((elapsedMs / Math.max(jobs, 1)).toFixed(3)),
  bytesPerSecond: Math.round(uncompressedBytes / (elapsedMs / 1000)),
  peakRssMB: Number((Math.max(peakRss, rssBefore) / 1024 / 1024).toFixed(1)),
  vmHwmMB:
    vmHwm?.groups?.kb === undefined ? null : Number((Number(vmHwm.groups.kb) / 1024).toFixed(1)),
  eventLoopDelayMs: {
    p50: Number((loop.percentile(50) / 1e6).toFixed(2)),
    p99: Number((loop.percentile(99) / 1e6).toFixed(2)),
    max: Number((loop.max / 1e6).toFixed(2)),
  },
  dateAgeDays: {
    median: Number(medianAge.toFixed(1)),
    p90: Number(p90Age.toFixed(1)),
    olderThan1: Number(shareOlderThan(1, dateAges.length).toFixed(4)),
    olderThan7: Number(shareOlderThan(7, dateAges.length).toFixed(4)),
    olderThan30: Number(shareOlderThan(30, dateAges.length).toFixed(4)),
    olderThan365: Number(shareOlderThan(365, dateAges.length).toFixed(4)),
  },
  fieldCoverage: Object.fromEntries(
    [...fieldCoverage.entries()]
      .toSorted((a, b) => b[1] - a[1])
      .map(([name, count]) => [name, Number((count / Math.max(jobs, 1)).toFixed(4))]),
  ),
  roles: Object.fromEntries([...roleCounts.entries()].toSorted((a, b) => b[1] - a[1])),
  employmentTypes: Object.fromEntries(
    [...employmentCounts.entries()].toSorted((a, b) => b[1] - a[1]),
  ),
  countries: Object.fromEntries(
    [...countryCounts.entries()].toSorted((a, b) => b[1] - a[1]).slice(0, 12),
  ),
  targetMatches: profiles.map((profile, index) => ({
    profile: profile.name,
    postings: profileMatches[index] ?? 0,
    share: Number(((profileMatches[index] ?? 0) / Math.max(jobs, 1)).toFixed(4)),
    funnel: Object.fromEntries(profileFunnels[index] ?? new Map<string, number>()),
  })),
  unionMatches,
  unionShare: Number((unionMatches / Math.max(jobs, 1)).toFixed(4)),
  payload: payloadPath === undefined ? null : { path: payloadPath, bytes: payloadBytes },
  tags: tagsPath === undefined ? null : { path: tagsPath, bytes: taggedBytes },
};

await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);

if (payloadPath !== undefined && payloadBytes > 0) {
  const gzipStream = createReadStream(payloadPath).pipe(createGzip({ level: 9 }));
  const gzipFile = createWriteStream(`${payloadPath}.gz`);
  let gzipBytes = 0;

  gzipStream.on("data", (chunk: Buffer) => {
    gzipBytes += chunk.length;
  });
  gzipStream.pipe(gzipFile);
  await once(gzipFile, "finish");

  process.stdout.write(`payload gzip bytes: ${String(gzipBytes)}\n`);
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
