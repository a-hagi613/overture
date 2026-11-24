import type { RoleGroup } from "../../shared/tag-taxonomy.ts";
import type { TextEmbedder } from "./embedder.ts";

import { embedInBatches, cosineSimilarity } from "./embedder.ts";
import { escoRolePrototypes } from "./esco-taxonomy.ts";

export interface CalibrationExample {
  readonly title: string;
  readonly category: RoleGroup;
  readonly role: string;
  readonly language: string;
}

export const EMBEDDING_CALIBRATION_FIXTURE: readonly CalibrationExample[] = [
  {
    category: "Software Engineering",
    language: "en",
    role: "Software Engineer",
    title: "Senior Backend Engineer",
  },
  {
    category: "Software Engineering",
    language: "en",
    role: "Frontend Engineer",
    title: "Frontend Developer",
  },
  { category: "Data & Analytics", language: "en", role: "Data Engineer", title: "Data Engineer" },
  {
    category: "Data & Analytics",
    language: "en",
    role: "Data Analyst",
    title: "Business Data Analyst",
  },
  {
    category: "Product Management",
    language: "en",
    role: "Product Manager",
    title: "Product Manager",
  },
  {
    category: "Administrative",
    language: "en",
    role: "Executive Assistant",
    title: "Executive Assistant",
  },
  { category: "Administrative", language: "en", role: "Office Manager", title: "Office Manager" },
  { category: "Administrative", language: "en", role: "Receptionist", title: "Receptionist" },
  { category: "Healthcare", language: "en", role: "Registered Nurse", title: "Registered Nurse" },
  { category: "Accounting", language: "en", role: "Accountant", title: "Accountant" },
  {
    category: "Software Engineering",
    language: "de",
    role: "Software Engineer",
    title: "Entwickler",
  },
  {
    category: "DevOps & Infrastructure",
    language: "de",
    role: "Database Administrator",
    title: "Datenbankadministrator",
  },
  { category: "Accounting", language: "de", role: "Accountant", title: "Buchhalter" },
  {
    category: "DevOps & Infrastructure",
    language: "fr",
    role: "Database Administrator",
    title: "administrateur de base de données",
  },
  { category: "Healthcare", language: "fr", role: "Registered Nurse", title: "infirmier" },
  {
    category: "Software Engineering",
    language: "es",
    role: "Software Engineer",
    title: "desarrollador",
  },
  { category: "Administrative", language: "es", role: "Receptionist", title: "recepcionista" },
  {
    category: "DevOps & Infrastructure",
    language: "ja",
    role: "Database Administrator",
    title: "データベース管理者",
  },
  { category: "Healthcare", language: "ja", role: "Registered Nurse", title: "看護師" },
  { category: "Sales", language: "ja", role: "Sales Representative", title: "営業" },
];

export interface ScoredExample extends CalibrationExample {
  readonly top1Category: RoleGroup;
  readonly top1Role: string;
  readonly top1Score: number;
  readonly margin: number;
}

export interface CalibrationResult {
  readonly examples: number;
  readonly accuracy: number;
  readonly accepted: number;
  readonly correct: number;
  readonly precision: number;
  readonly coverage: number;
  readonly acceptTop1: number;
  readonly acceptMargin: number;
}

/**
 * Scores each labelled example against the embedded role prototypes.
 * @param embedder The embedding port.
 * @param fixture The labelled examples.
 * @returns One scored row per example, in fixture order.
 */
export async function scoreCalibrationFixture(
  embedder: TextEmbedder,
  fixture: readonly CalibrationExample[] = EMBEDDING_CALIBRATION_FIXTURE,
) {
  const prototypes = escoRolePrototypes();

  const prototypeVectors = await embedInBatches(
    embedder,
    prototypes.map((prototype) => `passage: ${prototype.text}`),
  );

  const queryVectors = await embedInBatches(
    embedder,
    fixture.map((example) => `query: ${example.title}`),
  );

  return fixture.map((example, index) => {
    const query = queryVectors[index] ?? new Float32Array(0);

    const ranked = prototypes
      .map((prototype, position) => ({
        category: prototype.category,
        role: prototype.role,
        score: cosineSimilarity(query, prototypeVectors[position] ?? new Float32Array(0)),
      }))
      .toSorted((left, right) => right.score - left.score);

    const [top] = ranked;

    return {
      ...example,
      margin: (top?.score ?? 0) - (ranked[1]?.score ?? 0),
      top1Category: top?.category ?? "Operations",
      top1Role: top?.role ?? "",
      top1Score: top?.score ?? 0,
    } satisfies ScoredExample;
  });
}

/**
 * Evaluates the labelled examples at the current thresholds.
 * @param examples The scored examples.
 * @param acceptTop1 The top-1 threshold.
 * @param acceptMargin The top-1-versus-top-2 margin.
 * @param strongTop1 The top-1 score that stands without the margin.
 * @returns Accuracy, coverage and precision at that pair.
 */
export function evaluateCalibration(
  examples: readonly ScoredExample[],
  acceptTop1: number,
  acceptMargin: number,
  strongTop1 = 0.86,
) {
  const accepted = examples.filter(
    (example) =>
      example.top1Score >= acceptTop1 &&
      (example.top1Score >= strongTop1 || example.margin >= acceptMargin),
  );

  const correct = accepted.filter(
    (example) => example.top1Category === example.category && example.top1Role === example.role,
  );

  const accuracy = examples.filter(
    (example) => example.top1Category === example.category && example.top1Role === example.role,
  );

  return {
    acceptMargin,
    accepted: accepted.length,
    acceptTop1,
    accuracy: examples.length === 0 ? 0 : accuracy.length / examples.length,
    correct: correct.length,
    coverage: examples.length === 0 ? 0 : accepted.length / examples.length,
    examples: examples.length,
    precision: accepted.length === 0 ? 0 : correct.length / accepted.length,
  } satisfies CalibrationResult;
}

/**
 * Sweeps a threshold grid and picks the pair with the best precision while keeping at least the requested coverage.
 * @param examples The scored examples.
 * @param minimumCoverage The coverage the recommended pair must reach.
 * @returns The recommended pair and its result.
 */
export function suggestThresholds(examples: readonly ScoredExample[], minimumCoverage = 0.8) {
  let best: CalibrationResult | null = null;

  for (let top1Hundredths = 70; top1Hundredths <= 90; top1Hundredths += 1) {
    for (let marginHundredths = 0; marginHundredths <= 15; marginHundredths += 1) {
      const result = evaluateCalibration(examples, top1Hundredths / 100, marginHundredths / 100);

      if (result.coverage < minimumCoverage) {
        continue;
      }

      if (
        best === null ||
        result.precision > best.precision ||
        (result.precision === best.precision && result.coverage > best.coverage)
      ) {
        best = result;
      }
    }
  }

  return best ?? evaluateCalibration(examples, 0.78, 0.06);
}
