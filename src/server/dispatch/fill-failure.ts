import type { FillFailure } from "./forms/engine.ts";

/**
 * The attempt row's error code for a run that never reached preflight. A named
 * fill failure is visible; an unnamed one still records that it was a fill.
 *
 * @param failure The planned field the filler could not write, if it named one.
 * @param outcome The runner's outcome.
 * @returns The error code, or null when the outcome was not a fill failure.
 */
export function fillErrorCode(failure: FillFailure | undefined, outcome: string) {
  if (failure !== undefined) {
    return `fill_failed:${failure.fieldType ?? "unknown"}:${failure.fieldName ?? failure.label}`;
  }

  return outcome === "fill_failed" ? "fill_failed:unknown" : null;
}

/**
 * The Ready card's note when a fill failure sent the Application back.
 *
 * @param failure The planned field the filler could not write.
 * @returns A short human-readable line naming the field.
 */
export const fillFailureNote = (failure: FillFailure) =>
  `The ${failure.label === "" ? (failure.fieldName ?? "form") : failure.label} field could not be filled`;
