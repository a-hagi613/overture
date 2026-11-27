/** One job's repeated scores from the manual Haiku 5.5 gate run. */
export interface RepeatSample {
  jobId: string;
  scores: readonly number[];
}

/** How far the same job's score moved between runs. */
export interface RepeatDifference {
  average: number;
  max: number;
  pairs: number;
}

/**
 * Measures score stability the way the launch gate asks: the average and maximum absolute change between repeated
 * scores of the same job. A single-run sample contributes nothing rather than a zero that flatters the result.
 * @param samples Every job scored more than once.
 * @returns The average and maximum difference, and how many pairs were compared.
 */
export function repeatDifference(samples: readonly RepeatSample[]) {
  const differences: number[] = [];

  for (const sample of samples) {
    for (let index = 1; index < sample.scores.length; index += 1) {
      differences.push(Math.abs((sample.scores[index] ?? 0) - (sample.scores[index - 1] ?? 0)));
    }
  }

  if (differences.length === 0) {
    return { average: 0, max: 0, pairs: 0 };
  }

  return {
    average: differences.reduce((total, value) => total + value, 0) / differences.length,
    max: Math.max(...differences),
    pairs: differences.length,
  };
}

/** One job's first-run outcome against the gate's wrong-field check. */
export interface WrongFieldSample {
  expectedWrongField: boolean;
  visible: boolean;
}

/**
 * The share of jobs that should have been hidden for a wrong field but still reached the visible list.
 * @param samples The labelled jobs and whether each was visible.
 * @returns The rate from 0 to 1.
 */
export function wrongFieldRate(samples: readonly WrongFieldSample[]) {
  const expected = samples.filter((sample) => sample.expectedWrongField);

  if (expected.length === 0) {
    return 0;
  }

  return expected.filter((sample) => sample.visible).length / expected.length;
}

/**
 * Whether a gate run clears the two numeric bars from ADR 0045.
 * @param difference The repeat-run difference.
 * @param wrongField The visible wrong-field rate.
 * @returns True when both bars hold.
 */
export function gatePasses(difference: RepeatDifference, wrongField: number) {
  return difference.average <= 5 && difference.max <= 15 && wrongField <= 0.02;
}
