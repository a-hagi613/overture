export interface ResumeLine {
  id: string;
  text: string;
}

export interface Claim {
  text: string;
  resumeLineIds: string[];
}

export interface GroundingContext {
  employers: readonly string[];
}

const NUMBER = /\d[\d.,]*/gu;
const YEAR = /\b(?:19|20)\d{2}\b/gu;

const NUMBER_WORDS = new Set([
  "eight",
  "eighteen",
  "eighty",
  "eleven",
  "fifteen",
  "fifty",
  "five",
  "forty",
  "four",
  "fourteen",
  "hundred",
  "nine",
  "nineteen",
  "ninety",
  "one",
  "seven",
  "seventeen",
  "seventy",
  "six",
  "sixteen",
  "sixty",
  "ten",
  "thirteen",
  "thirty",
  "three",
  "thousand",
  "twelve",
  "twenty",
  "two",
]);

const MONTHS = new Set([
  "april",
  "august",
  "december",
  "february",
  "january",
  "july",
  "june",
  "march",
  "may",
  "november",
  "october",
  "september",
]);

const TECHNOLOGIES = new Set([
  "airflow",
  "angular",
  "ansible",
  "aws",
  "azure",
  "bash",
  "bigquery",
  "c#",
  "c++",
  "cassandra",
  "clojure",
  "css",
  "django",
  "docker",
  "dynamodb",
  "elasticsearch",
  "elixir",
  "erlang",
  "express",
  "flask",
  "gcp",
  "git",
  "github",
  "golang",
  "graphql",
  "grpc",
  "hadoop",
  "haskell",
  "html",
  "java",
  "javascript",
  "jenkins",
  "kafka",
  "kotlin",
  "kubernetes",
  "linux",
  "mongodb",
  "mysql",
  "nestjs",
  "nginx",
  "node",
  "openai",
  "oracle",
  "php",
  "postgres",
  "postgresql",
  "python",
  "rabbitmq",
  "rails",
  "react",
  "redis",
  "rest",
  "ruby",
  "rust",
  "scala",
  "snowflake",
  "spark",
  "spring",
  "sql",
  "sqlite",
  "swift",
  "terraform",
  "typescript",
  "vue",
  "webpack",
]);

const CLAIM_WORDS: readonly RegExp[] = [
  /\bautomat(?:ed|ing)\b/u,
  /\bbuilt\b/u,
  /\bcreat(?:ed|ing)\b/u,
  /\bdeliver(?:ed|ing)\b/u,
  /\bdesigned\b/u,
  /\bdevelop(?:ed|ing)\b/u,
  /\bimplement(?:ed|ing)\b/u,
  /\bimproved\b/u,
  /\b(?:increased|reduced)\b/u,
  /\blaunch(?:ed|ing)\b/u,
  /\bmaintain(?:ed|ing)\b/u,
  /\bmigrat(?:ed|ing)\b/u,
  /\boptimi[sz](?:ed|ing)\b/u,
  /\brefactor(?:ed|ing)\b/u,
  /\bscal(?:ed|ing)\b/u,
  /\barchitect(?:ed|ure)?\b/u,
  /\bdirector\b/u,
  /\bexpert(?:ise)?\b/u,
  /\bfounded\b/u,
  /\bheaded\b/u,
  /\b(?:led|lead|leading|leader)\b/u,
  /\b(?:managed|manager|managing|management)\b/u,
  /\bmentor(?:ed|ing)?\b/u,
  /\b(?:owned|owner|owning)\b/u,
  /\bprincipal\b/u,
  /\bsenior\b/u,
  /\bstaff\b/u,
];

const ORGANISATION =
  /\b[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4}\s+(?:Analytics|Bank|College|Corp(?:oration)?|Group|Inc|LLC|Labs|Ltd|Media|Solutions|Studios|Systems|Technologies|Technology|University)\b/gu;

const WORD = /[\p{L}\p{N}+#][\p{L}\p{N}+#.'-]*/gu;

function normalizeNumber(value: string) {
  return value.replaceAll(",", "").replaceAll(/\.$/gu, "");
}

function numbersIn(value: string) {
  return (value.match(NUMBER) ?? []).map((number) =>
    normalizeNumber(number.replaceAll(/[.,]+$/gu, "")),
  );
}

function words(value: string) {
  return (value.match(WORD) ?? []).map((word) => word.toLowerCase().replaceAll(/[.'-]+$/gu, ""));
}

function containsEmployer(lineText: string, employer: string) {
  return lineText.toLowerCase().includes(employer.trim().toLowerCase());
}

function numberSupported(number: string, lineNumbers: ReadonlySet<string>) {
  return lineNumbers.has(number);
}

function claimSupported(claim: Claim, cited: string, context: GroundingContext) {
  const lower = claim.text.toLowerCase();
  const citedLower = cited.toLowerCase();
  const lineNumbers = new Set(numbersIn(cited));

  for (const number of numbersIn(claim.text)) {
    if (!numberSupported(number, lineNumbers)) {
      return false;
    }
  }

  for (const year of claim.text.match(YEAR) ?? []) {
    if (!cited.includes(year)) {
      return false;
    }
  }

  for (const word of words(claim.text)) {
    if (!NUMBER_WORDS.has(word) && !MONTHS.has(word)) {
      continue;
    }

    if (!words(cited).includes(word)) {
      return false;
    }
  }

  for (const employer of context.employers) {
    if (containsEmployer(lower, employer) && !containsEmployer(citedLower, employer)) {
      return false;
    }
  }

  for (const match of claim.text.matchAll(ORGANISATION)) {
    if (!citedLower.includes(match[0].toLowerCase())) {
      return false;
    }
  }

  for (const word of words(claim.text)) {
    if (TECHNOLOGIES.has(word) && !words(cited).includes(word)) {
      return false;
    }
  }

  for (const pattern of CLAIM_WORDS) {
    if (pattern.test(lower) && !pattern.test(citedLower)) {
      return false;
    }
  }

  return true;
}

function hasClaim(claim: string, context: GroundingContext) {
  const lower = claim.toLowerCase();

  if (numbersIn(claim).length > 0) {
    return true;
  }

  for (const word of words(claim)) {
    if (NUMBER_WORDS.has(word) || MONTHS.has(word) || TECHNOLOGIES.has(word)) {
      return true;
    }
  }

  if ((claim.match(ORGANISATION) ?? []).length > 0) {
    return true;
  }

  if (context.employers.some((employer) => containsEmployer(lower, employer))) {
    return true;
  }

  return CLAIM_WORDS.some((pattern) => pattern.test(lower));
}

export function groundClaims(
  claims: readonly Claim[],
  lines: readonly ResumeLine[],
  context: GroundingContext,
) {
  const byId = new Map(lines.map((line) => [line.id, line.text]));

  return claims.filter((claim) => {
    if (claim.text.trim() === "") {
      return false;
    }

    if (claim.resumeLineIds.length === 0) {
      return !hasClaim(claim.text, context);
    }

    const citedLines = claim.resumeLineIds.map((id) => byId.get(id));

    if (citedLines.some((line) => line === undefined)) {
      return false;
    }

    const cited = citedLines.filter((line) => line !== undefined).join("\n");

    return claimSupported(claim, cited, context);
  });
}

export function resumeLines(text: string) {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line, index) => ({ id: `L${String(index + 1)}`, text: line }));
}

export function wordCount(text: string) {
  return text.split(/\s+/u).filter((word) => word !== "").length;
}

export function fitSentences(sentences: readonly string[], limit: number) {
  const kept: string[] = [];
  let total = 0;

  for (const sentence of sentences) {
    const count = wordCount(sentence);

    if (total + count > limit) {
      return kept;
    }

    kept.push(sentence);
    total += count;
  }

  return kept;
}
