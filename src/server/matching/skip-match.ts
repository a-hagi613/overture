import { normalizeCompanyName } from "../profile/skip-companies.ts";

const NEAR_MATCH_THRESHOLD = 0.85;

export interface SkipTarget {
  companyId: string | null;
  nameNorm: string;
  domain: string | null;
  reason: "current_employer" | "user";
}

export interface CompanyIdentity {
  id: string;
  name: string;
  domain: string | null;
}

export function registrableDomain(domain: string | null) {
  if (domain === null) {
    return null;
  }

  const trimmed = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//u, "")
    .split("/")[0]
    ?.replace(/\.$/u, "");

  if (trimmed === undefined || trimmed === "") {
    return null;
  }

  const withoutWww = trimmed.startsWith("www.") ? trimmed.slice(4) : trimmed;

  return withoutWww === "" ? null : withoutWww;
}

function bigrams(value: string) {
  const padded = ` ${value} `;
  const grams: string[] = [];

  for (let index = 0; index < padded.length - 1; index += 1) {
    grams.push(padded.slice(index, index + 2));
  }

  return grams;
}

export function bigramSimilarity(left: string, right: string) {
  if (left === right) {
    return 1;
  }

  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  const rightCounts = new Map<string, number>();

  for (const gram of rightGrams) {
    rightCounts.set(gram, (rightCounts.get(gram) ?? 0) + 1);
  }

  let shared = 0;

  for (const gram of leftGrams) {
    const count = rightCounts.get(gram) ?? 0;

    if (count > 0) {
      shared += 1;
      rightCounts.set(gram, count - 1);
    }
  }

  return (2 * shared) / (leftGrams.length + rightGrams.length);
}

export interface SkipMatch {
  matched: boolean;
  near: boolean;
  reason: "current_employer" | "user" | null;
}

export function skipMatches(company: CompanyIdentity, skips: readonly SkipTarget[]) {
  const companyNorm = normalizeCompanyName(company.name);
  const companyDomain = registrableDomain(company.domain);

  for (const skip of skips) {
    const matched = { matched: true, near: false, reason: skip.reason } satisfies SkipMatch;

    if (skip.companyId !== null && skip.companyId === company.id) {
      return matched;
    }

    if (skip.nameNorm === companyNorm) {
      return matched;
    }

    if (
      skip.nameNorm !== "" &&
      companyNorm !== "" &&
      bigramSimilarity(skip.nameNorm, companyNorm) >= NEAR_MATCH_THRESHOLD
    ) {
      return { ...matched, near: true };
    }

    const skipDomain = registrableDomain(skip.domain);

    if (skipDomain !== null && companyDomain !== null) {
      if (
        skipDomain === companyDomain ||
        companyDomain.endsWith(`.${skipDomain}`) ||
        skipDomain.endsWith(`.${companyDomain}`)
      ) {
        return matched;
      }

      if (bigramSimilarity(skipDomain, companyDomain) >= NEAR_MATCH_THRESHOLD) {
        return { ...matched, near: true };
      }
    }
  }

  return { matched: false, near: false, reason: null };
}
