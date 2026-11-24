import onetTitlesJson from "./tag-data/onet-titles.json";
import { isRemoteLocationText, normalizePlaceName, resolveLocation } from "./geo.ts";
import { detectLanguage } from "./language.ts";
import { parsePayRange } from "./salary.ts";

import type {
  EmploymentType,
  PostingTagInput,
  PostingTags,
  Seniority,
  Workplace,
} from "../../shared/tag-taxonomy.ts";

const onetDataset: { soc: string; title: string; role: string; alternates: string[] }[] =
  onetTitlesJson;

type Subrole = "Frontend" | "Backend" | "Full-stack" | "Mobile" | "Platform" | "Embedded";

const roleRules: readonly { role: string; pattern: RegExp }[] = [
  {
    role: "Security",
    pattern:
      /\b(?:infosec|cyber ?security|application security|appsec|penetration|offensive security|security)\b/u,
  },
  {
    role: "Machine Learning & AI",
    pattern:
      /\b(?:machine learning|deep learning|ml engineer|mlops|ai engineer|artificial intelligence|\bllm\b|\bnlp\b|computer vision|data scientist|applied scientist|generative ai)\b/u,
  },
  {
    role: "Data & Analytics",
    pattern:
      /\b(?:data analyst|data analytics|analytics|business intelligence|data engineer(?:ing)?|data warehouse|data warehousing|database|statistician|quantitative|data modelling)\b/u,
  },
  {
    role: "DevOps & Infrastructure",
    pattern:
      /\b(?:devops|sre|site reliability|infrastructure|cloud (?:engineer(?:ing)?|architect)|systems (?:engineer(?:ing)?|administrator|architect)|network engineer(?:ing)?|network architect|build engineer|devsecops)\b/u,
  },
  {
    role: "IT & Support Engineering",
    pattern:
      /\b(?:it support|it specialist|it engineer|help ?desk|technical support|desktop support|support technician|workplace technology|it generalist)\b/u,
  },
  {
    role: "QA & Test",
    pattern:
      /\b(?:\bqa\b|quality assurance|quality engineer(?:ing)?|test engineer(?:ing)?|\bsdet\b|software testing|test automation)\b/u,
  },
  {
    role: "Product Management",
    pattern: /\b(?:product (?:manager|management|owner|lead)|technical product)\b/u,
  },
  {
    role: "Project & Program Management",
    pattern:
      /\b(?:project (?:manager|management)|program (?:manager|management)|scrum master|delivery manager)\b/u,
  },
  {
    role: "Design",
    pattern:
      /\b(?:design(?:er|r)?|\bux\b|user experience|brand|illustrator|motion|design systems|content design|graphic)\b/u,
  },
  {
    role: "Hardware & Embedded",
    pattern:
      /\b(?:hardware|electrical engineer(?:ing)?|mechanical engineer(?:ing)?|firmware|embedded|silicon|\bfpga\b|\basic\b|\bpcb\b|chip)\b/u,
  },
  {
    role: "Recruiting",
    pattern: /\b(?:recruiter|recruiting|talent acquisition|sourcer|talent partner)\b/u,
  },
  {
    role: "People & HR",
    pattern:
      /\b(?:human resources|\bhr\b|people (?:operations|partner|team)|compensation|benefits|workplace experience)\b/u,
  },
  {
    role: "Legal",
    pattern: /\b(?:legal|counsel|lawyer|attorney|paralegal|compliance|privacy|regulatory)\b/u,
  },
  {
    role: "Accounting",
    pattern: /\b(?:accountant|accounting|bookkeeper|payroll|auditor|controller)\b/u,
  },
  {
    role: "Finance",
    pattern:
      /\b(?:finance|financial|accounts? (?:payable|receivable)|fp&a|treasury|underwriter|risk analyst|billing specialist)\b/u,
  },
  {
    role: "Business Development & Partnerships",
    pattern: /\b(?:business development|partnerships|partner manager|alliances|channel)\b/u,
  },
  {
    role: "Customer Success",
    pattern: /\b(?:customer success|implementation manager|onboarding manager|client success)\b/u,
  },
  {
    role: "Customer Support",
    pattern: /\b(?:customer (?:support|service|care)|support specialist|support agent)\b/u,
  },
  {
    role: "Communications & PR",
    pattern:
      /\b(?:communications|public relations|copywriter|writer|editorial|corporate affairs)\b/u,
  },
  {
    role: "Marketing",
    pattern:
      /\b(?:marketing|growth|\bseo\b|\bsem\b|demand generation|lifecycle|content marketing|social media)\b/u,
  },
  {
    role: "Supply Chain & Logistics",
    pattern: /\b(?:supply chain|logistics|warehouse|fulfil{1,2}ment|procurement|purchasing)\b/u,
  },
  {
    role: "Sales",
    pattern:
      /\b(?:sales|account executive|account manager|revenue|\bsdr\b|\bbdr\b|go ?to ?market|sales development)\b/u,
  },
  {
    role: "Healthcare",
    pattern:
      /\b(?:nurse|nursing|medical|clinical|physician|dentist|pharmac|therapist|health|radiolog|veterinar)\b/u,
  },
  {
    role: "Education",
    pattern:
      /\b(?:teacher|teaching|education|professor|lecturer|tutor|curriculum|instructional)\b/u,
  },
  {
    role: "Research & Science",
    pattern:
      /\b(?:scientist|biology|chemistry|physicist|laboratory|research (?:associate|assistant|fellow))\b/u,
  },
  { role: "Operations", pattern: /\b(?:operations|bizops|chief of staff|facilities)\b/u },
  {
    role: "Software Engineering",
    pattern:
      /\b(?:software|developer|development|engineering|programmer|\bswe\b|engineer|front[- ]?end|back[- ]?end|full[- ]?stack)\b/u,
  },
];

const subroleRules: readonly { subrole: Subrole; pattern: RegExp }[] = [
  {
    subrole: "Frontend",
    pattern:
      /\b(?:front ?end|web developer|web engineer|\breact\b|\bvue\b|\bangular\b|\bui\b engineer|interface engineer|\bcss\b)\b/u,
  },
  {
    subrole: "Backend",
    pattern:
      /\b(?:back ?end|\bapi\b (?:engineer|developer)|server side|server-side|\bnode\b|django|laravel|spring|microservices|distributed system)\b/u,
  },
  { subrole: "Full-stack", pattern: /\bfull ?stack\b/u },
  { subrole: "Mobile", pattern: /\b(?:mobile|\bios\b|android|swift|flutter|react native)\b/u },
  {
    subrole: "Platform",
    pattern:
      /\b(?:platform (?:engineer|developer)|developer experience|\bdx\b engineer|developer tooling)\b/u,
  },
  { subrole: "Embedded", pattern: /\b(?:embedded|firmware|\brtos\b|bare metal)\b/u },
];

const seniorityRules: readonly { seniority: Seniority; pattern: RegExp }[] = [
  { seniority: "intern", pattern: /\b(?:intern(?:ship)?|co-?op|working student|trainee)\b/u },
  {
    seniority: "director",
    pattern: /\b(?:director|head of|\bvp\b|vice president|\bchief\b|distinguished)\b/u,
  },
  { seniority: "manager", pattern: /\b(?:manager|mgr)\b/u },
  { seniority: "principal", pattern: /\b(?:principal|architect)\b/u },
  { seniority: "staff", pattern: /\b(?:staff|technical lead|\blead\b)\b/u },
  { seniority: "senior", pattern: /\b(?:senior|\bsr\b|iii)\b/u },
  { seniority: "mid", pattern: /\b(?:\bii\b|mid[- ]level|intermediate)\b/u },
  {
    seniority: "entry",
    pattern: /\b(?:junior|entry[- ]level|\bgrad\b|graduate|new grad|associate|apprentice|\bi\b)\b/u,
  },
];

const managerTitles = new Set([
  "Product Management",
  "Project & Program Management",
  "Customer Success",
  "Business Development & Partnerships",
  "Marketing",
  "Recruiting",
  "Operations",
]);

const employmentTypeKeywords: readonly { employmentType: EmploymentType; pattern: RegExp }[] = [
  { employmentType: "internship", pattern: /\b(?:intern(?:ship)?|co-?op|working student)\b/u },
  {
    employmentType: "contract",
    pattern: /\b(?:contract(?:or)?|\bc2c\b|corp ?to ?corp|freelance|fixed[- ]term)\b/u,
  },
  { employmentType: "temporary", pattern: /\b(?:temp(?:orary)?|seasonal|casual)\b/u },
  { employmentType: "part_time", pattern: /\bpart[- ]time\b/u },
  { employmentType: "full_time", pattern: /\b(?:full[- ]time|permanent)\b/u },
];

const employmentTypeEnums = new Map<string, EmploymentType>([
  ["full_time", "full_time"],
  ["fulltime", "full_time"],
  ["part_time", "part_time"],
  ["parttime", "part_time"],
  ["contract", "contract"],
  ["contractor", "contract"],
  ["internship", "internship"],
  ["intern", "internship"],
  ["temporary", "temporary"],
]);

const workplaceEnums = new Map<string, Workplace>([
  ["remote", "remote"],
  ["hybrid", "hybrid"],
  ["onsite", "onsite"],
  ["on-site", "onsite"],
  ["on site", "onsite"],
  ["in office", "onsite"],
]);

export const titleSimilarityThreshold = 0.85;

interface SimilarityEntry {
  normalized: string;
  role: string;
}

let similarityIndex: SimilarityEntry[] | null = null;

function trigramSet(text: string) {
  const padded = ` ${text} `;
  const grams = new Set<string>();

  for (let index = 0; index < padded.length - 3; index += 1) {
    grams.add(padded.slice(index, index + 3));
  }

  return grams;
}

function dice(first: Set<string>, second: Set<string>) {
  if (first.size === 0 || second.size === 0) {
    return 0;
  }

  let shared = 0;

  for (const gram of first) {
    if (second.has(gram)) {
      shared += 1;
    }
  }

  return (2 * shared) / (first.size + second.size);
}

function buildSimilarityIndex() {
  const entries: SimilarityEntry[] = [];
  const seen = new Set<string>();

  for (const occupation of onetDataset) {
    for (const title of [occupation.title, ...occupation.alternates]) {
      const normalized = normalizePlaceName(title);

      if (normalized === "" || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      entries.push({ normalized, role: occupation.role });
    }
  }

  return entries;
}

export function stripSeniorityTokens(text: string) {
  return normalizePlaceName(
    text
      .toLowerCase()
      .replaceAll(
        /\b(?:intern(?:ship)?|co-?op|senior|junior|staff|principal|director|head of|vp|lead|manager|mgr|distinguished|associate|graduate|entry[- ]level|new grad|trainee|i{1,4})\b/gu,
        " ",
      ),
  );
}

export function similarRole(title: string, department: string | null | undefined) {
  similarityIndex ??= buildSimilarityIndex();
  const index = similarityIndex;
  const normalized = stripSeniorityTokens(`${title} ${department ?? ""}`);

  if (normalized === "") {
    return null;
  }

  const grams = trigramSet(normalized);
  let best: { role: string; similarity: number } | null = null;

  for (const entry of index) {
    if (entry.normalized === normalized) {
      return { role: entry.role, similarity: 1 };
    }

    const similarity = dice(grams, trigramSet(entry.normalized));

    if (best === null || similarity > best.similarity) {
      best = { role: entry.role, similarity };
    }
  }

  return best !== null && best.similarity >= titleSimilarityThreshold ? best : null;
}

export interface TagRulesOptions {
  /**
   * Whether an unresolved title falls back to the O*NET similarity scan. The daily Stapply pass turns it off: it costs
   * about 18 ms per distinct title, which is hours over a full snapshot, and the LLM pass covers what it leaves open.
   */
  readonly titleSimilarity?: boolean;
}

export function classifyTitle(
  title: string,
  department: string | null | undefined,
  options: TagRulesOptions = {},
) {
  const text = normalizePlaceName(`${title} ${department ?? ""}`);
  let role: string | null = null;

  for (const rule of roleRules) {
    if (rule.pattern.test(text)) {
      ({ role } = rule);
      break;
    }
  }

  let subrole: Subrole | null = null;

  if (role === "Software Engineering" || role === "Hardware & Embedded") {
    for (const rule of subroleRules) {
      if (rule.pattern.test(text)) {
        ({ subrole } = rule);
        break;
      }
    }
  }

  const seniorityMatches = seniorityRules.flatMap((rule) =>
    rule.pattern.test(text) ? [rule.seniority] : [],
  );

  const managerRole = role !== null && managerTitles.has(role);
  const nonManagerMatch = seniorityMatches.find((match) => match !== "manager");

  const seniority: Seniority | null = managerRole
    ? (nonManagerMatch ?? null)
    : (seniorityMatches[0] ?? null);

  if (role !== null) {
    return { role, subrole, seniority, roleSource: "rules" as const };
  }

  if (options.titleSimilarity === false) {
    return { role: null, subrole, seniority, roleSource: "unclassified" as const };
  }

  const similar = similarRole(title, department);

  if (similar !== null) {
    return { role: similar.role, subrole, seniority, roleSource: "model" as const };
  }

  return { role: null, subrole, seniority, roleSource: "unclassified" as const };
}

function normalizeWorkplace(
  workplaceType: string | null | undefined,
  isRemote: boolean | null | undefined,
  title: string,
  locationRaw: string | null | undefined,
  descriptionText: string | null | undefined,
) {
  if (workplaceType !== null && workplaceType !== undefined) {
    const mapped = workplaceEnums.get(workplaceType.toLowerCase().trim());

    if (mapped !== undefined) {
      return mapped;
    }
  }

  if (isRemote === true) {
    return "remote";
  }

  const hybridInText =
    /\bhybrid\b/iu.test(title) ||
    (locationRaw !== null && locationRaw !== undefined && /\bhybrid\b/iu.test(locationRaw));

  if (hybridInText) {
    return "hybrid";
  }

  if (isRemoteLocationText(title) || isRemoteLocationText(locationRaw)) {
    return "remote";
  }

  const head =
    descriptionText === null || descriptionText === undefined ? "" : descriptionText.slice(0, 2000);

  if (
    /\bhybrid (?:working|environment|role|model|schedule|workplace|position|culture)\b/iu.test(
      head,
    ) ||
    /\bthis (?:position|role) is hybrid\b/iu.test(head)
  ) {
    return "hybrid";
  }

  if (
    /\b(?:100%[- ]remote|fully[- ]remote|remote[- ]first|this (?:position|role) is (?:100%[- ]|a )?remote)\b/iu.test(
      head,
    ) ||
    /#LI-Remote\b/iu.test(head)
  ) {
    return "remote";
  }

  return "unknown";
}

function normalizeEmploymentType(
  raw: string | null | undefined,
  title: string,
  descriptionText: string | null | undefined,
) {
  if (raw !== null && raw !== undefined) {
    const mapped = employmentTypeEnums.get(
      raw
        .toLowerCase()
        .replaceAll(/[\s-]+/gu, "_")
        .trim(),
    );

    if (mapped !== undefined) {
      return mapped;
    }
  }

  const head =
    `${title} ${descriptionText === null || descriptionText === undefined ? "" : descriptionText.slice(0, 2000)}`.toLowerCase();

  for (const keyword of employmentTypeKeywords) {
    if (keyword.pattern.test(head)) {
      return keyword.employmentType;
    }
  }

  return "unknown";
}

export function tagPosting(input: PostingTagInput, options: TagRulesOptions = {}) {
  const workplace = normalizeWorkplace(
    input.workplaceType,
    input.isRemote,
    input.title,
    input.locationRaw,
    input.descriptionText,
  );

  const resolved = resolveLocation(input.locationRaw);

  const location =
    workplace === "remote"
      ? { countryCode: resolved.countryCode, region: null, city: null }
      : resolved;

  const employmentType = normalizeEmploymentType(
    input.employmentType,
    input.title,
    input.descriptionText,
  );

  const structuredSalary = input.salary ?? null;

  const structuredHasRange =
    structuredSalary !== null &&
    (structuredSalary.minMinor !== null || structuredSalary.maxMinor !== null);

  const salary = structuredHasRange
    ? structuredSalary
    : parsePayRange((input.descriptionText ?? "").slice(0, 2000));

  const language =
    input.language ??
    detectLanguage(`${input.title} ${(input.descriptionText ?? "").slice(0, 500)}`) ??
    "en";

  const classified = classifyTitle(input.title, input.department, options);

  const tags: PostingTags = {
    workplace,
    employmentType,
    countryCode: location.countryCode,
    region: location.region,
    city: location.city,
    language,
    salaryMinMinor: salary?.minMinor ?? null,
    salaryMaxMinor: salary?.maxMinor ?? null,
    salaryCurrency: salary?.currency ?? null,
    salaryPeriod: salary?.period ?? null,
    role: classified.role,
    subrole: classified.subrole,
    seniority: classified.seniority,
    roleSource: classified.roleSource,
  };

  return tags;
}
