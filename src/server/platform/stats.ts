export const ratio = (numerator: number, denominator: number) =>
  denominator === 0 ? null : numerator / denominator;

export function percentile(values: number[], fraction: number) {
  if (values.length === 0) {
    return null;
  }

  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction));

  return sorted[index] ?? null;
}
